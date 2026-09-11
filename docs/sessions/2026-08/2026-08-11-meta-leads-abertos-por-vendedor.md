# Sessão 2026-08-11 — "Oportunidades" → "Leads Abertos" por vendedor (meta individual)

**Agentes:** @dev (Dex) · @devops (Gage) · **Branch base:** main

## Resumo

O gestor perguntou o que significava a coluna **"oportunidades"** no card de cada vendedor (modal **Editar metas** do dashboard). Diagnóstico: era `goals_per_user.opportunity_target`, um campo **legado/vestigial** (0 pra todo mundo; "oportunidade" já é medido por reunião realizada / lead `won`). A pedido dele, essa coluna virou **"leads"**, referenciando os **Leads Abertos** que o SDR precisa abrir no mês — e como **meta real**, alimentando o ideal/dia por SDR do card "Leads Abertos" do dashboard.

## O que entrou na `main` (PRs)

| PR | Commit | Conteúdo |
|----|--------|----------|
| #263 | `eb09397` | meta de "leads abertos" por vendedor no lugar de "oportunidades" |

## Diagnóstico (as 4 colunas do card de vendedor)

Modal em [`GoalsModal.tsx`](../../../src/features/dashboard/components/GoalsModal.tsx) — são **metas editáveis** (`goals_per_user`), não realizados:

- **`julho / 300`** (esquerda) → **meta do MÊS ANTERIOR**, só referência (não é a meta vigente).
- **oportunidades** → `opportunity_target` — **legado/vestigial** (todos 0). No domínio "oportunidade" = reunião realizada = lead `status='won'`/`won_at`, carimbado via `/api/feedback` (`result=meeting_done`) — **igual a "realizadas"**. Coexistiam por resíduo de migração (`meetings_held_target ?? opportunity_target`).
- **marcadas** → `meetings_scheduled_target` (reuniões agendadas, `leads.meeting_scheduled_at`).
- **realizadas** → `meetings_held_target` (reuniões realizadas, `leads.won_at`).

⭐ `opportunity_target` per-usuário **não estava 100% morto**: era o *gate* de `countSdrsForIdeal` ([ranking-metrics.service.ts:84](../../../src/features/dashboard/services/ranking-metrics.service.ts)) — divisor do "ideal/dia" das reuniões (SDRs que "têm meta individual"). Como estava tudo 0, já caía no **fallback** (todos os SDRs ativos).

## Correção (#263)

**Banco** — migration `20260811120000_goals_per_user_leads_opened_target.sql` (aplicada em prod via MCP):
- Nova coluna `goals_per_user.leads_opened_target` (integer, NOT NULL default 0).

**Modal de metas** — coluna renomeada **oportunidades → leads**, ligada a `leadsOpenedTarget`; referência do mês anterior passa a mostrar o leads do mês passado.

**Card "Leads Abertos" do dashboard** — `fetchLeadsOpenedRanking` passa a usar a **meta individual por SDR** como ideal/dia (mesmo mecanismo das reuniões). Helper `fetchIndividualMeetingTargets` generalizado → `fetchIndividualTargets` (aceita `leads_opened_target | meetings_scheduled_target | meetings_held_target`). SDR sem meta individual cai no ideal compartilhado (meta org ÷ nº de SDRs).

**`opportunity_target` per-usuário fica vestigial:** não é mais editado pela UI; **omitido do upsert** (preserva histórico no conflito, default 0 em inserts). O gate `countSdrsForIdeal` continua nele e já caía no fallback → **sem efeito colateral nos cards de reunião**.

Arquivos: [`get-goals.ts`](../../../src/features/dashboard/actions/get-goals.ts), [`save-goals.ts`](../../../src/features/dashboard/actions/save-goals.ts), [`goals.schema.ts`](../../../src/features/dashboard/schemas/goals.schema.ts), [`types/index.ts`](../../../src/features/dashboard/types/index.ts), `src/lib/supabase/types.ts` (só o bloco `goals_per_user`), + testes.

## Verificação

- `pnpm typecheck`, `pnpm lint`, `pnpm build` ✅
- 141 testes do dashboard (inclui 1 novo travando o ideal/dia por SDR de leads no card) ✅
- CI verde (4m30s); merge com SHA conferido + `CLEAN/MERGEABLE`.

## ⭐ Lições / pegadinhas

- **`goals_per_user.opportunity_target` é legado mas ainda é o gate do "ideal/dia"** das reuniões (`countSdrsForIdeal`). Não repropor cegamente — repropor por coluna nova (`leads_opened_target`) e deixar o gate intacto evitou mexer no divisor das reuniões.
- **`fetchIndividualTargets`** é o mecanismo genérico de "meta individual por SDR → ideal/dia" no ranking; qualquer card novo que queira meta por SDR pluga aqui.
- **Upsert PostgREST:** omitir uma coluna NOT NULL DEFAULT preserva o valor histórico no conflito (update só das colunas presentes) e cai no default em inserts — usado pra "aposentar" `opportunity_target` sem migration de dados.
- **Staging cirúrgico:** o working tree tinha trabalho **não relacionado** (lead-contacts); commitei só os arquivos da meta de leads e apliquei só os hunks de `leads_opened_target` no `types.ts` via `git apply --cached` (o `types.ts` também trazia `set_primary_lead_contact`, do lead-contacts, que ficou de fora).
- **Ref de rastreamento dessincronizou:** `git push` disse "up-to-date" mas o servidor tinha SHA antigo; resolvido com push explícito `git push origin <sha>:refs/heads/<branch> --force`.

## Pendências herdadas (não desta frente)

- **Trabalho lead-contacts em aberto** no working tree (`src/features/leads/actions/lead-contacts.ts`, `src/features/leads/index.ts`, `src/features/leads/types/index.ts`, migration `20260811130000_lead_contacts.sql`) — deixado intacto e fora do #263; commitar em PR próprio.
- Opção C (Service Account + DWD) do reagendamento n8n — guia + prompt em `docs/guides/n8n-google-calendar-service-account-dwd.md`; bloqueado aguardando `client_email` da SA + onde a private key vive no n8n.
- Compartilhar agendas do Pedro e Jhonata com a conta do n8n (tarefa Google-side do usuário).
- Re-rodar `check-api4com-config` do ramal 1042.
