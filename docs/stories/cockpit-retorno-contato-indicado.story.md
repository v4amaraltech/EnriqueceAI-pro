# Story: Cockpit — o retorno guarda o contato indicado

**Status:** InProgress (entrega 2 de 3)

## Contexto
Em "Indicou outra pessoa" o indicado é cadastrado como contato, mas o retorno não sabe quem é: o motor disca o contato principal. O Vini aprovou a opção completa, em 3 entregas.

## Critérios de aceite

### B1 — o retorno guarda o contato (a discagem não muda)
- [x] `scheduled_activities.contact_id` (opcional, `ON DELETE SET NULL`) com índice parcial.
- [x] "Indicou outra pessoa" grava o id do indicado no retorno.
- [x] O servidor só aceita contato do mesmo lead e org; contato inválido não perde o retorno (grava sem contato e registra aviso).
- [x] Quem não manda contato ("Ligar depois" e demais telas) segue idêntico.
- [x] Simulado/preview: nada é gravado.
- [x] Migration aplicada em produção **antes** do deploy do código.

### B2 — motor do Cockpit
- [x] Retorno vencido com contato: motor e "Ligar agora" discam o número do contato e gravam `contact_id` na ligação.
- [x] A leitura do contato filtra id + lead + org; sem contato, apagado, sem telefone válido ou com erro, liga para o principal.
- [x] Card mostra "Retorno com {nome}" (e avisa quando liga para o principal) com o mesmo número que será discado; se mudar antes de discar, o servidor recusa (`card_changed`) e o card recarrega.
- [x] Enquanto o indicado não atender, as tentativas seguem nele (retorno pendente; sai se concluído, substituído ou expirado em 3 dias).
- [x] Depois de uma conversa real com ele (`isRealConversation` em ligação com `calls.contact_id` = indicado, após o horário do retorno), volta ao principal, sem o aviso no card. Retorno novo liga para ele de novo.
- [x] Erro ao conferir a conversa: liga para o principal.
- [x] Bloqueios, tentativas, intervalo, teto e janela continuam valendo (são por lead/usuário).
- [x] Novo retorno de ligação sem contato novo herda o do pendente substituído (tela e IA), revalidando lead + org.
- [x] Número do indicado recusado (422): o lead não sai; a próxima tentativa liga para o principal, com aviso.
- [x] Telefone do indicado editado entre o card e a discagem: `card_changed`.
- [ ] Teste em tela com ligação real.

### B3 — aba Retornos / Atividades
- [ ] O número do contato do retorno vem pré-selecionado.

## Pontos para B3 / depois
- Não herdam: retorno novo que não é de ligação (cancela o anterior) e os caminhos do feedback da reunião / reabertura.
- Número do indicado recusado (422): a memória vale só na página aberta; recarregar ou reiniciar a discagem tenta o indicado de novo.
- E-mail do convite de reunião segue o do lead, mesmo com o contato no card.

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

### B2
- `src/features/activities/utils/return-contact.ts` (novo)
- `src/features/activities/actions/schedule-activity.ts` (+ teste)
- `src/features/calls/services/schedule-callback.service.ts` (+ teste)
- `src/features/cockpit/services/callback-contact.service.ts` (novo, + teste)
- `src/features/cockpit/services/cockpit-auto-dial.service.ts`, `next-call-card.service.ts` (+ `next-call-card.callback-contact.test.ts`)
- `src/features/cockpit/actions/auto-dial.ts` (+ teste), `auto-dial.types.ts`, `types.ts`
- `src/features/cockpit/components/CallbackContactNotice.tsx` (novo, + teste), `NextCallCard.tsx` (+ teste), `MotorLeadSidePanel.tsx`, `ReferContactDialog.tsx` (+ teste)
- `src/features/cockpit/hooks/use-cockpit-auto-dial.ts` (+ testes `test` e `safety`)
- `src/features/cockpit/utils/referral.ts` (comentário)
