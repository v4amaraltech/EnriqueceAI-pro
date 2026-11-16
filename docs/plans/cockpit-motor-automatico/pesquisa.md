# Pesquisa — Motor automático de ligação no Cockpit

Data: 15/11/2026 (BRT). Autor: Atlas (Planejador). Pesquisa só de leitura: nenhum código, migration, commit ou escrita no banco.

Caminhos relativos a `src/` quando não indicado. "PDT" = `features/activities/components/PowerDialerTab.tsx`. Código lido no working tree da branch `feat/cockpit-lead-frio` (PR #641, rascunho); `features/activities/**` é igual à `main`.

**Pedido:** o SDR só liga o motor do Cockpit. O sistema liga para o lead prioritário; se não atender, tenta de novo em outro horário (até 3 tentativas) e puxa o próximo lead sozinho. A priorização vem do PR #641. A Execução (Power Dialer) não pode ser alterada.

---

## 1. Como a discagem automática da Execução funciona hoje

### 1.1 Máquina de estados
É um redutor puro, `reduceAutoDial`, em `features/activities/utils/auto-dialer.ts:89-154`. Os estados estão em `auto-dialer.ts:39-55`:

`off` → `countdown` (5 s) → `dialing` → `in-call` → `resolving` → (`auto-completing` | `advancing` | `countdown` para o próximo número) → `countdown`…

Estados de exceção:
- `awaiting-session`: espera a sessão SIP da aba;
- `releasing`: ramal ainda ocupado (424);
- `waiting{until}`: ninguém liberado, "liberada às HH:MM";
- `awaiting-sdr`: 20 s sem sinal da operadora;
- `paused{reason}`.

`stop` leva a `off` de qualquer estado (`:90`), `pause` leva a `paused` (`:92-95`) e `resume` leva a `countdown` (`:149-150`).

O redutor não tem relógio nem rede. Os efeitos e timers ficam todos no PDT:

| Gatilho | Onde |
|---|---|
| tick de 1 s | `PDT:634-638` |
| discar ao entrar em `dialing` | `PDT:641-687` |
| fim da ligação | `PDT:698-700` |
| espera do sinal de atendimento (20 s) | `PDT:713-721` |
| `advancing` | `PDT:731-733` |
| `waiting` | `PDT:736-741` |
| `releasing` | `PDT:690-695` |
| `auto-completing` | `PDT:758-779` |

### 1.2 Quem dispara cada ligação
- A função `dial()` (`PDT:394-503`) é chamada pelo efeito de `phase==='dialing'`. Antes de ligar, ela pede o microfone (`PDT:403`), checa `dialingBlockReason` (`PDT:412`) e reserva um dialToken (`PDT:420`).
- Caminho da ligação: server action `initiateCall` (`features/calls/actions/initiate-call.ts:19-41`) → `originateApi4ComCallWithRef`. Uma linha em `calls` é criada antes do POST (`features/calls/services/originate-api4com-call.service.ts:106-117`), e depois vai a API4COM `POST /calls` com o ramal do SDR (`features/integrations/services/api4com.service.ts:296-337`).
- O ramal é o webphone SIP da própria aba, montado no layout (`app/(app)/layout.tsx:182`). O PDT só considera a ligação "dele" se a sessão SIP trouxer o dialToken (`features/activities/utils/power-dialer-webphone-sync.ts:34-40`).
- O automático só aparece com `dialerProvider === 'api4com'` (`PDT:917`, `PDT:939`).

### 1.3 Cada desfecho

| Situação | O que acontece | Prova |
|---|---|---|
| **Não atendeu** (webhook com `hangup_cause` e sem `answered_at`) | `decideAfterNoAnswer`: se há outro número liberado, liga esse número; senão vai para outro lead e volta depois de 1 h; na última tentativa do dia, conclui como `no_answer` | `auto-dialer.ts:273-282`, `PDT:758-768` |
| **Caixa postal** | Não tem tratamento próprio no laço. `answered_at` preenchido conta como atendida ("o lead ou a caixa postal dele"). A IA pode classificar depois como `voicemail`. `webphone_live_amd` não é lido no PDT, só no `CallResultModal:377` | `features/integrations/webphone/webphone-lead-answer.ts:16`, `features/calls/ai-outcome.ts:23-29` |
| **Atendeu** | Conclui sozinho com `aiOutcomePending:true` e segue para o próximo em 5 s | `PDT:761-779` |
| **Sem sinal em 20 s** | `awaiting-sdr`: para e espera o SDR concluir | `auto-dialer.ts:30`, `PDT:719` |
| **424 / ramal ocupado** | Espera até 15 s e tenta 1 vez; se repetir, pausa | `power-dialer-webphone-sync.ts:47-57`, `PDT:662-677` |
| **Erro no POST ou sem sessão SIP na aba em 2 s** | Pausa e mostra o motivo; não repete | `PDT:339-364`, `PDT:434-441`, `PDT:678` |
| **Webphone não pronto** | Pausa (`blocked`) | `PDT:649-659` |

O sinal de atendimento vem do webhook, consultado a cada 3 s, no máximo 40 vezes (`features/integrations/webphone/useWebphoneLeadAnswer.ts:39-75`, `webphone-lead-answer.ts:30-32`).

### 1.4 Tentativas, intervalo e limite
- O limite é **por número de telefone, por dia**: `organization_call_settings.dialer_daily_limit_per_lead`, com padrão 3 e faixa de 1 a 10 (`features/activities/actions/fetch-dialer-preferences.ts:9-37`, `schemas/dialer-preferences.schemas.ts:9-13`). **Na V4 o valor é 3** (SELECT de 15/11).
- O lead tenta **todos os números**, 1 vez cada por rodada (`auto-dialer.ts:16-20`, `pickNextAutoDial` em `:309-331`).
- "Novo horário" = **mínimo de 1 h entre ligações para o mesmo número** (`AUTO_DIAL_MIN_GAP_MS`, `auto-dialer.ts:32`). Não é um horário marcado: o lead volta na fila quando passa 1 h.
- A contagem do dia vem de `calls.started_at` desde a meia-noite BRT (`fetch-dialer-queue.ts:225-237`). O lead sai da fila quando todos os números chegaram ao limite (`:249`).
- Há 5 s de contagem entre ligações (`auto-dialer.ts:28`).
- **Horário comercial: não existe no discador.** `BUSINESS_HOURS_*` só existe em `utils/overdue.ts:22-23`, para calcular atraso.
- `daily-guardrails.ts` não limita discagem: só soma pulos, adiamentos e perdas (`:3-49`).

### 1.5 Pausa e parada
- Os controles: botão Pausar do topo = `stop` (`PDT:796-799`); Pausar da barra = `pause` (`PDT:969`); desligar a chave = `stop` (`PDT:607-613`); escolher um lead na lista também pausa (`PDT:894`).
- **Pausar não derruba a ligação em curso.** Desligar é outro botão, `handleHangup` (`PDT:831-864`).
- Um `dial()` já disparado ainda termina, mas o redutor ignora os eventos fora de `dialing` (`auto-dialer.ts:97-153`).

### 1.6 Como puxa o próximo lead
- A fila vem de `fetchDialerQueueWithStats` (`fetch-dialer-queue.ts:84-293`). Ela pega inscrições ativas com `next_step_due ≤ agora` (limite de 100, `:96-103`). O SDR vê só os leads dele (`:100`). Saem da fila:
  - cadências `auto_email` e `bdr_ai` (`:191`);
  - leads sem número;
  - leads com todos os números no limite.
- No automático, só são discados os itens com a etapa atual de ligação (`auto-dialer.ts:289-291`).
- Com `call_priority_v2`, a fila inclui leads com sinal e usa `rankDialerQueue` (`rank-dialer-queue.ts:43-76`). Ela recarrega a cada 30 s, sem trocar o lead que está em ligação (`PDT:743-756`).
- **`contact_holds`: não encontrado** em `features/activities/**`. A Execução não respeita bloqueio de contato.

### 1.7 Como o desfecho é gravado
- **Ação:** `completeDialerCall` (`features/activities/actions/complete-dialer-call.ts:52-133`).
  - Com `callId`, `applySdrCallResult` grava `calls.sdr_disposition` e as notas e liga a interação à etapa (`:69-80`, `features/calls/services/apply-sdr-call-result.ts:86-92`).
  - Depois avança a cadência (`:96-128`).
  - `calls.status` nunca é escrito pelo app: ele é da telefonia.
- **Automático:**
  - atendeu → `metadata.ai_outcome={status:'pending'}` (`complete-dialer-call.ts:192-213`);
  - última tentativa sem atender → `sdr_disposition='no_answer'`.
- **IA:**
  1. O webhook dispara a transcrição a partir de 10 s (`app/api/webhooks/api4com/route.ts:471-477`).
  2. O cron `process-pending-transcriptions` pega o que sobrou e expira o pendente em 2 h (`route.ts:31-33`).
  3. `applyAiCallOutcome` classifica com `openai/gpt-4.1` via OpenRouter e grava pelo mesmo `applySdrCallResult`, sem sobrescrever o SDR (`apply-ai-call-outcome.service.ts:74-149`).
  4. Se o lead pediu retorno, agenda a ligação (`:156-168`).
- **SDR:** só no `awaiting-sdr` ou no modo manual, pelo painel com notas e "Concluir" (`PDT:866-883`, `DialerCallPanel.tsx:405-441`).

---

## 2. Como o Cockpit disca hoje

- **Botão "Ligar agora"** (`features/cockpit/components/NextCallCard.tsx:104`) chama `handleCall` (`:49-70`):
  - trava de clique duplo (`:51-52`);
  - chama `initiateApi4ComCall({ phone, leadId })` (`:55`), que é a mesma origem `originateApi4ComCallWithRef` da Execução, mas **sem** o dialToken nem a checagem de sessão SIP da aba;
  - liga só o telefone do decisor (`:38`).
  - O próprio componente diz: "A ligação só começa com o clique do usuário… nada disca sozinho" (`:31-34`).
- **O áudio** vem do mesmo webphone global do layout (`app/(app)/layout.tsx:182`), que atende o ramal sozinho. O cartão não acompanha a sessão SIP.
- **Resultado pós-ligação (flag `call_cockpit_outcomes`):**
  - Com a flag ligada, o cartão "arma" a ligação: `armCockpitCallOutcomeAction` (`actions/call-outcome.ts:37-52`) grava `calls.metadata.ai_outcome={status:'pending', hold_low_confidence:true}` (`services/call-outcome.service.ts:80-107`).
  - Quem grava o resultado é a **mesma cadeia de IA da Execução** (webhook → transcrição → cron → `applyAiCallOutcome`).
  - O cartão só lê, por polling de 3 s, no máximo 40 vezes, cerca de 2 min (`components/CallOutcomePanel.tsx:43-73`). Depois disso mostra "Sem retorno da operadora" (`:61-63`). Confiança baixa vira "Revisar resultado" (`:118-139`).
  - **No banco, `call_cockpit_outcomes` não existe em `app_flags`** (SELECT de 15/11), ou seja, está desligada.
- **Próximo lead:** precisa de clique em "Próxima ligação" (`CallOutcomePanel.tsx:79-81`), que faz `router.push('?skip=<lead>')` (`NextCallCard.tsx:72-76`). A página é `force-dynamic` e escolhe de novo no servidor (`app/(app)/cockpit/page.tsx:33,77-79`).
  - **Só 1 lead excluído por vez**: o `skip` é sobrescrito (`NextCallCard.tsx:74`), então um lead pulado duas ligações antes pode voltar.
  - Com a flag de outcomes desligada, não há botão "Próxima" e o `skip` é ignorado (`page.tsx:76-78`, `NextCallCard.tsx:182`).
  - Achado lateral: `page.tsx:77` lê a flag sem escopo de org/usuário, enquanto as actions usam escopo.

**O que falta para um motor contínuo** (só o que o código mostra):
1. laço que disque sozinho;
2. avanço automático;
3. retentativa por horário;
4. lista de excluídos que acumula na sessão;
5. ligação à sessão SIP da aba (dialToken);
6. tratamento de 424, erro e ramal ausente;
7. pausa e parada;
8. teto de volume e horário comercial;
9. fim de ligação por sinal confiável. Hoje o polling desiste em 2 min e não chama `onNext`.

---

## 3. O que dá para reusar sem editar a Execução

Regra: importar de `features/activities/**` é **ler**, não editar. Qualquer mudança nesses arquivos fica proibida no diff.

| Peça | Como reusar | Risco para a Execução |
|---|---|---|
| `reduceAutoDial` + estados e eventos, `isAutoDialRunning`, `describeAutoDial` (`auto-dialer.ts`) | **Import direto.** São puros e exportados | Baixo agora. Médio no futuro: se a Execução mudar o redutor, o Cockpit muda junto sem perceber. Mitigar com testes do Cockpit que travem o comportamento |
| `phoneKey`, `availablePhones`, `isExhausted`, `nextAvailableAt`, `recordAttempt`, `countCallsByPhone`, `buildAttemptLog`, `decideAfterNoAnswer` | Import direto | Mesmo acima. Assinaturas recebem `DialerQueueItem` (tipo da Execução): o Cockpit precisa montar esse formato |
| `pickNextAutoDial`, `isAutoDialEligible` | Import possível, mas pressupõe a fila da Execução (inscrição com etapa de ligação, `currentStepIsPhone`) | Baixo, mas **não se encaixa**: o Cockpit escolhe pela RPC do #641 (carteira inteira, inclusive lead sem cadência). Recomendo **não** usar e escolher pelo servidor |
| `sessionOfThisDial`, `nextRamalAttempt`, mensagens (`power-dialer-webphone-sync.ts`) | Import direto | Baixo |
| `AUTO_DIAL_COUNTDOWN_SECONDS`, `AUTO_DIAL_ANSWER_TIMEOUT_MS`, `AUTO_DIAL_MIN_GAP_MS` | Import direto | Baixo. Se a Execução mudar o valor, o Cockpit muda junto. Decidir se o Cockpit quer valores próprios |
| `initiateCall` (`features/calls/actions/initiate-call.ts`), `useWebphoneLeadAnswer`, `webphone-lead-answer.ts`, `webphone-client` | Import direto. **Já são de `calls/` e `integrations/webphone/`**, não da Execução | Nenhum para a Execução (não são arquivos dela). Mas são compartilhados: o Cockpit não deve editá-los |
| `completeDialerCall` (`activities/actions/complete-dialer-call.ts`) | Import possível. Grava `sdr_disposition`, liga a interação à etapa e **avança a cadência** | Médio. Ele foi feito para item de fila com inscrição e etapa. Lead do Cockpit pode não ter cadência. Recomendo usar `applySdrCallResult` (`calls/services`) + `armCockpitCallOutcome` (do próprio Cockpit), sem avançar a cadência, ou decidir isso (ver D6) |
| Cadeia de IA (webhook, transcrição, cron, `applyAiCallOutcome`) | Já é usada pelo Cockpit via "armar" | Nenhum novo |
| `cadenceResumeAfterReturn` (`callback-resume.ts`) | Import direto | Baixo |
| **Laço do PDT** (`dial`, `completeCurrent`, `pickAuto`, timers e efeitos, `PDT:164-895`) | **Não importável.** Só `PowerDialerTab` é exportado (`PDT:108`). Opções: (a) **copiar** para um hook novo do Cockpit; (b) **extrair** um hook compartilhado (exige editar o PDT) | (a) Risco zero para a Execução, mas fica código duplicado (dois laços para manter). (b) Mexe na Execução, **proibido** sem decisão do usuário (ver D1) |

**O que precisa ser novo, no Cockpit:**
1. hook do motor (`useCockpitAutoDial`) com os timers e efeitos;
2. botão Iniciar/Pausar/Parar e faixa de status no `NextCallCard`;
3. lista de excluídos que acumula na sessão;
4. action do servidor "próximo lead elegível agora", que chama a RPC do #641 com a lista de excluídos e devolve o próximo;
5. regra de retentativa (ver item 4);
6. trava de horário comercial e de volume;
7. checagem de `contact_holds` também no momento de discar (a RPC já exclui `tipo='total'`);
8. modo simulado;
9. flag própria (ver D9).

⚠️ **Achado de risco:** o floor `feattime-web-dev` tem mudanças **não commitadas** em arquivos da Execução: `fetch-dialer-queue.ts`, `DialerSidebar.tsx`, `PowerDialerTab*.test.tsx`, `dialer-preferences.schemas.ts`, `WebphonePanel.tsx` e outros (`git diff --stat`, 10 arquivos). Alguém está mexendo nessa área agora. Os imports do Cockpit precisam ser conferidos contra a versão final desses arquivos.

---

## 4. Priorização do #641 × "3 tentativas + novo horário"

**O que o #641 faz** (`supabase/migrations/20261115120000_cockpit_next_call_candidates.sql`, `utils/cold-lead-order.ts:7-18`):
- teto de **2 ligações/lead/dia**, contando ligações de **qualquer origem** desde a meia-noite BRT (`:61,130,147`). O teto vale **só para o frio**; o quente passa (`:184`);
- lead com **mais de 6 ligações em 30 dias** desce na ordem, mas não sai (`:145,150`);
- não tem intervalo mínimo entre tentativas;
- não olha o número de telefone, só o lead;
- exclui `contact_holds` `tipo='total'` (`:86-89`).

**O que o motor da Execução faz:** 3 por **número** por dia, mínimo de 1 h entre tentativas no mesmo número, todos os números do lead.

**Conflitos:**
1. **2 × 3 por dia.** Com as duas regras, o frio para na 2ª ligação e a 3ª tentativa nunca acontece.
2. **Lead × número.** Um lead com 3 números na regra da Execução pode receber 9 ligações/dia. No #641 são 2.
3. **Contagem por origem.** O #641 conta as ligações da Execução também. Se o SDR usar os dois menus no mesmo dia, um consome o teto do outro. A Execução não vê as do Cockpit pelo teto do #641, mas vê pela própria contagem (`calls.started_at`, qualquer origem).
4. **Quente sem teto.** No #641 o quente passa do teto. Num motor automático, isso pode significar ligar repetidamente para o mesmo quente se não houver intervalo.
5. **Sem intervalo.** O #641 não impede ligar de novo 5 min depois.

**Proposta de harmonização** (recomendação, a decidir em D3/D4):
- Uma regra só para o motor do Cockpit, aplicada no **servidor**, na escolha do próximo lead: **até N tentativas por lead por dia** (N = 3, como pedido pelo usuário) **e intervalo mínimo M entre tentativas do mesmo lead** (M = 1 h, igual à Execução), **para quente e frio**.
- O teto do #641 é parâmetro (`p_daily_cap`). Basta o motor passar 3 em vez de 2; não precisa mudar a regra da função para isso.
- O intervalo precisa de algo novo: a função já calcula `last_call_at` e só faltaria filtrar `last_call_at < agora - M`. Ou o motor filtra no TypeScript. Nos dois casos é decisão de quem implementa a mudança na RPC (é do próprio #641, não da Execução).
- A regra dos 6 em 30 dias continua como está (só desce na ordem).
- Contar tentativas **de qualquer origem**, como o #641 já faz, para o lead não receber 3 do Cockpit + 3 da Execução no mesmo dia.
- Tentativa **por lead** (1 número por vez: o do decisor, como o cartão faz hoje). Ligar todos os números fica para depois (D5).

---

## 5. Riscos de ligação real e como travar

A regra do plano diz: "Nada de ligação real… sem aprovação explícita" (`docs/plans/plano-crm-autonomo.md:18`).

| Risco | Trava proposta | Hoje existe? |
|---|---|---|
| Ligar sem o SDR ter iniciado | Motor só começa com clique em "Iniciar motor" **na aba**. Nada de iniciar sozinho ao abrir a página: a preferência lembrada só deixa a chave marcada, não liga. Flag própria desligada = botão nem aparece | A Execução lembra a escolha no `localStorage` (`auto-dialer.ts:379-396`) e liga ao iniciar o Power Dialer. **Para o Cockpit recomendo não lembrar** (D8) |
| Fora do horário comercial | Bloqueio no servidor (na action de discagem do motor) e no cliente: seg–sex, das 08:00 às 18:00 BRT, com feriados (`business_holidays`) | **Não existe** em nenhum discador |
| Parada imediata | Botão Parar = para o laço **e** desliga a ligação em curso (`hangupCall`) se o usuário escolher isso (D7). Fechar a aba ou trocar de rota para o motor (unmount) | Na Execução, pausar **não** derruba a ligação (`PDT:796-799`, `:831-864`) |
| Volume | Teto por SDR/dia e por hora no motor, além do teto por lead. Respeitar o limite da API4COM de 15/min por ramal (memória `api4com-embedded-webphone`) | Só por lead/número |
| `contact_holds` | A RPC já exclui `tipo='total'`. Checar de novo no servidor **na hora de discar** (o lead pode ter sido bloqueado durante a sessão). Decidir o que fazer com os outros tipos de bloqueio (D10) | Execução: **não respeita** |
| Ramal ou sessão SIP em erro | Reusar `sessionOfThisDial`/dialToken + `nextRamalAttempt`. Webphone não registrado, sem microfone ou 424 repetido → **pausa com motivo**, nunca repete em loop | Cockpit: **não checa**. Execução: checa |
| Duas abas ou dois SDRs | Uma aba por SDR (o webphone já sofre com várias abas, memória de 23/10). Reserva do lead no servidor para dois motores não pegarem o mesmo lead (carteira compartilhada via `closer_id`) | Não existe |
| Sinal da operadora não chega | Mesmo comportamento da Execução: após 20 s, para e espera o SDR. **Não** seguir sozinho sem sinal | Cockpit: desiste em 2 min, sem ação |
| Cockpit e Execução ao mesmo tempo | Bloquear iniciar o motor do Cockpit se houver ligação integrada em curso no webphone (mesmo ramal) | Não existe |

**Como testar sem ligar de verdade:**
1. **Testes unitários e de tela** com `vi.mock` de `initiateCall`, `hangupCall`, `webphone-client` e `useWebphoneLeadAnswer` e relógio falso. É o mesmo modelo de `PowerDialerTab.auto.test.tsx:30-197`, que já simula a sessão SIP com dialToken.
2. **Modo simulado no app** (não existe hoje em nenhum discador). Uma opção do motor (flag `cockpit_auto_dial_simulated` ou parâmetro só para usuários em `allow_user_ids`) troca a action de discar por um "discador falso" no servidor. Ele não chama a API4COM, não cria linha em `calls` (ou cria marcada `metadata.simulated=true`, a decidir) e devolve "não atendeu"/"atendeu" em X s. Assim se valida o laço, a ordem, o teto e o intervalo em produção sem tocar telefone.
3. **Ensaio real:** só com aprovação explícita, 1 SDR (Vini), 2–3 leads de teste próprios (ex.: Mercante Net `969ea854`), em horário comercial.

---

## 6. Decisões para o usuário

1. **D1. Como reusar o laço da Execução**
   - (a) Copiar o laço para um hook novo do Cockpit e importar só as funções puras.
   - (b) Extrair um hook compartilhado, o que mexe no PDT.
   - (c) Reescrever do zero.
   - **Recomendo (a):** não toca na Execução. O custo são dois laços para manter.
2. **D2. Quem escolhe o próximo lead.**
   - (a) A RPC do #641, no servidor, a cada lead.
   - (b) Lista carregada uma vez e ordenada no navegador, como a Execução.
   - **Recomendo (a):** usa a prioridade do #641 e respeita bloqueios em tempo real.
3. **D3. Qual regra de tentativas vale no motor.**
   - (a) 3/lead/dia + 1 h entre tentativas, para quente e frio, contando qualquer origem.
   - (b) A regra atual do #641 (2/dia, só frio, sem intervalo).
   - (c) A regra da Execução (3 por número, todos os números).
   - **Recomendo (a).**
4. **D4. Intervalo do "novo horário".**
   - (a) Mínimo de 1 h, igual à Execução.
   - (b) Horários fixos, ex.: manhã, início da tarde, fim da tarde.
   - (c) Outro valor.
   - **Recomendo (a):** já testado na operação. O pedido não define "outro horário" com precisão.
5. **D5. Quais números ligar.**
   - (a) Só o do decisor, como o cartão hoje.
   - (b) Todos os números, como a Execução.
   - **Recomendo (a) agora e (b) depois.**
6. **D6. O que gravar quando não atende, e se avança cadência.**
   - (a) Gravar `no_answer` só na última tentativa do dia, sem avançar a cadência pelo Cockpit.
   - (b) Gravar e avançar a etapa de ligação se o lead estiver nela, como a Execução.
   - (c) Gravar `no_answer` em toda tentativa.
   - Não recomendo sem ouvir o usuário: muda o funil. Tendo a preferir (a), porque o lead do Cockpit muitas vezes não tem cadência (88% sem cadência ativa, pesquisa do #641).
7. **D7. Atendeu: o que o motor faz.**
   - (a) Segue sozinho após o fim, com a IA classificando, como a Execução.
   - (b) Para e espera o SDR clicar "Próxima".
   - E o Parar derruba a ligação em curso? (sim / não)
   - **Recomendo (a) com o selo "Revisar" e o Parar sem derrubar a ligação** (igual à Execução).
8. **D8. Lembrar "motor ligado" entre recarregamentos.**
   - (a) Não: sempre começa desligado.
   - (b) Lembrar, como a Execução.
   - **Recomendo (a)**, por segurança de ligação real.
9. **D9. Flag.**
   - (a) Flag nova `cockpit_auto_dial`, só V4 via `allow_org_ids` ou só para usuários em `allow_user_ids` no início.
   - (b) Reusar `call_cockpit_outcomes`.
   - **Recomendo (a)**, começando por `allow_user_ids` = Vini. Lembrete: o motor depende de `call_cockpit_outcomes` (hoje inexistente no banco = desligada) e de `cockpit_cold_order` (#641, ainda não mesclado).
10. **D10. Bloqueios de contato.** Hoje só `contact_holds.tipo='total'` impede.
    - Os outros tipos também impedem a ligação automática?
    - Ambíguo: não li a semântica dos outros tipos. Precisa da regra do usuário.
11. **D11. Horário e volume.**
    - Janela: (a) seg–sex 08:00–18:00 BRT com feriados; (b) outra.
    - Teto por SDR/dia ou hora: valor?
    - **Recomendo (a)** e um teto inicial baixo no piloto (ex.: 30 ligações/dia), a confirmar.
12. **D12. Modo simulado.**
    - (a) Construir o "discador falso" (seção 5) antes do ensaio real.
    - (b) Só testes automatizados.
    - **Recomendo (a).**
13. **D13. Ordem de entrega.**
    - (a) Primeiro o #641 sair do rascunho e ir ao ar, depois o motor.
    - (b) Os dois juntos.
    - **Recomendo (a):** o motor depende da RPC e do teto do #641.

**Ambiguidades que não supus:**
- "até 3 tentativas" pode ser por dia ou no total.
- "outro horário" pode ser um intervalo ou um horário marcado.
- Não está definido se o "Atendeu" para o motor.
