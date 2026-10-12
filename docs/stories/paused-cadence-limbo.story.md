# Story: Cadência pausada sem data de volta não deixa o lead no limbo

## Status
InProgress

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-12 | @dev (Dex) | Implementado + testado. typecheck ✅ lint ✅ 2410 testes ✅ (+14 novos) build ✅. Não commitado. |
| 2026-10-12 | Vini + Claude | Story criada. Alerta de limbo foi de 57 (06/out) para 72 (12/out). Decisões do Vini: pausa sem volta → **tarefa para o SDR decidir**; bounce → **pular só os passos de e-mail**. |

## Origem

O alerta diário de limbo (`v_leads_cadence_limbo`) subiu de 57 em 06/out para 72 em 12/out. Diagnóstico de 12/out, com 48 leads na view:

- 47 dos 48 estão com cadência `paused` e sem `scheduled_start_at`. Pausa assim não volta sozinha: fica fora da fila, do auto-perda (`fetch_inactive_enrollment_candidates`) e do motor.
- Fontes da pausa:
  - **8 por bounce (novos, 04–12/out).** `recordBounce` pausava TODAS as outras cadências do lead, sem registro na timeline. Ex.: o bounce na "E-mail (auto)" parava a Inbound 2.0, que tem ligação e WhatsApp.
  - 11 por "Não é WhatsApp" no último passo da Recovery.
  - 10 pelo motor na "Recovery — E-mail (auto)" (token do Gmail vencido / sem e-mail).
  - 19 por pausas manuais antigas (Agro 13 sem dono, Fria 5, Educação 1).

## Story

**As a** gestor de pré-venda,
**I want** que nenhum lead "Contatado" fique sem próxima atividade por causa de uma pausa,
**so that** todo lead vivo esteja na fila de alguém.

## Acceptance Criteria

1. Um bounce marca `bounced` só na inscrição da cadência que enviou o e-mail. As outras inscrições do lead continuam `active`.
2. O bounce grava o evento `email_bounced` na timeline do lead.
3. Nas cadências de SDR (`standard`), o motor pula os passos de e-mail de lead com `email_bounced_at`:
   - se houver passo de outro canal adiante, avança para ele (evento `step_skipped_email_bounced`);
   - se só restarem passos de e-mail, encerra a cadência e aplica a regra de Perdido do fim de cadência.
   - Cadências `auto_email` ficam de fora.
4. A fila de atividades esconde passos de e-mail de lead com bounce.
5. Todo dia útil às 9h BRT (antes do alerta de limbo), cada lead que atende a todas as condições abaixo ganha uma tarefa "Definir destino" (`scheduled_activities`, canal `research`) para o dono, com cadência e motivo na nota:
   - está no limbo;
   - tem dono;
   - tem cadência pausada sem data de volta;
   - está há 3 ou mais dias úteis sem contato.
6. A criação da tarefa grava o evento `paused_cadence_followup`. Lead que acabou de ganhar tarefa só ganha outra depois de 3 dias úteis sem contato.
7. Há um teto de 30 tarefas por org por execução. Lead sem dono não gera tarefa e continua no alerta aos gestores.

## Scope

**IN:**
- `recordBounce`;
- pulo genérico de canal bloqueado (`whatsapp-invalid-skip.service.ts`);
- filtro da fila;
- tarefa "Definir destino" rodando no cron `cadence-limbo-alert` (sem cron novo);
- rótulos da timeline;
- SQL do passivo.

**OUT:**
- RPCs de atrasadas (o passo de e-mail com bounce dura no máximo 1 ciclo do motor, ~5 min);
- `total_steps` desatualizado da "BDR IA — Arroz (contato)";
- 3 inscrições da Recovery com `current_step` além do fim. O auto-perda de 14d já as pega.

## Tasks
- [x] Bounce não pausa as outras cadências + evento na timeline
- [x] Pulo de passos de e-mail no motor (cadências de SDR)
- [x] Fila esconde passos de e-mail com bounce
- [x] Tarefa "Definir destino" no cron do alerta de limbo
- [x] Rótulos da timeline (`email_bounced`, `step_skipped_email_bounced`, `step_skipped_whatsapp_invalid`, `paused_cadence_followup`)
- [x] Testes
- [ ] PR + deploy
- [ ] Passivo: retomar os 8 pausados por bounce (`docs/sessions/2026-10/2026-10-12-retomar-pausados-por-bounce.sql`)
- [ ] Decisão do Vini: 13 leads do Agro sem dono

## File List
- `src/features/cadences/actions/check-email-replies.ts` (+ teste)
- `src/features/cadences/services/whatsapp-invalid-skip.service.ts` (+ teste)
- `src/features/cadences/actions/execute-cadence.ts`
- `src/features/activities/actions/fetch-pending-activities.ts`
- `src/features/cadences/actions/paused-cadence-followup.ts` (novo, + teste)
- `src/features/cadences/services/paused-cadence-followup.logic.ts` (novo, + teste)
- `src/app/api/cron/cadence-limbo-alert/route.ts`
- `src/features/cadences/components/LeadTimeline.tsx`
- `src/features/cadences/actions/fetch-interactions.ts`
- `docs/sessions/2026-10/2026-10-12-retomar-pausados-por-bounce.sql` (novo)

## Verificação em prod (pós-deploy)
1. Rodar o passivo SQL (bounce) e conferir que a Inbound 2.0 desses leads volta a gerar tarefa.
2. No 1º disparo do cron das 9h: conferir as tarefas criadas por SDR e a queda da `v_leads_cadence_limbo`.
3. No próximo bounce real: conferir que as outras cadências do lead seguem `active`.
