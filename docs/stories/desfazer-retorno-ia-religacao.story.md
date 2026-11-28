# Story: Desfazer o retorno da IA quando a religação teve conversa

## Status
InReview

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-11-28 | @dev (Forge) | Implementado a pedido do Vini, opção 1 (sem validação do @po). |
| 2026-11-28 | @dev (Forge) | Mensagem do histórico passa a mostrar data e hora do retorno desfeito (pedido do Vini). |

## Origem

A IA classifica a ligação que caiu poucos segundos depois, antes de o SDR religar, e cria um retorno que fica na fila mesmo quando a religação resolve o assunto.

## Acceptance Criteria

- [x] Desfecho de conversa na religação (inclusive Agendar reunião) cancela o retorno pendente que a IA criou por uma ligação anterior da cadeia e registra na timeline, com a data e a hora do retorno cancelado (horário de Brasília).
- [x] Retorno do SDR, ou que a IA apenas manteve, não é cancelado.
- [x] Religação não atendida, caixa postal ou "não foi conversa": nada muda.
- [x] Falha ao desfazer não impede o desfecho do SDR (só log).
- [x] Cadência pausada e retornos anteriores não são restaurados; IA e `scheduleCallbackActivity` não mudam.

## Regra sobre desfecho na ligação de origem

A coluna `sdr_disposition` também é escrita pela IA, e o painel, usado durante a religação, grava o mesmo desfecho nas duas ligações. Só conta como "SDR marcou a origem" um valor diferente do da IA e do da religação.

## Scope

**OUT:** desfechos registrados fora do discador do Cockpit; Agendar reunião durante religação que não foi atendida.

## File List

- `src/features/calls/services/undo-ai-return-after-redial.service.ts` (novo)
- `src/features/calls/services/undo-ai-return-after-redial.service.test.ts` (novo)
- `src/features/cockpit/services/cockpit-auto-dial-outcome.service.ts`
- `docs/stories/desfazer-retorno-ia-religacao.story.md` (novo)
