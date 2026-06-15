# Handoff — 2026-06-15: Atividades Atrasadas fantasma (dashboard + raiz no executeActivity)

## Contexto
Sessão na V4 Company Amaral (org `c2727473-1df8-4faa-9264-a9fc1759fe3b`).
O gestor reportou: o card **Atividades Atrasadas** (Dashboard › Visão geral)
mostrava **254**, mas vários SDRs juravam não ter nenhuma atrasada na fila — e
estavam certos.

> **Status final: resolvido e em produção, em 2 PRs.**
> - **PR #37** (`fix: align dashboard overdue card with SDR queue`) — alinha o RPC
>   do dashboard à fila do SDR + reconcilia os 99 enrollments presos em produção.
> - **PR #38** (`fix: make enrollment advance atomic in executeActivity`) — corrige
>   a **origem**: avanço de enrollment agora é atômico/idempotente via RPC.
>
> Tudo na `main`. RPCs já aplicados em produção; código sobe via Coolify.

## Diagnóstico (investigação no banco de produção)

O dashboard e a fila do SDR usavam **duas definições diferentes de "feito"**:

- **Fila** (`fetch-pending-activities.ts:213`) esconde qualquer step que já tenha
  uma **interaction não-`failed`** (RPC `get_executed_steps`), pula `auto_email`
  e suprime WhatsApp em lead `whatsapp_invalid_at` (linha 165).
- **Dashboard** (`ranking-metrics.service.ts:744` → RPC `list_overdue_enrollments_brt`)
  só olhava o **estado do enrollment** (`current_step`/`next_step_due` vencido).

Elas divergem sempre que uma interaction é gravada **sem o enrollment avançar** →
"fantasma": contado no dashboard, invisível na fila.

Decompondo os 251 contados (snapshot) por SDR — bate exatamente com o print:

| SDR | Dashboard | Fantasma (já feito) | Fantasma (WhatsApp travado) | Real na fila |
|-----|-----------|---------------------|------------------------------|--------------|
| Rafael Alécio | 106 | 0 | 0 | **106 (atraso real)** |
| **Giovanni Olivieri** | **98** | **77** | **20** | **0** |
| Ismael Dobelin | 23 | 0 | 2 | 21 |
| Matheus Martins | 12 | 0 | 0 | 12 |
| Guilherme Marques | 11 | 0 | 0 | 11 |

~100 eram fantasmas; quase todos do Giovanni, cuja fila estava **vazia**. Os 77
"já feito" eram steps de **Pesquisa** (média 1.0 interaction/step, nenhum era o
último step): o SDR usou a IA de pesquisa, gravou interaction, mas o enrollment
**não avançou** o `current_step` → preso pra sempre (a fila esconde via
`get_executed_steps`, o guard de idempotência bloqueia retry). Os 20 eram steps
de WhatsApp travados em número marcado como inválido.

## Causa-raiz (no executeActivity)
`executeActivity` gravava a interaction e **depois** avançava o enrollment em
**~5 round-trips JS** (queries de step/enrollment/next + insert de skipped +
update). Se qualquer round-trip falhasse **entre** o insert da interaction e o
UPDATE final, o enrollment ficava preso. Pior: o guard de idempotência
(`if (existingInteraction) return ALREADY_EXECUTED`) barrava o retry, tornando o
estado permanente.

Canais com envio (email/WhatsApp): falha de envio marca a interaction `failed` e
retorna **antes** do avanço — recuperável (a fila remostra `failed`). Não era a
causa. A causa eram os canais **sem envio** (Pesquisa dominante).

---

## Correção 1 — Dashboard alinhado à fila (PR #37)

`list_overdue_enrollments_brt` passou a excluir os mesmos casos que a fila esconde:
1. cadências `auto_email`
2. step atual de WhatsApp em lead com `whatsapp_invalid_at`
3. step atual que já tem interaction não-`failed` (espelha `get_executed_steps`)

Reconciliação em produção dos **99 enrollments presos**: avançados pro próximo
step acionável (mirror do comportamento do app), com **backup reversível** em
`public._overdue_reconcile_backup_20260615` (pode dropar após alguns dias).
Verificado: 99 avançaram, 0 ainda atrasados, 0 órfãos.

**Resultado:** Giovanni 98→0; total 251→130 (todos reais).

## Correção 2 — Avanço atômico (PR #38, raiz)

- **Novo RPC `advance_enrollment_after_step(p_enrollment_id, p_executed_step_id, p_performed_by)`**
  — avança/completa numa **transação única**, com `FOR UPDATE` (serializa
  concorrência), **idempotente** (`current_step > executed → no-op`, não regride
  nem duplica), auditando steps pulados. Retorna `(advanced, completed, new_step)`.
- `executeActivity` substitui os round-trips pelo RPC (helper `advanceEnrollment`).
- **Guard de idempotência agora reconcilia**: se já existe interaction não-failed,
  chama o RPC (cura strand residual / duplo clique) e retorna **sucesso** em vez
  de `ALREADY_EXECUTED`.
- Notificação `cadence_completed` disparada quando o RPC sinaliza `completed`.

## Arquivos
**Dashboard (PR #37):**
- `supabase/migrations/20260615140000_align_overdue_rpc_to_queue.sql` — RPC overdue.

**Raiz (PR #38):**
- `supabase/migrations/20260615150000_advance_enrollment_after_step_rpc.sql` — RPC novo.
- `src/features/activities/actions/execute-activity.ts` — usa o RPC, guard reconcilia,
  helper `advanceEnrollment` (removeu imports `ERR_ALREADY_EXECUTED` e `CHANNEL_LABELS`).
- `src/features/activities/actions/execute-activity.test.ts` — testes atualizados
  (interaction existente agora reconcilia → sucesso; assertiva do RPC de avanço).

## Validação
- `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm build` ✅
- 80 testes de `src/features/activities` ✅
- CI `Lint·Typecheck·Test·Build` ✅ nos dois PRs (#37 3m43s, #38 3m35s)
- RPCs aplicados em produção via MCP; smoke-test dos guards ok.

## Verificação pós-deploy (dashboard, 15/06 fim do dia)
Reproduzido o cálculo do dashboard (RPC novo `list_overdue_enrollments_brt` +
filtros do service) com reverificação de fantasmas — **zero fantasmas** em todos
os SDRs:

| SDR | Dashboard conta | Fantasma "já feito" | Fantasma WhatsApp |
|-----|-----------------|---------------------|-------------------|
| Rafael Alécio | 95 | 0 | 0 |
| Ismael Dobelin | 21 | 0 | 0 |
| Matheus Martins | 11 | 0 | 0 |
| Giovanni Olivieri | 10 | 0 | 0 |
| Guilherme Marques | 4 | 0 | 0 |
| **Total** | **141** | **0** | **0** |

- **Giovanni 98 → 10**: os 98 eram todos fantasmas; os 10 atuais são atrasadas
  **reais** (step atual não-feito, sem WhatsApp travado) — batem com a fila dele.
- O total flutua em tempo real (SDRs trabalhando + novos steps vencendo); por isso
  difere dos 130 logo após a reconciliação. O que importa: 0 fantasmas, o número
  reflete exatamente o que os SDRs têm na fila.
- Saúde dos 99 reconciliados rechecada: 99/99 avançados, 0 regrediram a preso.

## Processo / infra (relembrar)
- Repo `Mercantes/EnriqueceAI-pro` é **redirect** pra `v4amaraltech/EnriqueceAI-pro`.
  Usar `--repo v4amaraltech/EnriqueceAI-pro` no `gh`.
- **Migrations Supabase NÃO sobem pelo Coolify** (deploy é só de código). RPCs
  foram aplicados direto em produção via MCP `execute_sql`; os arquivos de migration
  ficam no repo pra rastreabilidade/outros ambientes (CREATE OR REPLACE = idempotente).
- **Coolify auto-deploy**: merge na `main` dispara build/deploy do código sozinho.

## Pendências
- ~~Dropar `public._overdue_reconcile_backup_20260615`~~ — **feito** (15/06, após
  rechecar saúde dos 99: 99/99 avançados, 0 regrediram). Tabela não existe mais.
- **Rotação do `CRON_SECRET`** segue PENDENTE (fora desta sessão — não trocar no
  Coolify antes do verificador multivalor `feat/cron-secret-multivalue` no ar).
