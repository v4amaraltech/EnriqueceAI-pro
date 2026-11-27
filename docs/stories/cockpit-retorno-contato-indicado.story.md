# Story: Cockpit — o retorno guarda o contato indicado

**Status:** InProgress (entrega 1 de 3)

## Contexto
Em "Indicou outra pessoa" o indicado é cadastrado como contato, mas o retorno não sabe quem é: o motor disca o contato principal. O Vini aprovou a opção completa, em 3 entregas.

## Critérios de aceite

### B1 — o retorno guarda o contato (a discagem não muda)
- [x] `scheduled_activities.contact_id` (opcional, `ON DELETE SET NULL`) com índice parcial.
- [x] "Indicou outra pessoa" grava o id do indicado no retorno.
- [x] O servidor só aceita contato do mesmo lead e org; contato inválido não perde o retorno (grava sem contato e registra aviso).
- [x] Quem não manda contato ("Ligar depois" e demais telas) segue idêntico.
- [x] Simulado/preview: nada é gravado.
- [ ] Migration aplicada em produção **antes** do deploy do código.

### B2 — motor do Cockpit
- [ ] Retorno com contato: o motor disca o número do contato.
- [ ] Card mostra "Retorno com {nome}".
- [ ] A leitura do contato filtra por lead e org; sem contato ou sem telefone, segue como hoje.

### B3 — aba Retornos / Atividades
- [ ] O número do contato do retorno vem pré-selecionado.

## Pontos para B2/B3
- Retorno agendado pela IA (`calls/services/schedule-callback.service.ts`) cancela os pendentes do lead e grava sem contato.
- Qualquer novo "Ligar depois" do mesmo lead substitui o retorno (e o contato) anterior.

## File List
- `supabase/migrations/20261126130000_scheduled_activities_contact_id.sql` (novo)
- `src/lib/supabase/types.ts` (editado à mão: só `contact_id` e o relacionamento)
- `src/features/activities/actions/schedule-activity.ts`
- `src/features/activities/actions/schedule-activity.test.ts`
- `src/features/cockpit/components/MotorCallbackDialog.tsx`
- `src/features/cockpit/components/ReferContactDialog.tsx`
- `src/features/cockpit/components/ReferContactDialog.test.tsx`
- `src/features/cockpit/hooks/use-cockpit-auto-dial.ts`
- `src/features/cockpit/hooks/use-cockpit-auto-dial.callback.test.tsx`
- `docs/stories/cockpit-retorno-contato-indicado.story.md` (novo)
