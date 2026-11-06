# Story: Reunião remarcada — card no Kommo só após confirmação + novo feedback do closer

**Status:** InProgress
**Tipo:** Bug fix / regra de negócio
**Origem:** Vini (08/10/2026)

## Problema
1. O "Ganho" do SDR criava o card no Kommo na hora. Quando o closer respondia "Remarcou"/"No-show", o lead reabria, mas o card ficava no Kommo sem a reunião ter acontecido. Nos últimos 120 dias, os 8 "Remarcou" tinham card.
2. Quando a reunião remarcada acontecia, o closer não recebia um novo feedback:
   - **Trava de 24h:** qualquer resposta do closer bloqueava um novo link por 24h. Caso real: Bom Demais Alimentos, Ganho de novo 23h depois do "Remarcou".
   - **Link vencido e não respondido:** fazia o novo link falhar no índice `idx_feedback_unique_pending`.
   - **Robô "reunião sem desfecho":** ignorava para sempre o lead que já tivesse qualquer feedback respondido. Também lia a hora da reunião com 3h de erro.

## Critérios de aceite
- [x] Lead **com closer**: o Ganho não cria o card. O funil/etapa escolhidos no modal ficam salvos em `metadata.crm_options` da interação `lead_won`.
- [x] Lead **sem closer**: o Ganho continua criando o card.
- [x] Closer responde "Realizada" → o card é criado (`pushConfirmedMeetingToCrm`), com os `crm_options` salvos ou com os defaults da conexão.
- [x] Rede de segurança: feedback vencido sem resposta, com o lead ainda `won` → o cron `feedback-reminders` cria o card.
- [x] Feedback novo depois de "Remarcou"/"No-show" não é bloqueado. Só bloqueia se o closer já confirmou "Realizada" desde o início da reunião atual.
- [x] Link vencido e não respondido é reativado (novo prazo de 7 dias e cobranças zeradas), em vez de falhar.
- [x] O aviso "reunião no futuro" usa `leads.meeting_starts_at` (fuso certo).
- [x] O envio do feedback no Ganho roda em `after()`.
- [x] RPC `find_meetings_pending_outcome` avalia cada reunião (migration `20261008120000`) — aplicada em prod 08/10 (grants intactos; tipos sem mudança, mesma assinatura).
- [x] O robô continua sem mandar feedback ao closer (decisão do PR #79 mantida). Para a reunião remarcada que passou sem Ganho, ele cobra o SDR pela tarefa "registrar desfecho".

### Complemento (09/10): funil fixo no Ganho
Caso MILPAPER (09/10): o card foi criado no funil 13534608, e não no funil de sempre, porque o SDR escolheu outro funil na janela de Ganho. Nos últimos 60 dias, 175 dos 176 cards foram para o funil padrão.
- [x] Janela de Ganho: com funil e etapa padrão configurados na conexão, eles aparecem só para leitura. Não há mais seletor.
- [x] Servidor (`applyConnectionDefaults`): troca qualquer funil/etapa enviado pelo padrão da conexão e mantém o responsável.
- [x] Responsável no Kommo pré-selecionado com o usuário de mesmo e-mail do closer. O SDR ainda pode trocar.
- [x] Conexão sem padrão configurado (outras orgs): mantém os seletores como antes.

## Fora de escopo
- Mexer em cards que já existem no Kommo (lista entregue ao Vini para decisão manual).

## File List
- `src/features/leads/actions/lead-crm.ts`
- `src/features/leads/components/LeadDetailLayout.tsx`
- `src/features/leads/services/crm-push.service.ts`
- `src/features/leads/services/crm-push-confirmed.test.ts` (novo)
- `src/features/leads/actions/send-closer-feedback.ts`
- `src/features/leads/actions/send-closer-feedback.test.ts`
- `src/app/api/feedback/route.ts`
- `src/app/api/cron/feedback-reminders/route.ts`
- `supabase/migrations/20261008120000_meeting_outcome_per_meeting.sql` (novo)

## Change Log
- 2026-10-08: implementação (@dev).
- 2026-10-09: PR #461 mesclado e no ar; complemento funil fixo no Ganho (@dev).
