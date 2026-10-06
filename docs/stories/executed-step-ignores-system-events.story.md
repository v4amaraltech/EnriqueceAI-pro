# Story: Evento automático não conta como "passo feito" + Ligação via WhatsApp para lead sem WhatsApp

## Status
Done

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-06 | @devops | PR #458 mesclado e no ar (`4e5781a`); migration em prod. Status → Done. O SQL de destravamento dos 12 casos segue com o Vini (bloqueado para o agente); a correção de reinscrição foi para a story `interaction-enrollment-scope`. |
| 2026-10-06 | @dev (Dex) | Escopo reduzido após revisão: o índice único `uq_interactions_sent_step_lead` não conhece a inscrição, então recortar "passo feito" por `enrolled_at` faria o passo reaparecer sem poder ser registrado (23505). Reinscrição vira story separada; os 12 casos travados do Guilherme são destravados com ajuste de dados. |
| 2026-10-06 | @dev (Dex) | Implementado + testado. |
| 2026-10-06 | Vini + Claude | Story criada: 21 cadências do Guilherme travadas e invisíveis (análise da carteira, 06/out). |

## Origem

O Guilherme tinha 28 cadências com vencimento antigo que não apareciam na fila nem como atrasadas. Só 7 eram pendência normal. As outras 21:

| Causa | Qtd | Tratamento |
|---|---|---|
| Evento `step_skipped` (type `sent`, com `step_id`) contado como execução | 6 | **Código** (esta story) |
| Ligação via WhatsApp para lead sem WhatsApp — robô e botão só pulavam `channel='whatsapp'` | 3 | **Código** (esta story) |
| Passo feito, mas a cadência voltou atrás (Recovery, 22–23/09) | 2 | Ajuste de dados |
| Lead reinscrito na mesma cadência — execução da inscrição antiga esconde o passo | 10 | Ajuste de dados agora; correção estrutural em story separada |

## Acceptance Criteria

1. "Passo já feito" ignora interactions `channel = 'system'` em: `get_executed_steps` (fila), `list_overdue_enrollments_brt`, `list_overdue_activities_brt` (card), `fetch_overdue_manual_activities` (resumo), idempotência do `executeActivity` e do motor de e-mail.
2. O índice único passa a ser `uq_interactions_sent_step_lead_real` (`type='sent' AND step_id IS NOT NULL AND channel <> 'system'`): evento automático não ocupa mais a vaga da execução real.
3. Robô `whatsapp-invalid-skip` e botão "Não é WhatsApp" tratam "Ligação via WhatsApp" (`phone` + `call_provider='whatsapp'`) como passo de WhatsApp (`isWhatsAppStep`).
4. Os 12 casos do Guilherme (10 reinscritos + 2 da Recovery) avançam para o primeiro passo ainda não feito (pulando WhatsApp para lead sem WhatsApp), com backup `_bkp_executed_step_recovery_20261006`.

## Scope

**IN:** migration `20261006120000` (índice + 4 funções, assinaturas iguais), `execute-activity.ts`, `execute-cadence.ts`, `whatsapp-invalid-skip.service.ts`, `report-whatsapp-invalid.ts`, testes, SQL de destravamento (`docs/sessions/2026-10/2026-10-06-destravar-cadencias-guilherme.sql`).

**OUT (story separada):** lead reinscrito na mesma cadência — exige ligar interaction à inscrição (`enrollment_id`) e escopar o índice por ela; parada por resposta/bounce também olha a cadência inteira (`execute-cadence.ts`); 2 reinscritos fora do Guilherme (Giovanni 1, sem dono 1); investigar o que voltou o `current_step` da Recovery em 22–23/09.

## Tasks

- [x] Migration (índice + 4 funções)
- [x] `executeActivity` e motor de e-mail ignoram `system` + teste
- [x] Robô e botão "Não é WhatsApp" cobrem Ligação via WhatsApp + testes
- [x] Backup `_bkp_executed_step_recovery_20261006` (12 linhas, RLS + REVOKE)
- [ ] Rodar SQL de destravamento (bloqueado pela permissão do agente — Vini roda no SQL Editor)
- [x] typecheck / lint / test:run / build
- [x] Aplicar migration em prod (06/out, MCP) — índice novo no lugar do antigo, grants inalterados
- [x] PR #458

## File List

- `supabase/migrations/20261006120000_executed_step_ignores_system_events.sql` (novo)
- `src/features/activities/actions/execute-activity.ts` (modificado) · `execute-activity.test.ts` (modificado)
- `src/features/activities/actions/report-whatsapp-invalid.ts` (modificado) · `report-whatsapp-invalid.test.ts` (modificado)
- `src/features/cadences/actions/execute-cadence.ts` (modificado)
- `src/features/cadences/services/whatsapp-invalid-skip.service.ts` (modificado) · `whatsapp-invalid-skip.service.test.ts` (modificado)
- `src/features/whatsapp-calls/actions/persist-call.ts` (comentário)
- `docs/sessions/2026-10/2026-10-06-destravar-cadencias-guilherme.sql` (novo)
- `docs/stories/executed-step-ignores-system-events.story.md` (novo)
