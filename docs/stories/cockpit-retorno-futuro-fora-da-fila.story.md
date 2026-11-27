# Story: Retorno futuro fica fora da discagem e a IA não troca a data marcada

**Status:** InProgress

## Contexto
Retorno marcado para 02/12: a discagem ligou de novo em 25, 26 e 27/11 e, em 27/11, a IA ("sem horário") cancelou o retorno e criou outro para 30/11.

## Critérios de aceite
- [x] Fila normal: lead com retorno de ligação pendente no futuro fica fora até a hora (escolha e portão).
- [x] Retorno vencido ainda não atendido segue no topo, mesmo havendo outro futuro. Recuperação sem mudança.
- [x] IA sem data/hora dita pelo lead não cria nem cancela quando há retorno futuro; pausa a cadência por ele.
- [x] IA com data/hora substitui, salvo retorno marcado depois do início da ligação.
- [x] Sem retorno ou só vencido: como antes.
- [x] Falha ao ler o retorno existente: nada é criado nem cancelado; ligação marcada para revisar.
- [ ] Conferir em produção.

## Fora do escopo
- Power Dialer (`activities`): não olha retornos futuros.
- Ligação manual não muda.

## File List
- `src/features/cockpit/services/cockpit-auto-dial.service.ts`
- `src/features/cockpit/services/cockpit-recovery-candidates.service.ts` (`loadFutureReturnLeadIds`)
- `src/features/cockpit/services/cockpit-auto-dial.callbacks.test.ts`
- `src/features/cockpit/auto-dial.types.ts`
- `src/features/calls/services/apply-ai-call-outcome.service.ts` (+ teste)
- `src/features/calls/services/schedule-callback.service.ts` (+ teste)
- `docs/stories/cockpit-retorno-futuro-fora-da-fila.story.md` (novo)
