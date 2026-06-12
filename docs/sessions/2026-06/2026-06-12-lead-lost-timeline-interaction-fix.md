# Handoff — 2026-06-12: Lead dado como perdido sumindo da timeline

## Contexto
Sessão na V4 Company Amaral (org `c2727473-1df8-4faa-9264-a9fc1759fe3b`).
Bug reportado pelo manager: o lead **KUBA SMARTHOME**
(`1d66ffdc-45d2-44ee-b6c8-f1900ab72b73`,
`app.enriqueceai.com.br/leads/1d66ffdc-...`) foi dado como **perdido**, mas a
atividade e o motivo **não apareciam na timeline** do lead.

> **Status final: resolvido em duas frentes — dado backfillado em prod + código
> blindado (PR #28 `27df43d`, mergeado na `main`).** Auto-deploy Coolify.

## Diagnóstico

O lead estava corretamente marcado no banco: `status='unqualified'`,
`loss_reason_id` (motivo "Sem budget"), `loss_notes` ("Lead está faturando 35k e
não tem margem pra investimento"), `lost_at = 2026-06-12 17:17:41`. **Só faltava
a interação `lead_lost` na tabela `interactions`** — que é o que a aba Timeline
renderiza (`LeadTimelineTab` lê `interactions`, não os campos do lead).

**Pista que destravou:** o `updated_at` do lead (17:29:42) batia no microssegundo
com 3 eventos `step_skipped`. Isso NÃO era o horário da perda — era um
`execute-activity` posterior: depois de dar perdido às 17:17, o SDR
**re-inscreveu o lead numa cadência (17:25) e fez ligações (17:28-29)**, e isso
refrescou o `updated_at`, mascarando o horário real. O `lost_at` (17:17:41) é a
fonte confiável de quando a perda ocorreu.

**Escopo medido no banco (org toda):** 1270 leads perdidos → 1269 com interação
`lead_lost`, **só 1 sem** (exatamente o reportado). A interação não foi parar em
outro lead (busca pela obs "faturando 35k" retornou vazio) — **nunca foi
criada**. Bug raro, ~0,08%, não sistêmico.

## Causa raiz

`markLeadAsLost` (`src/features/leads/actions/lead-lifecycle.ts`) fazia duas
escritas separadas:
1. `UPDATE leads` (status + loss_reason_id + loss_notes) — sucesso.
2. `INSERT interactions` (`system_event: 'lead_lost'`) — falha transitória.

E **o erro do insert (2) não era verificado** — qualquer falha
(rede/timeout/deadlock) derrubava o registro da timeline em silêncio, com a perda
já persistida no lead. O `expire-inactive-leads.ts` já documentava e tratava esse
mesmo modo de falha ("Order matters: insert the lead_lost interaction *before* the
lead UPDATE"); o `markLeadAsLost` não tinha a blindagem.

## Correção

### Frente A — dado corrigido (escrita em prod, aprovada pelo usuário)
Backfill da interação faltante via SQL (MCP Supabase, projeto `Enriquece AI`
`dhkmonctyoaenejemkrt`):
- `channel='system'`, `type='sent'`, mensagem no formato idêntico ao fluxo normal
  ("Lead marcado como perdido — Motivo: Sem budget | Obs: ...").
- `created_at = lost_at` (17:17:41), `performed_by` = o SDR
  (`5769812d-c562-437f-8259-987c2c2dbecd`).
- `metadata.backfill=true` + `backfill_reason` para honestidade de auditoria.
- Guard `NOT EXISTS` (idempotente). Interação criada: `f348ad45-...`.

### Frente B — código blindado (PR #28, `27df43d`)
`markLeadAsLost` reescrito espelhando `expire-inactive-leads`:
- **Insere a interação `lead_lost` ANTES** de virar o status — o rastro de
  auditoria sobrevive mesmo se o `UPDATE leads` falhar depois.
- **Checa o erro do insert** (nunca ignora) + **1 retry** + `console.error` alto
  em falha persistente.
- `pnpm typecheck` ✅ / `eslint` no arquivo ✅ / CI `Lint·Typecheck·Test·Build`
  pass (3m52s).

## Arquivos
- `src/features/leads/actions/lead-lifecycle.ts` — `markLeadAsLost` reordenado +
  hardening (+36/−21).

## Processo / infra (relembrar)
- Repo `Mercantes/EnriqueceAI-pro` é **redirect** para `v4amaraltech/EnriqueceAI-pro`.
  Push/PR caem no `v4amaraltech` — usar `--repo v4amaraltech/EnriqueceAI-pro` no `gh`.
- **Coolify auto-deploy**: merge na `main` dispara build/deploy sozinho. Fix é
  só código (sem env var), então deploy automático.
- DB de prod = projeto Supabase **`Enriquece AI`** (`dhkmonctyoaenejemkrt`),
  acessível via MCP Supabase (`execute_sql`).

## Pendências (fora desta sessão)
- **Rotação do `CRON_SECRET`** segue PENDENTE (não trocar no Coolify antes de
  mergear/deployar o verificador multivalor `feat/cron-secret-multivalue`).
