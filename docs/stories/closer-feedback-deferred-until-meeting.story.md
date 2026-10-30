# Story: Feedback do closer quando o "Ganho" vem antes da reunião — agendar, não descartar

**Status:** InProgress
**Tipo:** Bug fix / regra de negócio
**Origem:** Vini (30/10/2026) — closer Jhonata não recebeu o link do lead NEXT360 Telecom

## Problema
Quando o SDR marca o lead como "Ganho" **antes** do horário de início da reunião (`leads.meeting_starts_at` no futuro), `sendCloserFeedbackEmail` devolve `meeting_in_future` e **descarta** o pedido: não cria linha em `closer_feedback_requests`, não manda e-mail nem WhatsApp, não grava nada na timeline e nada tenta de novo depois.

Consequências:
- O closer nunca recebe o link.
- Desde o PR #461, lead com closer só ganha card no Kommo quando o closer responde "Realizada" (`POST /api/feedback`). Sem link, sem card.
- O cron `feedback-reminders` só olha requests que já existem e venceram — não cobre.
- O botão "Reenviar feedback" (`resendCloserFeedback`) exige request pendente e devolve "Nenhum feedback pendente para este lead".

Casos reais (out/2026, closer Jhonata): NEXT360 Telecom, Construtora Epereira, Basculaço, LBB Engenharia — Ganho marcado 7 a 36 minutos antes da reunião. A recuperação desses 4 leads é feita à parte; esta story é só a correção definitiva.

## Opções avaliadas
1. **Request "agendado" (`sent_at = NULL`) + cron envia quando a reunião começa.** *(escolhida)* O Ganho sempre cria a linha; `sent_at` passa a ser o momento do **envio real** (nulo = ainda não enviado). O cron `feedback-reminders` ganha um passo que envia as linhas sem `sent_at` cujo `meeting_starts_at` já passou. Precisa de migration pequena (`sent_at` nullable, sem default). Ganha de brinde: tentativa de novo quando o e-mail/WhatsApp falha, e a timeline mostra "feedback agendado".
2. **Sem migration: cron varre leads `won` com closer e reunião passada sem request.** Não mexe no schema, mas a varredura é mais pesada, não há rastro na timeline enquanto espera, e "já tentei e falhou" fica indistinguível de "nunca tentei".
3. **Coluna nova `send_after` / `scheduled_for`.** Mais explícito, porém duplica informação que já está em `leads.meeting_starts_at` (que pode mudar quando o SDR remarca) e exige migration do mesmo jeito.

## Critérios de aceite
- [x] Ganho com reunião no futuro: cria a linha em `closer_feedback_requests` com `sent_at = NULL` e `expires_at = início da reunião + 7 dias` (provisório), grava interação `system` na timeline ("Feedback de {closer} agendado para depois da reunião") e **não** envia nada. `sendCloserFeedbackEmail` devolve `email: 'scheduled'` + `scheduledFor`.
- [x] Cron `feedback-reminders`: novo passo `sendScheduledFeedbackRequests` roda **antes** dos lembretes. Envia e-mail + WhatsApp das linhas com `sent_at IS NULL`, `responded_at IS NULL`, `expires_at > now()` cujo lead está `won` e cuja reunião já começou. Ao sair pelo menos um canal, carimba `sent_at = now()` e `expires_at = now() + 7 dias` (prazo conta do envio real). Reunião ainda no futuro: só garante `expires_at >= reunião + 7 dias` e espera.
- [x] Lembretes e rede de segurança do CRM ignoram linhas sem `sent_at` (não cobra link que não saiu; não cria card de link que nunca chegou).
- [x] `resendCloserFeedback` funciona para lead `won` com closer e sem request nenhum (cria e envia, ou agenda se a reunião ainda não começou). Lead que não está `won` e sem request continua recusado.
- [x] Nunca enviar antes do início da reunião — vale também para o reenvio manual e para o request reaproveitado.
- [x] Envio e-mail + WhatsApp + log na timeline extraídos para `closer-feedback-delivery.service.ts`, usado pela action e pelo cron.
- [x] Tela do lead: "Aguardando feedback" vira "será enviado após a reunião" enquanto `sent_at` é nulo; toast informativo no reenvio agendado; tabela de feedbacks mostra "Agendado".
- [x] Testes ao lado das actions e do cron; `pnpm typecheck && pnpm lint && pnpm test:run` verdes.

## Ordem de deploy (IMPORTANTE)
1. Aplicar a migration `20261030120000_closer_feedback_sent_at_nullable.sql` em prod **antes** do deploy — o código passa a inserir `sent_at: null`, que hoje viola o `NOT NULL`.
2. `pnpm gen:types` depois da migration aplicada (commit separado `chore(types): regenerate`).
3. O cron `feedback-reminders` roda 1x/dia (13:00 UTC). Para o link sair perto do início da reunião, trocar para 1x/hora (lembretes e CRM fallback já são idempotentes/gated por 24h):
   ```sql
   SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'feedback-reminders'), schedule := '5 * * * *');
   ```

## Fora de escopo
- Recuperar os 4 leads de outubro (sessão à parte).
- Reenviar automaticamente link que já saiu e cuja reunião foi remarcada para depois (o link antigo continua válido até vencer; o reenvio manual reativa).

## File List
- `supabase/migrations/20261030120000_closer_feedback_sent_at_nullable.sql` (novo)
- `src/features/leads/services/closer-feedback-delivery.service.ts` (novo)
- `src/features/leads/actions/send-closer-feedback.ts`
- `src/features/leads/actions/send-closer-feedback.test.ts`
- `src/features/leads/actions/resend-closer-feedback.ts`
- `src/features/leads/actions/resend-closer-feedback.test.ts` (novo)
- `src/features/leads/actions/reassign-closer.ts`
- `src/features/leads/actions/fetch-closer-feedback.ts`
- `src/features/leads/actions/fetch-closer-feedbacks.ts`
- `src/features/leads/components/LeadDetailLayout.tsx`
- `src/features/leads/components/CloserFeedbackTable.tsx`
- `src/app/api/cron/feedback-reminders/route.ts`
- `src/app/api/cron/feedback-reminders/route.test.ts` (novo)
- `docs/stories/closer-feedback-deferred-until-meeting.story.md` (novo)

## Change Log
- 2026-10-30: story criada e implementação (@dev). Sem commit — aguardando revisão do Vini.
