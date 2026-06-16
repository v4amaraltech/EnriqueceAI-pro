# Handoff — 2026-06-16: Tratamento de reunião sem desfecho (no-show limbo)

Org V4 Amaral (`c2727473-1df8-4faa-9264-a9fc1759fe3b`). Agente: @devops (Gage).

> **Status final: resolvido e em produção, em 2 PRs.** Feature completa, deploy
> verificado (release = HEAD da `main`).

## Problema relatado

O gestor reportou um lead (**Silvana Grassi**, FARMACIA FARMACEUTICA LTDA) que
"tomou no-show": a reunião passou, mas no Enriquece ele seguia com o invite,
**sem atividade de retorno, fora de cadência, sem notificação** — em limbo pro
SDR. "Quando dá no-show, não acontece nada."

## Diagnóstico (dado de produção)

A automação de no-show **já existia**, mas só dispara por um caminho:
`SDR clica "Ganho"` → link de feedback ao closer → closer marca `no_show` →
reabre + cria follow-up (ver `closer-feedback-flow`). **A ironia:** num no-show
real o SDR NÃO marca "Ganho" (não foi ganho), então o loop nunca começa. E o SDR
só tinha **Ganho** (passa o bastão) ou **Perdido** (desqualifica) — **nenhum
"a reunião não aconteceu"**. Não havia **nenhum gatilho baseado no tempo da
reunião**.

Retrato da Silvana no banco: `status='qualified'`, reunião 08/06 16:00 (8 dias
antes), `won_at`/`lost_at`/`meeting_held_at` nulos, **0 atividades**, **0
feedback**, cadência `completed`. A query encontrou **21 leads** nesse limbo.

## Solução — 2 PRs

### PR #43 — o "vigia" por tempo (fundação)
- **RPC `find_meetings_pending_outcome()`** (`20260616120000_*.sql`): leads cuja
  **última reunião** (hora do **metadata da interaction** `meeting_scheduled`,
  NÃO `meeting_scheduled_at` que é o momento do agendamento) já passou e seguem
  sem desfecho (sem won/lost/meeting_held, sem `closer_feedback_request`
  respondido). Retorna fatos: `checkpoint_at`, `escalated`, `has_pending_activity`,
  `has_open_feedback`.
- **Endpoint `/api/cron/meeting-outcome-check`** — 2 estágios idempotentes:
  - **Estágio 1** (reunião + 24h): atividade `phone` "registrar desfecho" na
    fila do SDR + link de feedback ao closer (reusa `sendCloserFeedbackEmail`,
    só se reunião ≤10 dias — guard de frescor) + notifica SDR. Marca
    `meeting_outcome_checkpoint`.
  - **Estágio 2** (checkpoint + 2 dias úteis sem desfecho): garante follow-up de
    telefone + escala ao gestor. Marca `meeting_outcome_escalated`.
  - Janela/dia-útil em TS, funções puras testadas (`classifyStage`,
    `addBusinessDays`, `nextBusinessDayAt9hBRT` — 11 testes). `MAX_PER_RUN=50`.
- **Job pg_cron** `meeting-outcome-check` (08h BRT, seg-sex). Migration usa
  placeholder `REPLACE_ME` (sem segredo no git); em produção foi agendado
  **clonando o `command` de um cron existente via `replace()` do path** — herda o
  token sem manuseá-lo.

**Execução controlada (16/06)** disparada e validada por dado:
- **19 leads** do estágio 1 processados: 19 atividades na fila + 19 SDRs
  notificados + **2 links de closer** (só Gustavo 11/06 e Silvana 08/06; os de
  maio pulados pelo guard de frescor). Silvana confirmada resolvida ponta a ponta.
- Backlog histórico limpo → **PR 3 (backfill) dispensado**.

### PR #44 — botão manual "Reunião não aconteceu" (SDR)
- **Action `markMeetingNoShow(leadId)`** (`src/features/leads/actions/lead-noshow.ts`):
  audita `meeting_no_show_manual`, reabre pra `qualified` se estava `won` (limpa
  won_at/meeting_held_at), garante follow-up de telefone na fila (não empilha),
  notifica gestores.
- **Item no dropdown "…"** do `LeadDetailHeader`, exibido quando há
  `meeting_scheduled_at` e o lead não está `unqualified`.
- **Closers não logam no app** (não são `organization_members`) → o caminho
  deles continua o link tokenizado que o cron cria. "SDR e closer" = botão pro
  SDR + link pro closer.

## Estado em produção (verificado)
- **Deploy Coolify confirmado**: release SHA de produção = `1ee21da` = HEAD da
  `main` (merge do #44). Ambos os PRs no ar.
- **RPC + job pg_cron** aplicados em produção via MCP (migrations não sobem pelo
  Coolify — só código). Job ativo, herdando o token dos demais ~21 crons.
- O cron roda diariamente 08h BRT seg-sex daqui pra frente.

## Arquivos
**PR #43:**
- `supabase/migrations/20260616120000_find_meetings_pending_outcome_rpc.sql`
- `supabase/migrations/20260616120100_schedule_meeting_outcome_check_cron.sql`
- `src/app/api/cron/meeting-outcome-check/route.ts` (+ `route.test.ts`)

**PR #44:**
- `src/features/leads/actions/lead-noshow.ts` (novo)
- `src/features/leads/components/LeadDetailHeader.tsx` (item no dropdown)

## Validação
- `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm build` ✅ nos dois PRs
- 11 testes unitários (#43) ✅ · CI `Lint·Typecheck·Test·Build` ✅ (#43 3m43s, #44 3m41s)
- Lógica da RPC validada em produção (read-only) + execução controlada por dado.

## Pendências (fora desta sessão)
- **Rotação do `CRON_SECRET`** segue PENDENTE — não trocar no Coolify antes do
  verificador multivalor `feat/cron-secret-multivalue` estar no ar (senão 401 em
  todos os crons, agora incluindo `meeting-outcome-check`).

## Processo / infra (relembrar)
- Repo `Mercantes/EnriqueceAI-pro` é **redirect** pra `v4amaraltech/EnriqueceAI-pro`.
  Usar `--repo v4amaraltech/EnriqueceAI-pro` no `gh`.
- **Migrations Supabase NÃO sobem pelo Coolify** — aplicar via MCP à parte.
- **Coolify auto-deploy**: merge na `main` dispara build/deploy do código sozinho.
- Crons novos: clonar o `command` de um cron existente (`replace()` do path) pra
  herdar o token vigente sem manusear/expor o segredo.
