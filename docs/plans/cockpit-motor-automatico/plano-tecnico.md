# Plano técnico: Motor automático de ligação no Cockpit

Data: 15/11/2026 (BRT). Autor: Atlas (Planejador). Base: `spec.md` (FR/NFR/CON), `decisoes.md` e `pesquisa.md`.
Pesquisa só de leitura. Nada foi escrito em `src/`, nenhuma migration criada, nenhum commit, nada gravado no banco.
Caminhos relativos a `src/`. "PDT" = `features/activities/components/PowerDialerTab.tsx`.

## 0. Regra de ouro do diff

- **Proibido no diff:** `src/features/activities/**`, `src/features/calls/**` e `src/features/integrations/webphone/**` (decisão: ponto 10 em `decisoes.md`). Esses três só entram por **import**: são a Execução ou são compartilhados com ela.
- **Não editar, só importar:** `src/lib/**`. Se precisar mudar, vira decisão do usuário.
- **Permitido:** `src/features/cockpit/**`, `src/app/(app)/cockpit/**` e uma migration de flags.

### Fatos que o plano usa (conferidos em 15/11)

| Fato | Prova |
|---|---|
| A RPC `cockpit_next_call_candidates` já está em produção (EXECUTE só `service_role`) | SELECT em `pg_proc`; `supabase/migrations/20261116004026_cockpit_next_call_candidates.sql` |
| A RPC já devolve `calls_today` e `last_call_at` para **todas** as linhas, quentes e frias | migration `:39-49`, `:121-140` |
| O teto (`p_daily_cap`) só tira o **frio** do `cold_rank`; o quente passa | `:147`, `:184` |
| A RPC exclui só `contact_holds.tipo='total'`; `prospeccao` passa | `:86-89` |
| `contact_holds.tipo` aceita `prospeccao`, `conversa` e `total`; hoje há 2 `total` e 9 `prospeccao`; índice único `(lead_id, tipo)` | SELECT de constraint e contagem |
| Feriados: tabela `business_holidays` (22 futuros, o próximo em 20/11) e `isBrBusinessDay`/`brtDateKey` em `lib/utils/br-holidays.ts:51-61` (mesma lista, conferida por teste) | SELECT; `br-holidays.ts:1-13` |
| `extraMetadata` de `initiateApi4ComCall` vai só para a API4COM, **não** para `calls.metadata` | `features/calls/services/originate-api4com-call.service.ts:65,80` |
| `calls.metadata` aceita merge atômico por `mergeCallsMetadata` | `features/calls/services/merge-calls-metadata.ts:40` |
| `applySdrCallResult` grava `sdr_disposition` e as notas **sem avançar a cadência**. Quem avança é `completeDialerCall`, que não será usado | `features/calls/services/apply-sdr-call-result.ts:45-132`; `features/activities/actions/complete-dialer-call.ts:96-128` |
| Correlação do webphone (dialToken) fica em `integrations/webphone`, não na Execução | `features/integrations/webphone/webphone-dial-correlation.ts:36,59,64` |
| O estado `awaiting-sdr` com `reason:'answered'` já existe no tipo do redutor, mas o redutor da Execução manda "atendeu" para `auto-completing` | `features/activities/utils/auto-dialer.ts:54,125` |
| Há um SDR com 414 ligações num único dia nos últimos 30 dias | SELECT em `calls` |
| `call_cockpit_outcomes` não existe em `app_flags` e não tem migration | SELECT; grep em `supabase/migrations` |

### O plano depende das mudanças não commitadas do floor `feattime-web-dev`?

**Não.** Os 10 arquivos alterados (conferidos com `git diff`) fazem duas coisas:
1. Tiram `leadsWithSnooze` de `DialerStats` (`fetch-dialer-queue.ts`, `fetch-dialer-stats.ts`, `dialer-preferences.schemas.ts`, `DialerSidebar.tsx` e testes).
2. Deixam o SDR fechar o aviso do webphone (`WebphonePanel.tsx`).

O plano não importa `DialerStats`, `fetch-dialer-queue` nem `DialerSidebar`. Os arquivos importados (`auto-dialer.ts`, `power-dialer-webphone-sync.ts`) não estão nesse diff.

Único cuidado: como o aviso do webphone passa a poder ser fechado, o motor **mostra o próprio motivo de pausa** (FR-15) e não depende desse aviso.

## 1. Ajuste da RPC (teto 3 e intervalo de 1 h)

**Recomendação: opção A, sem migration de função.**
- O motor chama a RPC existente com `p_daily_cap = 3` e `p_cold_limit = 1000`, acima da maior carteira (533).
- No TypeScript, filtra **quente e frio** por:
  - `callsToday < 3` (FR-4);
  - `lastCallAt <= agora − 1 h` (FR-5);
  - fora da lista de excluídos da sessão (FR-17).
- O bloqueio `prospeccao` é lido à parte, com uma consulta em `contact_holds` só dos candidatos que restaram, em blocos de até 100 ids, como em `loadSignalsInChunks` (`features/cockpit/services/next-call-card.service.ts:223`).
- Prós: não mexe na função que está no ar e usa só dados que ela já devolve.
- Contra: devolve mais linhas. Forge refaz o `EXPLAIN ANALYZE` com `p_cold_limit=1000` na carteira de 533. O alvo é NFR-1 (hoje 46,6 ms com limite 20).
- O que muda no #641: `buildCandidatesRpcArgs` (`features/cockpit/utils/cold-lead-order.ts:42-61`) ganha um parâmetro opcional `overrides`. É mudança aditiva: sem ele, o comportamento atual fica igual.

**Opção B, só se o EXPLAIN da opção A estourar NFR-1.** Migration nova com uma **função nova** `public.cockpit_auto_dial_candidates(...)`, e não com outra assinatura da atual:
- `CREATE OR REPLACE` com parâmetros a mais criaria uma sobrecarga, e o PostgREST erra com chamadas ambíguas.
- `DROP` + `CREATE` reconcede `authenticated` (memória `security-definer-drop-recreate-regrants-authenticated`).
- Ela teria o mesmo corpo, mais:
  - `p_min_gap interval DEFAULT '1 hour'`;
  - o teto valendo também para o quente;
  - exclusão de `tipo IN ('total','prospeccao')`.
- Também: `SECURITY INVOKER`, `search_path=''`, `REVOKE ... FROM PUBLIC, anon, authenticated` e `GRANT EXECUTE ... TO service_role`, mais `pnpm gen:types` no mesmo PR.
- Fica proposta. Não aplicar.

## 2. Migration de flags (a única migration da opção A)

Arquivo: `supabase/migrations/YYYYMMDDHHMMSS_cockpit_auto_dial_flags.sql`, com timestamp único de 14 dígitos, maior que `20261116004325`.

```sql
BEGIN;
INSERT INTO public.app_flags (key, enabled, note, allow_org_ids, allow_user_ids) VALUES
  ('call_cockpit_outcomes', false,
   'Resultado e resumo pós-ligação no cartão do Cockpit (painel de desfecho). Necessária para o motor. Liberar por allow_user_ids. Não marcar enabled=true.',
   '{}'::uuid[], '{}'),
  ('cockpit_auto_dial', false,
   'Motor automático do Cockpit. Ligado só em modo SIMULADO (sem ligação real). Liberar por allow_user_ids. Não marcar enabled=true.',
   '{}'::uuid[], '{}'),
  ('cockpit_auto_dial_live', false,
   'Libera LIGAÇÃO REAL no motor do Cockpit. Só com aprovação explícita. Sem esta flag o motor roda simulado.',
   '{}'::uuid[], '{}')
ON CONFLICT (key) DO NOTHING;
COMMIT;
```

- Ela só insere linhas, sem mudar o schema, então dispensa `gen:types`.
- **Três flags, todas desligadas e com `allow_org_ids` vazio** (decisão: ponto 8 em `decisoes.md`):
  1. `call_cockpit_outcomes`: o painel de resultado do cartão. Hoje não existe em `app_flags`, então o código a lê como desligada (`features/cockpit/services/cockpit-outcomes-flag.ts`).
  2. `cockpit_auto_dial`: o motor em modo **simulado** (FR-18).
  3. `cockpit_auto_dial_live`: ligação real.
- O motor aparece só com 1 **e** 2 ligadas para o usuário (CON-6). Liga de verdade só com as três. O par 2+3 segue o padrão `crm_auto_update_v1` / `crm_auto_update_v1_live`, que já existe.
- `ON CONFLICT (key) DO NOTHING`: se alguém criar `call_cockpit_outcomes` antes, a linha existente é mantida, e é preciso conferir que ela continua desligada.

## 3. Arquivos: criar e alterar

### 3.1 Funções puras (cockpit/utils), sem rede e sem React

| Arquivo | Conteúdo | Fonte |
|---|---|---|
| **novo** `features/cockpit/utils/auto-dial-rules.ts` (+ teste) | `AUTO_DIAL_RULES = { maxAttemptsPerDay: 3, minGapMs: 3_600_000, dailyCap: 400 (era 100; M-6, ver §6 F1), dailyCapMax: 400, windowStartHour: 8, windowEndHour: 20 }` e funções:<br>`isWithinDialWindow(now)`: seg–sex, 08:00:00 ≤ hora BRT < 20:00:00, **e** `isBrBusinessDay(brtDateKey(now))` (feriado bloqueia: pontos 1 e 6 em `decisoes.md`). Devolve o motivo (`outside_hours` ou `holiday`);<br>`isLeadEligible(row, now, rules)`;<br>`nextReleaseAt(rows, now, rules)`: para o estado Aguardando;<br>`isDailyCapReached(count, rules)` | FR-4/5/11/12. Constantes **próprias**, não importadas da Execução: a regra é do usuário (D-Tentativas) e não pode mudar se a Execução mudar |
| **novo** `features/cockpit/utils/cockpit-auto-dial-machine.ts` (+ teste) | `reduceCockpitAutoDial(state, event)`: **envolve** `reduceAutoDial` (import de `features/activities/utils/auto-dialer.ts`) com 3 desvios:<br>(1) `resolving` + `lead_answer answered` vai para `awaiting-sdr {reason:'answered'}` (FR-8), e não para `auto-completing`;<br>(2) fase extra `blocked {reason:'outside_hours'\|'holiday'\|'daily_cap'\|'empty'}`, que só sai com `stop` ou `start` (FR-11/12);<br>(3) `paused` com `reason:'user'` em `pause` (igual).<br>`describeCockpitAutoDial(state)` reaproveita `describeAutoDial` e cobre os textos novos ("Em conversa: confirme o desfecho para seguir", "Fora do horário (seg–sex 8h–20h)", "Teto do dia atingido"). | Spec §3, D1 |
| **novo** `features/cockpit/utils/simulated-dialer.ts` (+ teste) | Discador falso e puro. Recebe um roteiro (`'no_answer' \| 'answered' \| 'ramal_busy' \| 'dial_failed'`, em ciclo ou por lead) e devolve: id `sim-<uuid>`, a espera até o "fim" (ex.: 8 s) e o resultado. **Não** importa nada de `calls/` nem de `integrations/` | FR-18 |
| **alterar** `features/cockpit/utils/cold-lead-order.ts` (+ teste) | `buildCandidatesRpcArgs(viewer, now, exclude, overrides?)`: sem `overrides`, saída idêntica | §1 |

Importados da Execução **sem editar** (D1):
- `reduceAutoDial`, `AutoDialState`, `AutoDialEvent`, `describeAutoDial` e `AUTO_DIAL_COUNTDOWN_SECONDS` (`activities/utils/auto-dialer.ts`);
- `sessionOfThisDial`, `nextRamalAttempt`, `LOCAL_SESSION_GRACE_MS`, `SESSION_MISSING_MESSAGE`, `RAMAL_BUSY_WAIT_MESSAGE` e `RAMAL_BUSY_PAUSE_MESSAGE` (`activities/utils/power-dialer-webphone-sync.ts`).

**Não** importar: `pickNextAutoDial`, `decideAfterNoAnswer` e `availablePhones`. São por número e por fila de cadência (pesquisa §3). A escolha é do servidor.

### 3.2 Servidor do Cockpit

| Arquivo | Conteúdo |
|---|---|
| **novo** `features/cockpit/services/cockpit-auto-dial-flag.ts` | `COCKPIT_AUTO_DIAL_FLAG='cockpit_auto_dial'`, `COCKPIT_AUTO_DIAL_LIVE_FLAG='cockpit_auto_dial_live'`, `isCockpitAutoDialEnabled(scope)` e `isCockpitAutoDialLive(scope)` via `isScopedFlagEnabled`, no mesmo molde de `cockpit-cold-order-flag.ts:1-12`. `isCockpitAutoDialEnabled` só devolve `true` se `call_cockpit_outcomes` também estiver ligada para o escopo (reusa `isCallCockpitOutcomesEnabled`, `cockpit-outcomes-flag.ts`; CON-6). Erro de leitura = desligada (NFR-4) |
| **novo** `features/cockpit/services/cockpit-auto-dial.service.ts` (+ teste) | `pickAutoDialLead({ viewer, now, excludeLeadIds, simulatedAttempts? })`:<br>1. RPC com overrides (§1);<br>2. filtro `isLeadEligible`;<br>3. `contact_holds` `total`/`prospeccao` dos que restaram;<br>3b. tira quem tem ligação **atendida hoje** (`calls.answered_at` ≥ início do dia BRT, qualquer origem; FR-9b, pontos 3 e 7). É uma consulta em blocos de até 100 ids, como a de bloqueios;<br>4. sinais dos `maybe_hot` (reusa `loadSignalsInChunks` + `rankLeadsByPriority`);<br>5. `pickCockpitLead` (`utils/next-call-pick.ts:17-22`).<br>Devolve `picked{leadId,tier}`, `waiting{until}` ou `empty`. No modo simulado, `simulatedAttempts` (leadId → horários) soma às contagens, porque não há linha em `calls`.<br><br>`checkDialGate({ viewer, leadId, now, live })`. Recusa, nesta ordem e falhando fechado:<br>• flags do motor (`cockpit_auto_dial` + `call_cockpit_outcomes`);<br>• janela e feriado (`isWithinDialWindow`);<br>• teto: `count` em `calls` com `user_id = SDR`, `started_at >= início do dia BRT` e `metadata ? 'cockpit_auto_dial'`. Conta **só** as ligações do motor (ponto 2 em `decisoes.md`). Usa `idx_calls_org_user`;<br>• lead na carteira do SDR (`canViewLead`, `call-context.service.ts:113`);<br>• `contact_holds` `total`/`prospeccao` **de novo** (FR-10);<br>• ligações do lead hoje < 3 (qualquer origem, inclusive atendidas) e última há ≥ 1 h (FR-4/5);<br>• lead sem ligação atendida hoje (FR-9b).<br>Devolve `ok` ou `{ code: 'outside_hours'\|'holiday'\|'daily_cap'\|'held'\|'attempts'\|'gap'\|'answered_today'\|'not_owner'\|'flag_off'\|'error' }`. |
| **alterar** `features/cockpit/services/next-call-card.service.ts` (+ teste) | **Só extração**, sem mudar o comportamento:<br>• `export` de `loadSignalsInChunks`;<br>• extrair `buildNextCallCardForLead(viewer, leadId, now, priority)`, a parte que monta contexto, abordagem e `toPriorityView`, para o motor montar o cartão do lead escolhido.<br>Os testes atuais (`next-call-card.service.test.ts`, `-priority`, `-cold-order`) continuam verdes sem alteração. |
| **novo** `features/cockpit/actions/auto-dial.ts` (+ teste), `'use server'`, toda action começa por `getAuthOrgIdResult()` → Zod → flag | **`getNextAutoDialCardAction({ excludeLeadIds, simulatedAttempts? })`**: `pickAutoDialLead` + `buildNextCallCardForLead`. Devolve `{ card, live }`, `{ waiting: until }` ou `{ empty }`.<br><br>**`dialAutoLeadAction({ leadId })`**:<br>1. `checkDialGate`;<br>2. o telefone do decisor é lido **no servidor** (nunca vem do navegador);<br>3. sem `cockpit_auto_dial_live`, devolve `{ simulated: true }` e **não** chama a API4COM;<br>4. com a flag, chama `initiateApi4ComCall({ phone, leadId })` (import de `features/calls/actions/initiate-api4com-call.ts`);<br>5. em seguida `mergeCallsMetadata(callId, { cockpit_auto_dial: { attempt_no, started_at } })` e `armCockpitCallOutcome` (serviço do Cockpit, `call-outcome.service.ts:80`), para a IA sugerir com `hold_low_confidence`;<br>6. devolve `{ callId, providerCallId: api4comId, attemptNo }` ou `{ code: 'ramal_busy' }`, repassado de `originate-api4com-call.service.ts:161`.<br><br>**`resolveAutoDialNoAnswerAction({ callId })`**:<br>• relê a linha (dona = SDR, `hangup_cause` preenchido e `answered_at` nulo);<br>• conta as ligações do lead hoje;<br>• se for a 3ª, chama `applySdrCallResult({ sdrOutcome: 'no_answer', via: 'webphone', clientDurationSeconds: 0 })` (FR-7);<br>• senão não grava nada (FR-6).<br>Não chama `completeDialerCall` (que avança a cadência, D6).<br><br>**`confirmAutoDialOutcomeAction({ callId, disposition, notes? })`**: dona = SDR, `disposition ∈ DISPOSITION_OPTIONS` (`features/calls/disposition.ts:56`), `applySdrCallResult({ sdrOutcome: disposition, via: 'webphone' })`. Ela sobrescreve o que a IA tiver gravado (`apply-sdr-call-result.ts:89`) e não avança a cadência (FR-9). |

### 3.3 Laço no navegador

**Novo** `features/cockpit/hooks/use-cockpit-auto-dial.ts` (+ teste de tela). É o laço **copiado** de `PDT:164-895` e reduzido ao Cockpit:
- `useReducer(reduceCockpitAutoDial)`;
- tick de 1 s (cópia de `PDT:634-638`);
- efeito de `dialing`:
  1. `prepareWebphoneMicForDial`;
  2. `dialingBlockReason(getWebphoneState())` (`integrations/webphone/webphone-state.ts:238`);
  3. `reserveWebphoneDial` (dialToken);
  4. `dialAutoLeadAction`;
  5. `publishWebphoneDial` + `setWebphoneCallContext({ ..., ownerHandlesResult: true, dialToken })`, para o `WebphonePanel` não abrir o próprio modal (memória `api4com-embedded-webphone`, bloco 3);
- sessão desta aba por `sessionOfThisDial` e `LOCAL_SESSION_GRACE_MS` (cópia de `PDT:299-364`);
- fim pela sessão SIP `ended`;
- atendimento por `useWebphoneLeadAnswer` (`integrations/webphone/useWebphoneLeadAnswer.ts`), com 20 s de limite (FR-16);
- 424 por `nextRamalAttempt` (FR-15);
- `waiting` acorda em `until + 1 s`;
- respostas do servidor: `outside_hours`/`holiday`/`daily_cap`/`empty` viram `blocked`; `held`/`attempts`/`gap`/`answered_today` (situação que mudou entre a escolha e a discagem) viram `next_lead`, com o lead entrando na lista de excluídos;
- lista de excluídos em `useRef<Set>` (FR-17): entram os pulados e, como reforço local, os atendidos nesta sessão. Quem tira o atendido do dia é o **servidor** (FR-9b), e vale mesmo depois de recarregar a página. Os "não atendeu" **não** entram, porque devem voltar após 1 h, e o servidor cuida disso;
- **Parar** = `stop`, sem `hangupCall` (FR-13). Desmontar o componente também equivale a `stop`;
- nunca lê nem grava `localStorage` (FR-1, D8);
- **modo simulado** (`live=false`):
  - troca as etapas 3–5 e a escuta do SIP e do webhook por `simulated-dialer.ts`;
  - não exige webphone registrado;
  - grava as tentativas em `simulatedAttempts` e as envia a `getNextAutoDialCardAction`;
  - `resolve` e `confirm` não chamam o servidor, só toast e `console.warn`.

### 3.4 Tela (Prisma)

| Arquivo | Conteúdo |
|---|---|
| **novo** `features/cockpit/components/CockpitAutoDialBar.tsx` (+ teste) | Botões Iniciar, Pausar, Retomar e Parar, com o texto de `describeCockpitAutoDial`. Selo fixo **"SIMULADO"** quando `live=false`. Motivo do bloqueio ou da pausa sempre visível. `data-testid`: `auto-dial-start`, `auto-dial-stop`, `auto-dial-status` e `auto-dial-simulated` |
| **novo** `features/cockpit/components/AutoDialOutcomeConfirm.tsx` (+ teste) | Aparece em `awaiting-sdr`. Mostra o desfecho sugerido pela IA (lido pelo mesmo polling de `getCockpitCallOutcome`), já marcado, com as opções de `DISPOSITION_OPTIONS` e o botão "Confirmar e seguir".<br>• O SDR pode confirmar sem esperar a IA (ponto 4 em `decisoes.md`).<br>• O motor só segue com o clique, mesmo se a IA já tiver gravado com confiança alta (ponto 5). Nesse caso a opção da IA vem marcada, e trocar regrava `sdr_disposition`. |
| **alterar** `features/cockpit/components/NextCallCard.tsx` (+ teste) | Nova prop `autoDial?: { enabled: boolean; live: boolean }`. Com o motor ligado, o cartão mostra o `card` vindo do hook (não do servidor da página), esconde "Ligar agora" e "Próxima ligação" e monta a barra e a confirmação. Com `enabled=false` fica **idêntico** ao atual (teste de regressão) |
| **alterar** `app/(app)/cockpit/page.tsx` | Lê `isCockpitAutoDialEnabled` (que já inclui `call_cockpit_outcomes`) e `isCockpitAutoDialLive` **com escopo** (`{ orgId, userId }`) e passa `autoDial` ao cartão. Não corrigir aqui o achado da `page.tsx:77`, que lê outra flag sem escopo: é outro assunto |
| **alterar** `features/cockpit/types.ts` | Tipos `AutoDialCardResult`, `AutoDialGateCode` e `AutoDialView` |

## 4. Segurança

- **Toda trava no servidor**, em `checkDialGate`, a cada discagem. O navegador não consegue pular a janela, o teto, o bloqueio nem as tentativas (NFR-3).
- **Falha fechada:** erro ao ler a flag, o bloqueio ou a contagem = não disca (NFR-4).
- **Telefone e dono resolvidos no servidor:** o navegador só manda `leadId`. A ação confere `canViewLead` e `calls.user_id` antes de gravar desfecho.
- **Service role** só dentro do serviço, com `org_id` em toda consulta (mesmo padrão de `pickWithColdOrder`, `next-call-card.service.ts:186-188`).
- **Ligação real exige 3 flags** (`call_cockpit_outcomes`, `cockpit_auto_dial` e `cockpit_auto_dial_live`) e o clique de Iniciar. Simulado é o padrão.
- `calls.status` nunca é escrito (NFR-5).
- O modo simulado não cria linha em `calls`. Assim não suja o BI do Sales Hub, que sincroniza `calls` (memória `calls-bi-sync-path`).

## 5. Testes

1. **Puros** (Vitest), cobrindo:
   - janela: sexta 19:59:59 libera, 20:00:00 bloqueia, sábado bloqueia, sexta 20/11/2026 (feriado) bloqueia com o motivo `holiday`;
   - atendido hoje (qualquer origem) fica fora; tentativa atendida conta para as 3;
   - tentativas (2 libera, 3 bloqueia);
   - intervalo (59 min bloqueia, 60 libera);
   - teto (99 libera, 100 bloqueia);
   - o redutor do Cockpit, com cada transição da spec §3, em especial "atendeu leva a `awaiting-sdr`";
   - o discador simulado.
2. **Serviço e actions** (mocks no padrão de `tests/mocks/supabase.ts`):
   - flag desligada recusa sem tocar em `calls`. Vale para cada uma: `cockpit_auto_dial` desligada, e também `call_cockpit_outcomes` desligada com `cockpit_auto_dial` ligada;
   - o teto conta só linhas com `metadata.cockpit_auto_dial`: 100 ligações da Execução não bloqueiam;
   - confirmar antes da IA funciona; com a IA já aplicada, o motor continua parado até o clique;
   - sem `live`, `initiateApi4ComCall` **nunca** é chamada e não há `insert` em `calls` (asserção explícita);
   - cada `code` do gate;
   - erro de leitura do bloqueio recusa;
   - não atendida na 3ª grava `no_answer` e na 1ª/2ª não grava;
   - confirmar não chama `completeDialerCall`.
3. **Tela com relógio falso**, no molde de `PowerDialerTab.auto.test.tsx:30-197` (mocks do `webphone-client`, `useWebphoneLeadAnswer`, sessão SIP com dialToken, `vi.useFakeTimers`, avançando 1 s por `act`). Roteiros:
   - Iniciar → 5 s → disca → não atende → próximo;
   - atende → pausa até Confirmar;
   - 424 → 1 nova tentativa → pausa;
   - Parar no meio da ligação não chama `hangupCall`;
   - recarregar começa Desligado.
4. **Regressão do cartão:** `NextCallCard.test.tsx` passa sem mudanças com `autoDial` ausente.
5. **Banco:** `EXPLAIN ANALYZE` da RPC com `p_daily_cap=3` e `p_cold_limit=1000` na carteira de 533 (só leitura), resultado anotado no PR.
6. **Portão do diff da Execução e dos módulos compartilhados** (obrigatório no PR; ponto 10 em `decisoes.md`). Bloqueia qualquer arquivo alterado em `src/features/activities/**`, `src/features/calls/**` ou `src/features/integrations/webphone/**`:
   ```bash
   git diff --name-only main...HEAD | grep -E '^src/features/(activities|calls|integrations/webphone)/' && echo "PROIBIDO" && exit 1
   pnpm exec vitest run src/features/activities src/features/calls src/features/integrations/webphone   # verdes, sem arquivo alterado
   ```
7. `pnpm typecheck && pnpm lint && pnpm test:run && pnpm build`.

## 6. Etapas: situação em 16/11 e etapas finais em ordem

### 6.1 O que já está feito
Tudo no working tree da branch `feat/cockpit-motor-automatico`, **não commitado** (git status de 16/11).

| Etapa | Situação | Prova |
|---|---|---|
| E0: PR #641 no ar | ✅ mesclado (`80f8d882`). RPC em produção; `cockpit_cold_order` com a V4 em `allow_org_ids` | git log; SELECT `app_flags` |
| E1: migration das 3 flags | ✅ **escrita, NÃO aplicada**: `supabase/migrations/20261116010000_cockpit_auto_dial_flags.sql`. Nenhuma das 3 linhas existe em `app_flags` | SELECT de 16/11 |
| E2–E6: regras, máquina, simulado, serviço, actions, hook | ✅ escritas: `auto-dial-rules.ts`, `cockpit-auto-dial-machine.ts`, `simulated-dialer.ts`, `cockpit-auto-dial*.service.ts`, `actions/auto-dial.ts`, `hooks/use-cockpit-auto-dial.ts` (+ testes) | git status |
| E7 / E7b: barra, confirmação, cartão com motor e painel lateral | ✅ escritos: `CockpitAutoDialBar.tsx`, `AutoDialOutcomeConfirm.tsx`, `NextCallCardWithEngine.tsx` (cartão completo parado e tela limpa rodando, M-3), `MotorLeadSidePanel.tsx` | git status; `NextCallCardWithEngine.tsx:34,84-133` |
| `concludeExternally` (M-2, M-7) | ✅ escrito: `utils/external-conclusion.ts` + hook (+ testes `*.external.test.*`, `auto-dial.conclude.test.ts`) | git status |

Fora do Atlas: não rodei os testes (só leitura). A situação verde ou vermelha é conferida em F6.

### 6.2 Etapas que faltam, na ordem

| # | Etapa | Quem | Depende de | Exige aprovação do usuário? |
|---|---|---|---|---|
| F1 | Teto 100 → **400** em `AUTO_DIAL_RULES.dailyCap` (`utils/auto-dial-rules.ts:16`) + testes | Forge (**Haiku**) | — | não |
| F2 | **Regra de conversa real** (§10): função pura `isRealConversationToday`, troca de `answeredToday` por `conversationToday` no serviço e no portão, testes com os casos da spec §10.1 | Forge | — | não |
| F3 | **Verificar** (só leitura) o que acontece ao agendar reunião ou desqualificar um lead `unqualified` (reabre? conta "lead aberto"?). O resultado volta ao Orquestrador | Forge | — | só se exigir mudança fora do Cockpit |
| F4 | **Retornos no topo** (A-D2, FR-23): leitura de `scheduled_activities` no `pickAutoDialLead`, exceção no portão, conclusão do retorno pelo import de `features/activities/actions/complete-scheduled-activity.ts` (só import) | Forge | F2 | não |
| F5 | **Contexto e extras do card**: origem, `lost_at`, motivo e notas da perda, "Último SDR que ligou" (A-D7), hora de início (FR-24); nota padrão (A-D9, FR-25); 424 a cada 5 s por até 1 min (A-D11, cópia própria de `nextRamalAttempt` no Cockpit); pular 422 (A-D12) | Forge (dados e regras) + Prisma (exibição no `MotorLeadSidePanel`) | E7b | não |
| F6 | **Fila de recuperação, parte SQL** (§12): migration da função nova `cockpit_recovery_candidates` + EXPLAIN (só leitura) + `pnpm gen:types`. A ordem depende de **D-14** | Forge | D-14 | **sim:** aplicar a migration em produção |
| F7 | **Fila de recuperação, parte TS**: `queue: 'carteira' \| 'recuperacao'` nas actions e no serviço; portão aceita `unqualified` só nessa fila | Forge | F2, F6 escrita (a aplicação vem antes do merge) | não |
| F8 | **Aba Discador** (§11) + métricas na barra (A-D10, FR-26) + seletor de fila | Prisma | E7b, F5, F7 | não |
| F9 | Portão do diff (`activities`, `calls`, `webphone`) + `pnpm typecheck && pnpm lint && pnpm test:run && pnpm build` | Forge (**Haiku** roda o script) | F1–F8 | não |
| F10 | Revisão | Sentinela | F9 | não |
| F11 | Commit(s) e PR | Tronco, **só sob pedido explícito** | F10 | **sim:** pedido de commit, push e PR |
| F12 | Aplicar as migrations (flags do E1 + função do F6) **antes do merge** | Forge via MCP | F11 | **sim:** migrations em produção |
| F13 | Piloto **simulado**: `call_cockpit_outcomes` + `cockpit_auto_dial` com `allow_user_ids = [Vini]` | usuário autoriza; Forge acompanha | F12 + deploy | **sim:** ligar flags |
| F14 | Ensaio **real**: Vini em `cockpit_auto_dial_live`, lead Mercante Net. **Data em aberto** (ponto 9) | só com aprovação | F13 | **sim:** ligação real |

**Resumo do que exige aprovação do usuário:**
1. D-14;
2. commit, push e PR (F11);
3. aplicar as 2 migrations em produção (F12);
4. ligar as flags do piloto (F13);
5. ligação real e a data dela (F14).

### 6.3 Tabela original de 15/11 (histórico)

| # | Etapa | Quem | Haiku 5.5? | Aceite |
|---|---|---|---|---|
| E0 | PR #641 sai do rascunho e vai ao ar (CON-1) | usuário / Tronco (git só sob pedido) | — | `cockpit_cold_order` no ar para a V4 |
| E1 | Migration das 3 flags (§2): `call_cockpit_outcomes`, `cockpit_auto_dial` e `cockpit_auto_dial_live`. Aplicada antes do merge, só com ok do usuário | Forge | **sim** (arquivo de modelo) | 3 linhas em `app_flags`, todas `enabled=false`, `allow_org_ids` e `allow_user_ids` vazios |
| E2 | `auto-dial-rules.ts` + testes | Forge | **sim** (regras e tabela de casos) | testes da §5.1 verdes |
| E3 | `cockpit-auto-dial-machine.ts` + `simulated-dialer.ts` + testes | Forge | não | transições da spec §3 cobertas |
| E4 | `cold-lead-order.ts` (overrides) + extração em `next-call-card.service.ts` | Forge | não | testes atuais do cartão inalterados e verdes |
| E5 | Serviço do motor + actions + EXPLAIN | Forge | não | §5.2 verde; EXPLAIN dentro de NFR-1 (senão opção B, que volta ao usuário) |
| E6 | Hook `use-cockpit-auto-dial` + teste com relógio falso | Forge | não | §5.3 verde |
| E7 | Barra, confirmação, cartão e página | Prisma | parcial (textos e `data-testid`) | §5.4 verde; tela revisada pelo usuário por descrição ou print antes de fechar (lição de 22/10) |
| E8 | Portão do diff + checklist pós-implementação | Forge | **sim** (rodar o script) | §5.6 e §5.7 verdes |
| E9 | Revisão | Sentinela | não | Sem achado CRITICAL/HIGH. Confere o gate no servidor, a falha fechada, o dono da ligação e que nada mudou em `activities/**`, `calls/**` e `integrations/webphone/**` |
| E10 | Commit e PR | Tronco, **só com pedido explícito** | — | — |
| E11 | Piloto **simulado** em produção: `call_cockpit_outcomes` e `cockpit_auto_dial` com `allow_user_ids = [Vini]`. `cockpit_auto_dial_live` continua vazia | usuário autoriza; Forge acompanha | — | Selo "SIMULADO" visível e nenhuma linha nova em `calls` pelo motor. Métricas da spec §7 sem violação em 1 dia |
| E12 | Ensaio **real**: acrescentar o Vini em `cockpit_auto_dial_live`, lead Mercante Net (`969ea854`), em horário comercial. **Data em aberto** (ponto 9) | **só com aprovação explícita** | — | 1 não atendida, 1 atendida com confirmação, sem ligação fora da regra |

## 7. Rollback

- **Só a ligação real:** tirar o usuário de `cockpit_auto_dial_live`. O motor volta a simulado. É o primeiro passo em caso de dúvida.
- **Motor fora do ar:** tirar o usuário de `allow_user_ids` de `cockpit_auto_dial`. O botão some na próxima carga e as actions recusam no servidor. O painel de resultado do cartão manual continua (`call_cockpit_outcomes`).
- **Painel de resultado fora do ar:** tirar o usuário de `call_cockpit_outcomes`. Isso desliga também o motor (CON-6), e o cartão volta ao "Ligar agora" de hoje, sem painel nem "Próxima ligação" (`NextCallCard.tsx:182`).
- Nada disso mexe em `call_priority_v2`, `cockpit_cold_order` nem na Execução (CON-5).
- Código: reverter o PR do motor. As linhas de flag podem ficar (desligadas, inofensivas).
- Opção B (se usada): a função nova pode ficar no banco sem uso. Migrations só vão para frente.

## 8. Riscos técnicos

| Risco | Mitigação |
|---|---|
| A Execução muda `reduceAutoDial` ou `power-dialer-webphone-sync` | O teste do redutor do Cockpit trava o comportamento esperado e quebra na hora se a base mudar |
| RPC com `p_cold_limit=1000` fica lenta | EXPLAIN na E5; opção B como plano B |
| Duas abas do mesmo SDR com o motor | O webphone já detecta "ramal em uso em outra aba" (`sessionConflict`, `webphone-state.ts:46`), e `dialingBlockReason` pausa o motor |
| Execução e Cockpit discando juntos no mesmo ramal | A contagem de qualquer origem (FR-4/5) e `dialingBlockReason` com ligação em curso pausam o motor |
| A IA não chega (sem gravação, cron expira em 2 h) | FR-9: o SDR confirma sozinho |
| Corrida: o lead é bloqueado entre a escolha e a discagem | O gate na discagem (FR-10) |

## 9. Decisões fechadas e ponto em aberto

Fechadas em `decisoes.md` ("Confirmadas depois do plano técnico" e "Adotadas pela recomendação do Atlas"). Onde cada uma entra no plano:

| # | Decisão | Onde |
|---|---|---|
| 1 | Feriados bloqueiam | `isWithinDialWindow` (§3.1), gate (§3.2), testes (§5.1) |
| 2 | O teto conta só ligações do motor (valor **400**, M-6) | gate, `metadata.cockpit_auto_dial` (§3.2), teste (§5.2), F1 |
| 3 | ~~Atendido sai do dia~~ → **conversa real** sai do dia (M-1, 16/11) | §10, F2 |
| 4 | Confirmar antes da IA | `AutoDialOutcomeConfirm` (§3.4), teste (§5.2) |
| 5 | Sempre com clique | `AutoDialOutcomeConfirm` (§3.4), estado `awaiting-sdr` (§3.1) |
| 6 | Nada começa a partir das 20:00:00 | `isWithinDialWindow` (§3.1) |
| 7 | Tentativa de qualquer origem, inclusive atendida | gate e filtro (§1, §3.2) |
| 8 | 3 flags na mesma migration | §2, E1, E11, rollback (§7) |
| 10 | `calls/**` e `integrations/webphone/**` proibidos | §0, portão (§5.6), E9 |

Decisões de 16/11 (M-0 a M-7 e as adotadas A-D2, A-D4, A-D5, A-D7, A-D8, A-D9, A-D10b, A-D11b e A-D12): ver `spec.md` §10.0. Elas entram em F1–F8.

**Em aberto:**
- **D-14**: ordem da recuperação (2 opções em `spec.md` §10.4);
- **ponto 9**: data do ensaio real (F14).

## 10. Mudança da regra C-3: "conversa real" (F2)

**O que existe hoje no código:**
- `answeredToday = data.some((c) => c.answered_at != null)` (`services/cockpit-auto-dial.service.ts:71`);
- a consulta "atendida hoje" com `.not('answered_at','is',null)` (`:155-160`);
- a recusa `answered_today` em `evaluateLeadEligibility` (`utils/auto-dial-rules.ts:140`).

**Mudança (só arquivos do Cockpit):**
1. **Novo, puro:** `utils/real-conversation.ts` com `isRealConversation(call)`, seguindo a ordem da spec §10.1:
   - `sdr_disposition` em `{relevant_conversation, answered_no_progress, callback_requested}` → sim; em `{voicemail, no_answer, technical_failure}` → não;
   - sem ela, a mesma decisão por `metadata.ai_outcome.disposition`;
   - sem as duas, `isConnectedCall` (import de `features/calls/connection.ts:102`; só import), que já exige `answered_at`, 50 s ou mais e não-caixa-postal.
   - Os conjuntos de desfechos são constantes **do Cockpit**, e os valores vêm de `DISPOSITION_OPTIONS` (`features/calls/disposition.ts:56`).
2. **`loadLeadCallStats` e a consulta em blocos do `pickAutoDialLead`:**
   - passam a ler `answered_at, duration_seconds, status, sdr_disposition, hangup_cause, recording_url, metadata->ai_outcome`;
   - trocam `answeredToday` por `conversationToday = calls.some(isRealConversation)`;
   - o código de recusa muda de `answered_today` para `conversation_today`, com a mensagem "Lead já conversou hoje".
3. **Caixa postal confirmada pelo SDR** (`voicemail` em `AutoDialOutcomeConfirm`):
   - o motor segue;
   - o lead volta depois de 1 h, enquanto `callsToday < 3`.
4. **Testes:** caixa postal de 7 s com `answered_at` (volta); conversa marcada de 30 s (sai); sem desfecho com 55 s (sai); sem desfecho com 40 s (volta); falha técnica com 60 s (volta).
5. **Limite** (spec §10.1): fora do motor e sem desfecho, a decisão é pela duração. Cerca de 8% das caixas postais longas saem do dia por engano, e cerca de 40% das conversas curtas não são vistas.

## 11. Aba "Discador", desenho mínimo (F8)

**Arquivos (todos do Cockpit):**

| Arquivo | Mudança |
|---|---|
| `features/cockpit/types.ts:1` | `COCKPIT_TABS` ganha `'discador'`. `parseCockpitTab` (`utils/cockpit-target.ts:21-23`) já aceita qualquer item da lista, sem outra mudança |
| `features/cockpit/components/CockpitShell.tsx:91-97` | O link fixo "Discador" (`href="/atividades?tab=dialer"`) vira uma aba normal, `hrefFor({ tab: 'discador' })`, com o mesmo ícone `Phone`. **A Execução não é tocada:** só some o atalho do Cockpit para ela. O gestor continua chegando ao Power Dialer pelo menu lateral de Atividades (escondido do SDR desde o #640) |
| `app/(app)/cockpit/page.tsx:62-98` | `tab === 'discador'` renderiza o `NextCallCardWithEngine` (se as flags estiverem ligadas para o usuário; senão, aviso "Discador indisponível") e mais nada da aba Tarefas. Nas abas `tarefas`/`leads`/`closers`, volta o `NextCallCard` manual de antes (sem `autoDial`) |
| **novo** `features/cockpit/components/DiscadorTab.tsx` | Layout da tela limpa:<br>• **topo:** seletor de fila "Minha carteira" ou "Recuperação de perdidos" (some se F7 não estiver pronto) + `CockpitAutoDialBar` com as métricas (FR-26);<br>• **centro:** `NextCallCardWithEngine` (parado = cartão completo; rodando = estado curto, M-3);<br>• **lateral:** `MotorLeadSidePanel` (E7b), que já abre só com o lead na linha |
| `CockpitAutoDialBar.tsx` | Métricas do dia: hoje mostra só "Ligações do motor nesta sessão" (`:75`). Passa a receber um resumo vindo de uma action nova de leitura (`getAutoDialDayStatsAction`) |

**O que sai do cartão atual:**
- o motor deixa de aparecer nas abas Tarefas, Meus Leads e Closers (`page.tsx:62-63`), que voltam ao cartão manual;
- o "Ver dados do lead" e o painel ficam só na aba Discador.

**Reuso:** `useCockpitAutoDial`, `NextCallCardWithEngine`, `CockpitAutoDialBar`, `AutoDialOutcomeConfirm`, `MotorLeadSidePanel` e `concludeExternally`, todos sem reescrita. A aba entra **depois** do E7b do Prisma.

## 12. Fila "Recuperação de perdidos", função SQL nova (F6/F7)

**Proposta de migration** (escrita na F6, aplicada **só com aprovação** na F12): `supabase/migrations/YYYYMMDDHHMMSS_cockpit_recovery_candidates.sql`.

- **Assinatura:** `public.cockpit_recovery_candidates(p_org_id uuid, p_target_user_id uuid, p_exclude_lead_ids uuid[] DEFAULT '{}', p_now timestamptz DEFAULT now(), p_blocked_reason_names text[] DEFAULT ARRAY['Blocklist','Adolescente/Criança'], p_attempts_window_days int DEFAULT 30, p_limit int DEFAULT 1000)`.
- **Devolve:** `lead_id`, `lost_at`, `loss_reason_name`, `calls_today`, `last_call_at`, `attempts_window` e `recovery_rank` (ordem de D-14).
- **Filtros:**
  - `org_id`; dono (`assigned_to` ou `closer_id` = `p_target_user_id`);
  - `status='unqualified'`, `lost_at IS NOT NULL`, `deleted_at IS NULL`, telefone não vazio;
  - sem `contact_holds` `tipo IN ('total','prospeccao')`;
  - motivo fora de `p_blocked_reason_names`, comparando por **nome** em `loss_reasons` da org (A-D5);
  - sem conversa real em `calls` com `created_at >= lost_at`, usando a mesma regra de §10 em SQL: desfecho do SDR, senão da IA, senão `answered_at` + 50 s ou mais + não-caixa-postal (A-D4).
  - A regra fica duplicada em SQL e em TS. Um teste de integração no molde de `cockpit-next-call-candidates.test.ts` compara as duas.
- **Segurança, no mesmo padrão do #641:**
  - `LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''`;
  - `REVOKE ALL ... FROM PUBLIC, anon, authenticated` e `GRANT EXECUTE ... TO service_role`;
  - função **nova** (não é uma sobrecarga da `cockpit_next_call_candidates`, M-5);
  - `pnpm gen:types` no mesmo PR.
- **Desempenho:** EXPLAIN (só leitura) na maior carteira de perdidos (1.786), com a mesma meta de NFR-1 (até 1 s).
- **TS (F7):**
  - `pickAutoDialLead({ queue })` chama a função certa;
  - as regras de `auto-dial-rules.ts` valem igual nas duas filas;
  - o portão (`checkDialGate`) aceita `status='unqualified'` **só** com `queue='recuperacao'` e `lost_at` preenchido. Hoje recusa sempre (`services/cockpit-auto-dial.service.ts:39,260`);
  - retornos (F4) valem nas duas filas;
  - o teto de 400 soma as duas.
