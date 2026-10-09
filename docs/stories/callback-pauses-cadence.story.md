# Story: "Pediu para ligar depois" pausa a cadência até o retorno

**Status:** InReview
**Tipo:** Bug fix / regra de negócio
**Origem:** Vini (09/10/2026) — caso Épou Store (lead `f8e8c883-5111-4f18-a3ed-272774d5002c`, SDR João Fogaça)

## Problema
O "Pediu para ligar depois" só criava a atividade de retorno. A cadência seguia ativa e continuava gerando tarefas antes da data combinada com o lead.

Caso real: em 05/10 o lead pediu retorno para 20/10 às 9h. Em 09/10 caiu na fila o passo 5 da Recovery (ligação), mesmo com o retorno já marcado.

Bug junto: a timeline mostrava o horário do retorno em UTC ("20/10/2026, 12:00" para um retorno às 9h).

## Decisão (Vini, 09/10/2026 — opção 1 de 3)
A cadência fica pausada até as **9h BRT do dia útil seguinte ao retorno** e depois retoma sozinha. A alternativa de encerrar a cadência foi descartada porque deixava o lead sem acompanhamento se ele sumisse no retorno.

## Critérios de aceite
- [x] O desfecho "Pediu para ligar depois" pausa todas as inscrições **ativas** do lead, com `scheduled_start_at` = 9h BRT do dia útil seguinte ao retorno. Vale para os dois discadores: API4COM e Ligação via WhatsApp.
- [x] A retomada reaproveita a "prospecção agendada" (`execute-cadence` reativa `paused` + `scheduled_start_at`). Nada novo no banco.
- [x] Quando a ligação é de um passo de cadência, o passo é avançado **antes** da pausa. Isso evita a corrida com o "concluir", porque o RPC só avança inscrição ativa.
- [x] Novo "ligar depois" com a cadência já pausada empurra a retomada para frente. Nunca encurta. Pausa sem data (manual ou do motor) não é tocada.
- [x] A timeline registra `cadence_paused_for_return` ("Cadência pausada até dd/mm/aaaa — retorno combinado com o lead em …"), e esse evento entra nos eventos de ciclo de vida.
- [x] O SDR recebe um aviso: "Cadência pausada até dd/mm".
- [x] O horário do retorno na timeline sai em BRT.
- [x] Perdido/Ganho continuam encerrando inscrições `paused` (sem reativação indevida). Inscrição pausada fica fora do auto-loss enquanto espera.

## Fora de escopo
- O texto da reativação feita pelo motor continua "Prospecção agendada reativada".
- Feriados não contam na retomada, igual ao `skip_weekend_brt`.

## Correção manual em prod (09/10/2026)
A inscrição Recovery `1ce9cdaa-fbb7-4938-95e0-1cb518d6a99b` (Épou Store) foi pausada com retomada em 21/10 às 9h BRT. O estado anterior ficou no metadata da interação `57e91586-a97c-4307-baef-d433a455b41c`: passo 5, `next_step_due` 12/10, `snooze_count` 1.

## File List
- `src/features/activities/utils/callback-resume.ts` (novo)
- `src/features/activities/utils/callback-resume.test.ts` (novo)
- `src/features/activities/actions/schedule-activity.ts`
- `src/features/activities/actions/schedule-activity.test.ts` (novo)
- `src/features/activities/components/ActivityPhonePanel.tsx`
- `src/features/activities/components/ActivityExecutionSheetContent.tsx`
- `src/features/whatsapp-calls/components/ActivityWhatsAppCallPanel.tsx`
- `src/features/cadences/actions/fetch-interactions.ts`
- `src/features/cadences/components/LeadTimeline.tsx`

## Change Log
- 09/10/2026 — Story criada e implementada (typecheck, lint e 2397 testes ok).
