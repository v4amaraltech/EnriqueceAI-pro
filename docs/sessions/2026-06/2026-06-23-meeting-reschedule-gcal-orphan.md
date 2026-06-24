# Sessão 2026-06-23 — Reagendamento de reunião × evento órfão no Google Calendar

**Agente:** @devops (Gage) · **Branch base:** main

## Problema (relato Ismael Dobelin)

SDR reagendou reunião pelo botão "Reagendar" (09:00 → 17:30 no mesmo dia, lead **Recanto Minimercado**). Ferramenta passou a mostrar 17:30, mas o Google Calendar continuou exibindo o evento às 09:00.

## Diagnóstico (dados de produção, somente leitura via MCP)

- Banco **correto**: `meeting_starts_at = 2026-06-23 20:30 UTC = 17:30 BRT`, `calendar_event_id = t7enda…` presente.
- Conexão de calendário do Ismael (`ismael.dobelin@v4company.com`): `connected`, **token renovado 2s antes** do log de reagendamento → `updateMeeting` completou sem erro e o PATCH no Google rodou com token válido.
- **Confirmação final:** após o Ismael apagar o 09:00, a agenda ficou **só com o 17:30** → o evento canônico sempre esteve certo; o 09:00 era **órfão** (não duplicata do evento bom).

**Raiz:** `deleteMeeting` apagava o evento do Google em modo best-effort e **engolia a falha num `console.warn` silencioso**. Um cancelamento anterior (18/06) cujo delete falhou deixou o 09:00 pendurado, sem nada rastreá-lo — nenhum reagendamento futuro alcança um evento que o app não conhece mais.

## Entrega — PR #84 (mergeado, deployado via Coolify `ee2bdc6`, confirmado)

| Mudança | Arquivo |
|---------|---------|
| `deleteMeeting`: retry no delete + log em **nível de erro** (era `warn` engolido); cancelamento ainda prossegue se Google falhar | `integrations/actions/schedule-meeting.ts` |
| `CalendarEventGoneError` (404/410) em `updateCalendarEvent`; `updateMeeting` **recria** o evento nesse caso e loga em erro quando `calendar_event_id` falta | `integrations/services/calendar.service.ts`, `…/actions/schedule-meeting.ts` |
| Bug de fuso −3h no texto da timeline (`new Date()` sobre datetime naive de SP em servidor UTC) → novo util `formatMeetingDateTime` sem matemática de fuso | `integrations/utils/format-meeting-datetime.ts` |
| Testes: `format-meeting-datetime` (4) + `updateCalendarEvent` PATCH/404/410/500 (4) | `…/utils/*.test.ts`, `…/services/calendar.service.test.ts` |

Quality gate: typecheck ✓ · lint ✓ · **1409 testes** ✓ · build ✓ · CI ✓.

## Limpeza one-time (manual, fora do git)

Evento 09:00 do Ismael apagado manualmente no Google Calendar (não dá via app — token criptografado). Agenda confirmada só com 17:30.

## Notas

- App **não expõe** endpoint/header de versão; `/api/health` é só liveness. Mudanças server-only não vão pro bundle do cliente → confirmar deploy pelo **commit no painel Coolify**.
- Memória do projeto registrada: `meeting-reschedule-gcal-orphan.md`.
