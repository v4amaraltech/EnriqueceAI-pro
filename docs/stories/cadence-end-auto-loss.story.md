# Story: Auto-perda também para quem termina a cadência (fim do limbo)

## Status
Ready for Review

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-09 | @architect (Aria) | **Quality gate: CONCERNS** (aprovado). 7 checks revisados com verificação independente em prod: grants reconferidos (`{postgres, service_role}`, e os advisors não listam a função), performance medida (52 ms → 153 ms), 0 candidatos com reunião marcada. 4 observações: SEC-001 (incidente de grant — resolvido dentro do ciclo), SEC-002 (42 funções SECURITY DEFINER com o mesmo padrão — fora do escopo), OBS-001 (contador de log infla — dívida), OBS-002 (**avisar o gestor**: taxa de perda da "Inbound — E-mail (auto)" vai subir nos gráficos). Nada bloqueante para o deploy. |
| 2026-09-09 | @dev (Dex) | InProgress → **Ready for Review**. Migration aplicada em prod (`20260909184311`, 18:43 UTC): sem args = 3 candidatos (idêntico ao anterior), com `true` = 15 (3 ativos + 12 parte B). **Incidente de grant achado e corrigido em ~2 min** (`20260909184517`) — ver nota 8 do Dev Agent Record. `pnpm gen:types` OK (diff de 2 linhas). typecheck ✅ lint ✅ 1891 testes ✅ build ✅. Deploy do código ainda NÃO feito — o RPC está inerte até lá. Nada commitado. |
| 2026-09-09 | @dev (Dex) | Ready → **InProgress**. Migration escrita + ensaiada em prod (BEGIN…ROLLBACK sob nome temporário, prod intocado): não-regressão provada (3 = 3, diferença 0), parte B = 12 candidatos, 0 vazamento de status, 0 duplicados. Código implementado com teto de 25/org. typecheck ✅ lint ✅ 1891 testes ✅ (+11 novos) build ✅. **Bloqueado em T1b** — aplicar a migration em prod precisa de autorização do usuário; T4 (`gen:types`) depende dela. CodeRabbit não rodou (login interativo). Nada commitado (regra git manual). |
| 2026-09-09 | @po (Pax) | Validação 10 pontos: **GO 9/10** → Draft → Ready. Ajustes aplicados: (a) `quality_gate` `@qa` → `@architect` (regra 1.1 da task: gates válidos são @architect/@dev/@pm; padrão dominante do repo); (b) **janela de risco de deploy eliminada** — RPC ganha parâmetro `p_include_completed boolean DEFAULT false`, para a migration poder ir antes do código sem ativar a parte B (ver Dependencies); (c) seções `Dependencies`, `Risks`, `Dev Agent Record` e `QA Results` adicionadas por template compliance. |
| 2026-09-09 | Vini + Claude | Story criada a partir da investigação do filtro "Contatado + Sem cadência" do Ismael (73 leads). Correção da regra + drenagem do passivo. |

## Executor Assignment
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["vitest", "typecheck", "lint"]

> Nota do PO: a T1 é migration (`CREATE OR REPLACE` de função, sem DDL de tabela). Fica com @dev por ser majoritariamente lógica de negócio, **desde que** o Checkpoint 1 (`.claude/rules/dev-checkpoints.md`) seja executado antes de escrever o SQL. Se a T2 revelar necessidade de mudança estrutural, escalar para @data-engineer.

## Origem

Investigação de 09/set/2026, disparada pela tela de Leads filtrada em **Contatado + Sem cadência + Responsável Ismael = 73 leads**.

**O auto-perda NÃO está quebrado.** Ele roda todo dia às 7h (jobid 44, 10/10 execuções OK nos últimos 10 dias) e perdeu 5 leads em 09/set, 10 em 08/set, 24 em 05/set, 46 em 02/set. As cadências têm a config certa: Inbound / Inbound — E-mail (auto) / Inbound 2.0 com **21 dias + motivo**, Recovery com 14 dias.

**O buraco é outro:** o RPC `fetch_inactive_enrollment_candidates` filtra `WHERE ce.status = 'active'`. O prazo de inatividade é um cronômetro que **só corre enquanto o lead está dentro da cadência**. Quando o motor conclui a cadência (`execute-cadence.ts:354` e `:396` — não há próximo passo → enrollment vira `completed`), o lead sai da cadência ainda como `contacted` e o cronômetro para junto, antes de bater os 21 dias. A partir dali:

- nunca vira `unqualified`, nunca recebe motivo de perda;
- nunca é redistribuído nem agendado na Recovery (`scheduleInboundRecovery` só é chamado para quem o auto-loss perdeu);
- não aparece em fila nenhuma → ninguém é cobrado, não volta sozinho, **fica assim para sempre**.

Ironia da regra atual: quem percorreu a cadência inteira sem responder — o caso mais claro de "Nunca respondeu" — é justamente quem nunca é marcado. Os auto-perdidos de hoje são só os que travaram **no meio** da cadência.

**Caso concreto (73 do Ismael):** em 18/ago 12:59:15 um lote foi migrado da "Inbound" para a **"Inbound — E-mail (auto)"** (limpeza do backlog). Essa cadência tem 4 passos → **78 enrollments concluíram em 26/ago entre 12:05 e 12:21** (levas do cron `*/5`). 67 dos 73 estão com 12–14 dias parados desde então.

**Escala (org V4 Amaral, 09/set):** `v_leads_cadence_limbo` = 120 leads. Quebra por dono do recorte "Contatado sem cadência": Ismael 73, João Fogaça 16, Guilherme 12. O alerta diário existe e funciona ("122 leads em limbo de cadência", 09/set) — mas **só avisa, não age**.

## Story

**As a** gestor de SDRs,
**I want** que o prazo de auto-perda da cadência continue valendo depois que a cadência termina,
**so that** lead que percorreu a régua inteira sem responder seja marcado com o motivo certo e volte pela Recovery, em vez de apodrecer em "Contatado" sem ninguém responsável.

**As a** SDR,
**I want** que a lista "Contatado sem cadência" não acumule lead morto,
**so that** o que sobra ali seja de fato coisa para eu trabalhar.

## Complexity
**M** — 1 migration (`CREATE OR REPLACE` do RPC), 1 action ajustada, teto de lote, testes. Sem mudança de UI.

## Scope

**IN:**

### 1. RPC passa a considerar quem concluiu a cadência

Migration `CREATE OR REPLACE FUNCTION public.fetch_inactive_enrollment_candidates(p_include_completed boolean DEFAULT false)`, virando um `UNION ALL` de duas partes.

**O parâmetro é o que torna o deploy seguro** (ajuste do PO): com `false` — o valor que a chamada atual, sem argumentos, recebe — a função devolve **exatamente o que devolve hoje**. A migration pode então ser aplicada em prod antes do deploy do código, sem ativar nada. A parte B só liga quando o código novo passa `p_include_completed: true`. Sem esse parâmetro haveria uma janela em que o RPC já devolveria candidatos B e o código **antigo** os processaria sem as travas dos itens 2 e 3 — sobrescrevendo `completed_at` e mandando 64 leads para a Recovery de uma vez.

- **Parte A — inalterada:** exatamente a query de hoje (`ce.status = 'active'`). Nada do comportamento atual muda.
- **Parte B — nova:** enrollments `completed`, com **três travas**:
  1. `l.status = 'contacted'` — e só isso. Lead `new` ou `qualified` (reunião marcada) fica de fora, mesmo com cadência concluída.
  2. o lead **não pode ter nenhum enrollment `active` ou `paused`** — senão uma cadência antiga concluída marcaria perdido um lead que está sendo trabalhado em outra.
  3. `DISTINCT ON (ce.lead_id)` ordenado por `ce.completed_at DESC NULLS LAST, ce.enrolled_at DESC` — 1 candidato por lead, sempre o enrollment mais recente, para o **motivo de perda ser o da última cadência** (senão um lead que passou por Inbound + Inbound E-mail auto sairia com motivo arbitrário).

O retorno ganha a coluna **`enrollment_status`** (`active` | `completed`), que o código usa no item 2.

Filtros preservados na parte B: cadência `active`, `deleted_at IS NULL`, `auto_loss_after_days` e `auto_loss_reason_id` não nulos, lead não deletado, prazo = `now() - GREATEST(ce.enrolled_at, última interação) > auto_loss_after_days`.

### 2. Não sobrescrever o histórico do enrollment já fechado

Em `expire-inactive-leads.ts`, o loop que carimba o enrollment hoje faz `status='completed', completed_at=now(), loss_reason_id, loss_notes`. Para candidato que **já estava** `completed`, isso apagaria a data real do fim da cadência e estragaria as métricas de cadência.

- `enrollment_status === 'active'` → comportamento atual, sem mudança.
- `enrollment_status === 'completed'` → **não** tocar em `status` nem em `completed_at`; carimbar `loss_reason_id`/`loss_notes` apenas quando estiverem nulos.

### 3. Teto por org para não criar onda na Recovery

Constante `MAX_COMPLETED_CANDIDATES_PER_ORG_PER_RUN = 25`, aplicada **só aos candidatos da parte B**, ordenados por `inactive_days DESC` (mais parado primeiro). Candidatos da parte A continuam sem teto — o comportamento de hoje não muda.

Motivo, medido: dos 99 leads cobertos pela correção, **64 vencem no mesmo dia (16/set) e os 64 são inbound** → todos iriam para a Recovery de uma vez, com o mesmo `scheduled_start_at`. É exatamente a onda que em 04/set precisou ser espalhada na mão (114 → 38/38/38, backups `_bkp_recovery_spread*`). Com teto de 25 a fila drena em 3 dias sozinha.

Calendário medido dos vencimentos (org V4 Amaral): 04/set 10 · 09/set 2 · 15/set 7 · **16/set 64** · 17/set 1 · 18/set 8 · 21/set 2 · 22/set 3 · 29/set 1 · 30/set 1.

### 4. Log e observabilidade

- `console.warn` final passa a separar as origens: `enrollments_expired=… (ativos=… concluídos=…)`.
- A interaction de auditoria (`metadata.reason = 'auto_loss_inactivity'`) ganha `source: 'cadence_completed' | 'cadence_active'`, para dar para medir depois quanto veio do buraco novo.
- Idempotência atual (skip do insert quando já existe interaction para lead+cadência+motivo) fica como está.

### 5. Drenagem do passivo — sem SQL manual

Com o item 1 no ar, **99 dos 120 leads em limbo drenam sozinhos** em ondas de 25/dia. Não há limpeza em massa, não há backup para criar, não há reversão para escrever. O que sobra exige decisão humana e **não** entra em código:

| Caso | Leads | Encaminhamento |
|------|-------|----------------|
| Coberto pela correção | 99 | Automático, ~4 dias após deploy |
| Pausado (não é fim de cadência) | 19 | Decisão do gestor — ver abaixo |
| Fim de cadência sem auto-loss configurado | 1 | Configurar `auto_loss_after_days` na cadência |
| Nunca teve cadência | 1 | Triagem manual |

Os 19 pausados: 13 "Prospecção Agro — Contato (SDR)" sem dono, pausados em 06/ago (os mesmos deixados de propósito na triagem de ago); 5 "Prospecção Fria" do Guilherme, pausados em 21/ago; 1 "Prospect - Educação", 01/jul. **Ação:** levar a lista ao gestor e decidir retomar ou encerrar — pausa manual não é fim de cadência e não deve ser resolvida por automação.

**OUT:**

- Política de fim de cadência configurável por cadência (campo `on_complete`: perder / voltar para "Novo" / criar tarefa). Fica para uma story própria — aqui o destino é sempre o auto-loss já configurado na cadência.
- Mexer no filtro/UI de "Sem cadência", na `v_leads_cadence_limbo` ou no alerta de limbo.
- Enrollments `paused` (nada despausa sozinho — continua fora do escopo da automação, por decisão).
- Enrollments encerrados como `replied` / `bounced` / `unsubscribed` — saída legítima, não entram na parte B.
- Retroagir motivo de perda em leads já `unqualified`.

## Dependencies

**Ordem de execução (a migration pode ir primeiro, graças ao `p_include_completed`):**

1. T1 aplicada em prod → RPC novo instalado, **inerte** (chamada sem args = comportamento de hoje).
2. T2 confirma a não-regressão com `false` e os números com `true`.
3. Deploy do código (T3) → passa a chamar com `true` e a parte B liga.
4. T4 (`pnpm gen:types`) no mesmo PR do T3 — a assinatura do RPC mudou.

Nada aqui depende de outra story. Depende de o cron **jobid 44** (`expire-inactive-leads`, 7h) continuar ativo e da flag `app_flags.inbound_recovery_enabled` continuar ligada — se estiver desligada, os leads são perdidos normalmente e só não vão para a Recovery.

**Não conflita com** a story `activity-skip-guardrails` (Done) nem com a `supabase-types-regeneration` (Done) — mas herda a regra desta última: `pnpm gen:types` obrigatório no mesmo PR de qualquer mudança de schema/RPC.

## Risks

| Risco | Severidade | Mitigação |
|-------|-----------|-----------|
| Migration ativar a parte B antes do código novo (sobrescreve `completed_at`, onda de 64 na Recovery) | **Alta** | Parâmetro `p_include_completed DEFAULT false` — a parte B só liga pelo código (item 1) |
| Onda de 64 na Recovery em 16/set | Alta | Teto de 25/org/execução (item 3) + AC 6 |
| Perder `completed_at` real do enrollment | Média | Item 2 — não tocar em enrollment já fechado |
| Marcar perdido lead `qualified` com reunião marcada | Média | Trava `l.status = 'contacted'` na parte B + AC 2 |
| Motivo de perda errado (lead com 2 cadências) | Média | `DISTINCT ON` pelo enrollment mais recente + AC 4 |
| Ciclo Recovery → auto-loss → Recovery | Média | Motivo da Recovery não é reativável + AC 8 |
| Volume alto em outras orgs no 1º run | Baixa | Teto é por org; conferir na T2 |
| Regressão no auto-loss que já funciona | Baixa | Parte A intocada + AC 9 + T2(a) |

## Acceptance Criteria

1. **Given** um lead `contacted` cuja última cadência concluiu (`completed`), sem nenhum enrollment `active`/`paused`, e cuja última interação passou do `auto_loss_after_days` da cadência, **when** o cron das 7h roda, **then** o lead vira `unqualified` com o `auto_loss_reason_id` **daquela** cadência e ganha a interaction de auditoria.
2. **Given** o mesmo lead, mas com `status = 'new'` ou `'qualified'`, **when** o cron roda, **then** ele **não** é tocado.
3. **Given** um lead com cadência concluída há mais de 21 dias **e** um enrollment `active` (ou `paused`) em outra cadência, **when** o cron roda, **then** ele não entra pela parte B (só pela parte A, se for o caso).
4. **Given** um lead que passou por duas cadências concluídas com motivos diferentes, **when** o cron roda, **then** o motivo gravado é o da cadência **concluída mais recentemente**.
5. **Given** um candidato cujo enrollment já estava `completed`, **when** o job o processa, **then** `completed_at` e `status` do enrollment permanecem intactos e só `loss_reason_id`/`loss_notes` são preenchidos (e apenas se estavam nulos).
6. **Given** 64 candidatos de parte B na mesma org no mesmo dia, **when** o cron roda, **then** no máximo 25 são processados naquela execução, os mais parados primeiro, e o restante cai nas execuções seguintes.
7. **Given** um lead inbound (Blackbox/Leadbroker) perdido pela parte B com motivo reativável, **when** o job termina, **then** ele é agendado na Recovery pelo caminho que já existe — sem código novo de Recovery.
8. **Given** um lead perdido pela parte B cuja cadência tem motivo **não** reativável (ex.: "Deixou de responder" da Recovery), **when** o job termina, **then** nenhuma Recovery nova é agendada (sem ciclo).
9. **Given** o comportamento atual (enrollments `active`), **when** o cron roda depois do deploy, **then** nada muda: mesmos candidatos, mesmo carimbo, sem teto.
10. **Given** o job rodando, **then** o log final informa quantos vieram de enrollment ativo e quantos de concluído.
11. **Given** a migration aplicada e o código **ainda antigo** em produção, **when** o cron chama o RPC sem argumentos, **then** o retorno é idêntico ao da função anterior (mesma contagem, mesmos ids) e nenhum candidato de parte B aparece.

## Tasks

- [x] **T1a — Migration escrita.** `supabase/migrations/20260909180000_auto_loss_after_cadence_completed.sql`.
- [x] **T1b — Migration aplicada em prod.** ✅ 09/set 18:43 UTC (`20260909184311`) + correção de grant `20260909184517` (ver nota 8).
- [ ] **T1 (original) — Migration do RPC.** `supabase/migrations/<timestamp>_auto_loss_after_cadence_completed.sql`: `CREATE OR REPLACE FUNCTION public.fetch_inactive_enrollment_candidates(p_include_completed boolean DEFAULT false)` com o `UNION ALL`, nova coluna `enrollment_status`, as 3 travas da parte B. Manter `SECURITY DEFINER` + `SET search_path`. `DROP FUNCTION public.fetch_inactive_enrollment_candidates()` antes do `CREATE` (assinatura de retorno e de entrada mudam) e regrant para `authenticated, service_role`.
- [x] **T2 — Ensaio em prod dentro de `BEGIN … ROLLBACK`.** ✅ Passou (números no Dev Agent Record). Duas rodadas: (a) `p_include_completed => false` deve devolver **exatamente** os mesmos candidatos da função atual (prova de não-regressão — comparar contagem e ids); (b) `=> true` deve bater com os números desta story: 99 candidatos B na org, 12 já vencidos, pico de 64 em 16/set, nenhum lead `new`/`qualified`.
- [x] **T3 — `expire-inactive-leads.ts`:** passar `p_include_completed: true` no `.rpc()`, consumir `enrollment_status`, separar A/B, aplicar o teto de 25 na B, não sobrescrever enrollment já fechado, `source` na interaction, log separado.
- [x] **T4 — Regenerar tipos:** ✅ `pnpm gen:types` rodado. Diff cirúrgico (2 linhas): `Args: never` → `{ p_include_completed?: boolean }` e `enrollment_status` no retorno. Commit separado `chore(types): regenerate`.
- [x] **T5 — Testes** — 11 casos novos em `expire-inactive-leads.test.ts`.
- [x] **T6 — `pnpm typecheck && pnpm lint && pnpm test:run && pnpm build`** — todos verdes (1891 testes).
- [x] **T7 — Checkpoints 1 e 2** (`.claude/rules/dev-checkpoints.md`). Checkpoint 3 (deploy) pendente com T1b/T4.
- [ ] **T8 — Pós-deploy:** acompanhar as 3 primeiras execuções (7h BRT) e conferir que a Recovery recebeu ~25/dia, não 64 de uma vez.
- [ ] **T9 — Fora de código:** levar ao gestor a lista dos 19 pausados + 1 sem auto-loss + 1 sem cadência.

## Dev Notes

**Arquivos:**
- `supabase/migrations/<novo>.sql` (RPC)
- `src/features/cadences/actions/expire-inactive-leads.ts`
- `src/features/cadences/actions/__tests__/expire-inactive-leads.test.ts` (ou colocalizado, seguir o padrão do módulo)
- `src/lib/supabase/types.ts` (gerado)

**Contexto que não pode ser perdido:**
- O comentário atual no código diz *"Sem loop: o RPC acima só considera enrollments 'active'…"*. **Esse comentário fica desatualizado com esta mudança** — reescrever explicando a nova garantia: a Recovery é criada `paused` (fora de A e de B), e quando ela mesma conclui, o motivo dela ("Deixou de responder") não está em `reasonNames`, então não reagenda. Sem ciclo.
- Ao ativar a Recovery, o motor volta o lead de `unqualified` para `new` e só então troca o dono (`execute-cadence.ts:227-238`). Como a parte B exige `contacted`, um lead recém-reativado não é candidato até ser efetivamente contatado de novo.
- `markLeadContacted` (`src/features/leads/actions/mark-contacted.ts`) é quem coloca o lead em `contacted` no primeiro envio — não é o culpado aqui, é o comportamento correto.
- A ordem "interaction antes do UPDATE do lead" no loop atual existe por causa do incidente de 12/05 (51 leads perdidos com timeline limpa por timeout). **Não inverter.**

**Riscos:** ver seção `Risks` acima.

**Números de referência (org V4 Amaral, 09/set/2026)** — usar na T2 para validar a migration:

| Medida | Valor |
|---|---|
| `v_leads_cadence_limbo` | 120 |
| Candidatos da parte B | 99 |
| Já vencidos hoje | 12 |
| Pico em 16/set | 64 (todos inbound) |
| Auto-perdidos hoje pela regra atual | 5 |

## Testes

Unitários em `expire-inactive-leads`, mockando o RPC:
1. Candidato `enrollment_status='completed'` → lead vira `unqualified`, enrollment **não** recebe `status`/`completed_at` novos.
2. Candidato `completed` com `loss_reason_id` já preenchido → não sobrescreve.
3. Candidato `active` → carimbo idêntico ao de hoje (teste de regressão).
4. 30 candidatos B na mesma org → só 25 processados, os de maior `inactive_days`.
5. Teto não afeta candidatos A no mesmo lote.
6. Lead perdido pela B com motivo reativável e `lead_source='Blackbox'` → `scheduleInboundRecovery` chamado uma vez.
7. Motivo não reativável → Recovery não chamada.
8. Interaction gravada com `source: 'cadence_completed'`.

9. Chamada do RPC sem `p_include_completed` (compatibilidade) → nenhum candidato de parte B.

Da migration (na T2, em `BEGIN … ROLLBACK`): AC 2, 3, 4 e 11 conferidos por query direta contra dados reais.

## Dev Agent Record

### Agent Model Used
Claude Opus 5 (@dev / Dex) — 09/set/2026. Branch `feat/cadence-end-auto-loss`, criada de `origin/main` (`00021efb`).

### Debug Log References

**Ensaio da migration (T2)** — executado em prod via MCP dentro de `BEGIN … ROLLBACK`, com a função criada sob nome temporário (`_ensaio_fetch_candidates`) para que o RPC de produção não fosse tocado em hipótese alguma. Rollback confirmado depois (0 funções de ensaio remanescentes).

| Medida | Resultado | Cobre |
|---|---|---|
| Candidatos da função atual | 3 | — |
| Candidatos da nova com `false` | 3 | AC 11 |
| Só na atual / só na nova (diferença simétrica de `enrollment_id`) | 0 / 0 | AC 11, AC 9 |
| Parte B (`true`) | 12, todos da V4 Amaral | Bate com a story |
| Candidatos da parte B com lead fora de `contacted` | 0 | AC 2 |
| Leads duplicados na parte B | 0 | AC 4 |

**CodeRabbit:** não rodou — CLI em `/opt/homebrew/bin/coderabbit` responde "Authentication required. Please run 'coderabbit auth login' in an interactive session". Mesma limitação registrada na story `activity-skip-guardrails`. Pendente para @architect no quality gate, ou após login manual.

### Completion Notes List

1. **Ensaio sob nome temporário, não sob o nome real.** A story pedia o ensaio da função nova em `BEGIN … ROLLBACK`. Fazer isso com `DROP FUNCTION` + `CREATE` sobre o nome de produção deixaria uma janela em que, se a sessão do MCP caísse antes do ROLLBACK, o RPC de produção ficaria dropado e o cron das 7h quebraria. Criei sob `_ensaio_fetch_candidates` e comparei as duas lado a lado — mesma prova, risco zero.

2. **`DISTINCT ON` antes do filtro de prazo, não depois.** Se o prazo filtrasse primeiro, um enrollment antigo já vencido "ganharia" de um mais recente ainda dentro do prazo, e o lead sairia carimbado com o motivo da cadência errada. A parte B seleciona o enrollment mais recente por lead numa CTE e só então aplica o prazo.

3. **Grants:** a story pedia regrant para `authenticated, service_role`. O estado real em prod é `{postgres, service_role}` — `authenticated` **não** tem EXECUTE (removido pela migration `20260516160057`). Segui o estado real (só `service_role` + revoke de `anon, PUBLIC`), que é o mais restrito. Conceder a `authenticated` seria alargar permissão sem necessidade.

4. **Guarda extra no carimbo do enrollment fechado:** além de não enviar `status`/`completed_at`, o update de candidato já concluído leva `.is('loss_reason_id', null)`. Assim uma re-execução do job nunca sobrescreve um motivo já gravado.

5. **Log:** o rodapé agora informa também `adiados_pelo_teto`, para dar para ver quanto ainda falta drenar sem consultar o banco.

6. **Comentário "Sem loop" reescrito** em duas camadas, como pedia o Dev Notes — o texto antigo se apoiava justamente na premissa que esta story derruba.

8. **⚠️ Incidente de permissão na aplicação da migration (achado + corrigido em ~2 min).** Ao aplicar `20260909184311` em prod, a conferência pós-aplicação mostrou os grants como `{postgres, authenticated, service_role}` — mas a função anterior tinha só `{postgres, service_role}`. Causa: `DROP FUNCTION` + `CREATE` faz o **default privilege do schema `public` reconceder EXECUTE a `authenticated`**; o REVOKE da migration `20260516160057` não sobrevive ao DROP. Meu REVOKE cobria só `anon, PUBLIC`, então não desfez isso.

   Gravidade: a função é `SECURITY DEFINER` e varre `cadence_enrollments`/`leads`/`interactions` de **todas as orgs, sem filtro de tenant**. Com EXECUTE, qualquer usuário logado de qualquer org poderia enumerar ids de leads e enrollments da base inteira.

   Correção: migration `20260909184517` revogando de `anon, authenticated, PUBLIC`. Grants reconferidos = `{postgres, service_role}`, idêntico ao estado anterior. Janela real: **~2 minutos** (18:43 → 18:45 UTC de 09/09/2026). Nenhuma rota da aplicação chama esse RPC com cliente `authenticated` — só o cron, com service role.

   A `20260909184311` foi corrigida na origem (agora revoga `authenticated` também), para que um ambiente limpo nunca reproduza a falha. **Lição para próximas migrations:** todo `DROP`+`CREATE` de função `SECURITY DEFINER` precisa reafirmar o REVOKE de `authenticated` — não basta a migration histórica.

9. **Timestamps dos arquivos alinhados ao remoto.** O MCP registra a migration com o horário da aplicação, não com o nome do arquivo. Renomeei `20260909180000_…` → `20260909184311_…` para o repo bater com `supabase_migrations.schema_migrations`.

7. **Não commitado** (regra de git manual). A branch tem 2 arquivos modificados de outra frente (`create-checkout.ts`, `supabase/.temp/cli-latest`) que vieram junto do checkout e **não** fazem parte desta story.

### File List

**Novos:**
- `supabase/migrations/20260909184311_auto_loss_after_cadence_completed.sql`
- `supabase/migrations/20260909184517_revoke_authenticated_fetch_inactive_candidates.sql`
- `src/features/cadences/actions/expire-inactive-leads.test.ts`

**Modificados:**
- `src/features/cadences/actions/expire-inactive-leads.ts`
- `src/lib/supabase/types.ts` (gerado — commit separado)
- `docs/stories/cadence-end-auto-loss.story.md`

**Fora desta story** (vieram no checkout, não commitar junto): `src/features/billing/actions/create-checkout.ts`, `supabase/.temp/cli-latest`.

## QA Results

**Gate: CONCERNS** — aprovado, com 4 observações documentadas. @architect (Aria), 09/set/2026.

Nenhum item HIGH/CRITICAL em aberto. Escopo revisado: os 2 arquivos de migration aplicados em prod, `expire-inactive-leads.ts` linha a linha, os 11 testes novos, o estado real do banco pós-migration e os advisors de segurança do projeto.

### 7 checks

| # | Check | Resultado |
|---|-------|-----------|
| 1 | Code review | ✅ Comentários explicam o *porquê*, não o *o quê*. Nenhuma invenção fora do escopo. |
| 2 | Testes | ✅ 11 novos, 1891 no total, verdes. Ver OBS-003. |
| 3 | Acceptance criteria | ✅ AC 1–11. AC 2/3/4/11 provados por query em prod (T2), os demais por teste. |
| 4 | Regressões | ✅ Parte A intocada — diferença simétrica zero entre a função antiga e a nova com `false`, medida em prod. |
| 5 | Performance | ✅ Medi eu mesmo: 52 ms (sem args) → **153 ms** (com `true`). Num cron diário, irrelevante. |
| 6 | Segurança | ⚠️ Ver SEC-001 (resolvido) e SEC-002 (fora do escopo). |
| 7 | Documentação | ✅ Story, comentários e memória do projeto atualizados. |

### SEC-001 — incidente de grant (RESOLVIDO, verificado por mim)

O `DROP`+`CREATE` reconcedeu `EXECUTE` a `authenticated` numa função `SECURITY DEFINER` sem filtro de tenant. Verificação independente agora: `proacl` = `{postgres, service_role}`, idêntico ao estado anterior, e os advisors de segurança do Supabase **não** listam `fetch_inactive_enrollment_candidates` em `authenticated_security_definer_function_executable`. Corrigido de fato.

O tratamento foi o correto: detectado pela conferência pós-aplicação (não pelo `{"success":true}`), corrigido em ~2 min, migration de origem consertada e lição registrada. **Não rebaixo o gate por isso** — o defeito foi encontrado e fechado dentro do próprio ciclo.

### SEC-002 — o mesmo padrão existe em escala (FORA DO ESCOPO, recomendação)

Os advisors do projeto apontam **42 funções `SECURITY DEFINER` executáveis por `authenticated`** e **36 por `anon`**. O incidente desta story mostra que o REVOKE histórico não sobrevive a recriações. Não é regressão desta story e não bloqueia o merge — mas merece auditoria própria, priorizando as funções que leem dados cross-org.

### OBS-001 — `enrollments_expired` infla no log (MEDIUM, dívida)

Para candidato já concluído, o update leva `.is('loss_reason_id', null)`. Se a linha já tiver motivo, zero linhas são afetadas, `error` volta `null` e o contador incrementa mesmo assim. Afeta **só o log** — nenhuma decisão depende desse número. O mesmo padrão já existia no contador de leads. Registrar como dívida; não justifica segurar a story.

### OBS-002 — impacto visível nos gráficos (COMUNICAR ANTES DO DEPLOY)

`loss-reason-analytics.service.ts:50` lê `cadence_enrollments.loss_reason_id` quando o filtro é por cadência. Enrollments concluídos, que antes não tinham motivo, passam a ter. **A taxa de perda atribuída à "Inbound — E-mail (auto)" vai subir** assim que o job rodar.

Isso é o efeito desejado — a perda existia e não estava sendo contada —, mas é uma mudança de número que o gestor vai notar. Avisar antes, para não virar "o gráfico quebrou".

### OBS-003 — cobertura das travas do SQL (BAIXO)

AC 2, 3, 4 e 11 são garantidos pelo SQL e foram validados por query contra dados reais. Não há teste automatizado sobre eles: uma regressão futura no RPC não seria pega pela suíte. Aceitável (a suíte não sobe Postgres), mas quem mexer nessa função precisa repetir o ensaio da T2 — está escrito na story.

### Decisões de implementação que eu endosso

- **Ensaio sob nome temporário** em vez de `DROP` sobre o nome real: correto. A alternativa deixaria o cron das 7h exposto a uma queda de sessão.
- **`DISTINCT ON` antes do filtro de prazo**: correto e sutil. A ordem inversa carimbaria o motivo da cadência errada.
- **Grants só para `service_role`**, contrariando o que a story pedia: correto — a story descrevia um estado que não era o de produção.
- **Teto só na parte B**: correto. Limitar a parte A mudaria o comportamento que já funciona.

### Verificação extra que fiz

Leads candidatos com reunião marcada (`meeting_starts_at`/`meeting_scheduled_at` preenchidos) que seriam perdidos indevidamente: **0**. A trava `l.status = 'contacted'` cobre o caso na prática.

### Condição para o deploy

Nenhuma bloqueante. Recomendo apenas: avisar o gestor sobre OBS-002 antes do deploy, e acompanhar as 3 primeiras execuções do cron (T8) para confirmar ~25/dia na Recovery em vez de 64 de uma vez.

## Definition of Done

- [ ] AC 1–11 verificados
- [ ] Migration aplicada em prod via MCP, com ensaio `BEGIN … ROLLBACK` registrado no Change Log (as duas rodadas da T2)
- [ ] `pnpm gen:types` no mesmo PR, commit separado
- [ ] typecheck + lint + testes + build verdes
- [ ] CodeRabbit (CRITICAL/HIGH resolvidos)
- [ ] 3 execuções pós-deploy acompanhadas, sem onda na Recovery
- [ ] Comentário desatualizado sobre "sem loop" reescrito
- [ ] Lista dos 21 leads de triagem manual entregue ao gestor
