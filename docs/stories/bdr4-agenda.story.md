# Story: BDR-4 — Agenda sem conflito (solicitação compartilhada, reserva por intervalo, evento idempotente, conciliação)

## Status
InProgress

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-21 | Vini + Claude | Story criada a partir do plano BDR-IA (callcenter `docs/bdr/plano-bdr-ia.md`, §7.3). Migração, ações, conciliação e rotas v1 implementadas. |

## Origem
`freeBusy → insert → releitura` confirma que um evento existe, mas não impede que dois fluxos reservem o mesmo horário: consulta e criação são operações separadas. Ana (ligação) e o agente de e-mail precisam compartilhar a mesma solicitação de reunião do lead, e remarcação não pode repetir `insert`.

## Regras (contrato do plano)
- **Uma solicitação ativa por lead**, compartilhada pelos canais (índice único parcial); idempotente por `execution_id`.
- **Reserva atômica** por closer e intervalo: `calendar_slots` com `EXCLUDE USING gist (closer_id WITH =, tstzrange WITH &&)`; dois leads no mesmo horário → um recebe 409 `slot_ocupado` e novos horários.
- **Criação idempotente**: revalida freeBusy → `events.insert` com id determinístico (`bdr` + sha1(solicitação:versão), base32hex) e `extendedProperties.private.meeting_request_id`; **409 não é sucesso**: `events.get` e conferência de solicitação, horário, participante e `status != cancelled`; sem bater → `conflito` + alerta.
- **Confirmação ao lead só após releitura** do evento (`evento_criado`).
- **Remarcação é operação definida**: nova versão → reserva do novo slot → `events.patch` → libera o antigo; evento sumido → `insert` com id da nova versão. Nunca `insert` repetido para remarcar.
- **Alteração externa = reconciliação** (cron 15 min): movido pelo closer → adota; cancelado sem substituto → `conflito` + tarefa para o humano. A IA não reabre negociação após ação humana.
- Persistência no mesmo formato do agendamento manual (`interactions.meeting_scheduled` + `leads.meeting_starts_at`), para os lembretes e a confirmação da Luiza enxergarem.

## Entregue
- [x] `supabase/migrations/20260921160000_bdr4_agenda.sql` — `btree_gist`, `meeting_requests`, `calendar_slots` (EXCLUDE), cron `reconcile-meeting-requests`
- [x] `src/features/bdr-agenda/services/slots.ts` (+ testes) — `computeFreeSlots`, `slotLabelPt`, `deriveEventId`, `decideExternalChange`, `conflictMatchesRequest`
- [x] `src/features/bdr-agenda/actions/meeting-requests.ts` — get-or-create, sugestão, reserva, criação com 409 conferido, remarcação, cancelamento, confirmação
- [x] `src/features/bdr-agenda/actions/reconcile-meeting-requests.ts` + `src/app/api/cron/reconcile-meeting-requests`
- [x] `src/app/api/v1/meeting-requests` (POST), `[id]` (GET), `[id]/[action]` (slots, reserve, create-event, reschedule, confirm, cancel)
- [x] `calendar.service.ts` — `eventId`/`extendedProperties` no insert, `CalendarConflictError` (409), `getCalendarEvent`, `getCalendarConnectionWith`

## Pendente
- [ ] Aplicar migração; conferir que `btree_gist` está habilitado no projeto.
- [ ] Closer(s) do piloto com `calendar_connections` conectada (campo "Closer" da tabela de responsáveis do plano).
- [ ] n8n: Ana e agente de e-mail usam `POST /meeting-requests` (dois horários) → `reserve` → `create-event` → só então confirmam ao lead; `execution_id` = id da execução do passo.
- [ ] Watch do calendário (`events.watch`) em vez de poll, se o volume pedir.

## Testes de aceite (plano §8)
- Dois leads aceitam o mesmo horário → um `reserve` falha com 409; o outro cria o evento.
- `insert` devolve 409 com evento de outra solicitação → `conflito`, sem confirmação ao lead.
- Remarcação → `patch` no mesmo evento, slot antigo liberado só após o patch.
- Closer move o evento com o cliente → cron adota o novo horário sem reofertar; cancelado → `conflito` + tarefa.
