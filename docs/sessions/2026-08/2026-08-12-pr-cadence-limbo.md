<!-- Título do PR: fix(cadences): corrige e monitora o limbo de cadência (fonte, rastro e rede de segurança) -->
<!-- Branch: fix/cadence-limbo-source-tracing → main -->

## Problema

Leads caíam em **"limbo de cadência"**: `status='contacted'` (vivos) sem
nenhuma cadência ativa e sem atividade pendente. Não apareciam em fila
nenhuma, ninguém era cobrado e não voltavam sozinhos. Diagnóstico (12/08):
**607–647 leads** nesse estado, o mais antigo parado desde 27/05.

Três causas na camada de aplicação, atacadas aqui.

## O que este PR faz

### 1. Estanca a fonte — botão "Ignorar" (`fix(activities)`)
O item **"Encerrar cadência"** chamava `ignoreActivity` e marcava o
`cadence_enrollments` inteiro como `completed` — o SDR clicava achando que
pulava só a atividade.
- **Nova action `skipStep`**: avança `current_step` via a RPC atômica
  `advance_enrollment_after_step`, **sem encerrar** a cadência (o meio-termo
  que faltava entre adiar o mesmo passo e matar tudo).
- `ActivityRow`: remove o item destrutivo. Menu de cadência agora tem
  **"Pular esta atividade"** + **"Trocar cadência"** (reusa
  `EnrollInCadenceDialog` em modo switch). Encerrar passa a exigir destino
  (trocar / ganho / perdido) — nunca "no vazio".
- Linha de retorno agendado vira **"Cancelar retorno"** (não gera limbo).

### 2. Rastro de pausa/retomada (`feat(cadences)`)
- O **auto-pause do motor** (`autoPauseEnrollment`) — a maior fonte de pausa
  (lead sem e-mail/telefone) — **não gravava interaction**: a pausa era
  invisível na timeline. Agora registra o rastro (`performed_by=null`).
- Pausa/retomada passam a usar eventos **distintos** `cadence_paused` /
  `cadence_resumed` com `reason` nos 4 caminhos (bulk-pause/resume,
  `updateEnrollmentStatus`, auto-pause) — antes tudo caía no genérico
  `enrollment_status_changed` e era incontável.
- `logLeadEvent/Bulk` aceitam `userId:null` e `SupabaseClient` genérico.
- `LeadTimeline`: rótulos dos novos eventos.

### 3. Rede de segurança (`feat(cadences)`)
- View **`v_leads_cadence_limbo`** (`security_invoker`) que detecta o estado
  de limbo. **Já aplicada em prod** — este PR fecha o drift entre o histórico
  de migrations e o banco.
- Action `checkCadenceLimbo` + rota `/api/cron/cadence-limbo-alert`: alerta
  diário aos gestores (agrupado por dono, dedup diário). Padrão clonado de
  `stale-cadence-alert`.
- Migration que agenda o cron `0 12 * * 1-5` (9h BRT).

### 4. Agendar retorno não encerra a cadência (`fix(activities)`)
Os fluxos pós-call passavam `completeEnrollments:true` ao agendar um retorno,
marcando todos os enrollments do lead como `completed` — a cadência morria ao
marcar um follow-up (ex. lead encerrado no passo 1 de 21).
- `scheduleActivity`: `completeEnrollments` agora **default `false`** —
  encerrar deixa de ser efeito colateral de agendar.
- Desacopla o **dedup de retornos** (cancelar retornos pendentes anteriores do
  mesmo lead) do encerramento: o dedup roda sempre, o encerramento não.
- Remove `completeEnrollments:true` dos 3 fluxos pós-call.

## Fora do escopo deste PR (já feito em prod)
- **Triagem do passivo (566 leads → "Novo sem cadência")**: operação de dados
  executada via MCP em 12/08 (limbo 607→42), com backup
  `_bkp_cadence_limbo_triage_20260812` preservado e reversível. Não é código.

## Testes
- `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm test:run` ✅ (**1.724 testes**)
- View validada read-only em prod (retorna o mesmo conjunto do diagnóstico).

## Ativação pós-merge (⚠️ ordem importa)
1. Merge → Coolify deploya o código (a rota `/api/cron/cadence-limbo-alert`
   precisa existir **antes** de agendar o cron).
2. Aplicar a migration `20260812120100` para agendar o cron.
   **O 1º disparo notifica os gestores dos leads em limbo** (esperado).

## Riscos / notas
- A migration `20260812120000` (view) já foi aplicada em prod; reaplicar é
  idempotente (`CREATE OR REPLACE VIEW`).
- A triagem já feita gerou 566 `status→'new'`, que acionam o guard-rail
  `detect-status-resets` — avisar os gestores que foi a operação de limbo.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
