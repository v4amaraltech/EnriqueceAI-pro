# Story: Power Dialer 100% automático — todos os números, 3x/dia, e a IA registra o resultado

**Status:** InReview
**Tipo:** Feature / telefonia + IA
**Origem:** Vini (05/11/2026): "A tela do Power Dialer eu quero que seja 100% automático quando ligar o discador, que ele reconheça a chamada e registra o que aconteceu."
**Épico relacionado:** nenhum. Continua `power-dialer-auto-dial` (PR #493) e `api4com-embedded-webphone`.
**Estimativa:** L. Um PR.
**Plano:** `/Users/mercante/.claude/plans/a-tela-do-power-validated-snowglobe.md`

## Dependências
- Webphone embutido ligado e registrado na aba (`api4com_connections.webphone_enabled`).
- Gravação da API4COM chegando no webhook (`recordUrl`) e chave do OpenRouter (transcrição Whisper + análise).
- Mesma regra de pausa da story `callback-pauses-cadence` (PR #463, ainda aberto): o arquivo `activities/utils/callback-resume.ts` é idêntico ao do PR #463, então os dois juntam sem conflito.
- Sem migration (tudo em `calls.metadata`).

## Problema
No modo automático, o discador só seguia sozinho quando o lead NÃO atendia. Quando atendia, parava e esperava o SDR clicar em Concluir, e nenhum resultado (`calls.sdr_disposition`) era gravado. Além disso, ligava só o telefone principal e o limite de 3 ligações/dia era por lead. A transcrição/IA só rodava em ligações de 5 min ou mais.

## Valor
O SDR liga o discador e não precisa clicar em nada: todos os números do lead são tentados ao longo do dia, e as ligações atendidas ganham resultado, resumo e retorno agendado pela IA.

## Decisões do Vini (05/11/2026)
1. Atendida → desliga, conta 5 s e liga o próximo. A IA ouve a gravação e grava resultado + resumo; em dúvida, selo "Revisar".
2. Anotação = resumo da IA + o que o SDR digitou no painel.
3. Só Power Dialer (fila de atividades e página do lead continuam manuais).
4. Ligar todos os números do lead, 1x cada por rodada; até 3x por número/dia; mínimo 1 h entre tentativas no mesmo número.
5. Tarefa só conclui como "Não atendeu" na última tentativa do dia; atendeu em qualquer rodada → conclui na hora.
6. "Pediu para ligar depois" pausa a cadência até as 9h do dia útil seguinte ao retorno (mesma regra do PR #463).

## Escopo
**IN**
- Fila: tentativas de hoje por número (`calls.destination`); lead sai da fila só quando todos os números atingiram o limite. Contador "leads no limite diário" idem.
- Discador: rodadas por número, volta na fila, espera ("liberada às HH:MM") quando ninguém está liberado; atendida conclui sozinha e marca `calls.metadata.ai_outcome = { status: 'pending' }`.
- IA: transcreve ligações pendentes a partir de 10 s, classifica (`relevant_conversation`, `answered_no_progress`, `callback_requested`, `voicemail`, `technical_failure`), grava `sdr_disposition` (só se vazio), resumo em `notes` e `metadata.ai_outcome`; confiança < 0,7 ou falha → "Revisar".
- Retorno pedido → atividade de ligação agendada (sem horário → próximo dia útil 9h) e cadência pausada até o dia útil seguinte ao retorno.
- Timeline do lead: "Resultado pela IA", resumo, retorno e selo "Revisar"; evento "Cadência pausada até o retorno".

**OUT**
- Classificação ao vivo durante a ligação; Google Calendar para o retorno da IA; fila de atividades e página do lead.

## Critérios de aceite
- [ ] Dado um lead com 2 números, quando o 1º não atende, então o discador liga o 2º do mesmo lead; quando o 2º também não atende, segue para o próximo lead sem concluir a tarefa.
- [ ] Dado um número ligado há menos de 1 h, então ele não é discado de novo; se ninguém estiver liberado, a tela mostra "Aguardando: próxima ligação liberada às HH:MM" e volta a ligar sozinha.
- [ ] Dado que todos os números do lead chegaram a 3 ligações no dia sem atender, então a tarefa é concluída como "Não atendeu" e o lead sai da fila.
- [ ] Dado que o lead atende, quando a ligação acaba, então a tarefa é concluída sozinha, a ligação fica com `ai_outcome.status = 'pending'` e o próximo lead é discado após 5 s.
- [ ] Dado uma ligação pendente com gravação ≥ 10 s, então a IA grava resultado, resumo e `ai_outcome.status = 'done'`; confiança < 0,7 → selo "Revisar".
- [ ] Dado que o lead disse "me liga amanhã às 15h", então há retorno de ligação agendado para as 15h e a cadência fica pausada até as 9h do dia útil seguinte.
- [ ] Caixa postal/mensagem da operadora → resultado "Caixa postal".

## Riscos
- Gravação não chega ou chega tarde → ligação fica "Revisar" (cron expira o pendente após 2 h).
- A IA pode errar a data do retorno → horário no passado vira próximo dia útil 9h; selo "Revisar" em baixa confiança.
- Custo: ~US$ 0,015 por ligação atendida de 2 min (Whisper + gpt-4.1).
- O retorno da IA não cria evento no Google Calendar.

## Definição de pronto
typecheck, lint, testes e build verdes; teste em produção com o Vini (3 leads, um com 2 números; uma atendida com "me liga amanhã às 15h").

## File List
- `src/features/activities/utils/auto-dialer.ts` (+ teste)
- `src/features/activities/actions/fetch-dialer-queue.ts`, `fetch-dialer-stats.ts`, `complete-dialer-call.ts` (+ teste)
- `src/features/activities/components/PowerDialerTab.tsx` (+ testes), `AutoDialControls.tsx`, `DialerPreferencesDialog.tsx`
- `src/features/activities/utils/callback-resume.ts` (+ teste; idêntico ao PR #463)
- `src/app/api/webhooks/api4com/route.ts`, `src/app/api/cron/process-pending-transcriptions/route.ts` (+ teste)
- `src/features/calls/ai-outcome.ts`, `services/call-outcome-classifier.ts`, `services/apply-ai-call-outcome.service.ts`, `services/schedule-callback.service.ts`, `services/openrouter-client.ts`, `services/transcription.service.ts`, `components/CallAiOutcome.tsx` (+ testes)
- `src/features/cadences/actions/fetch-interactions.ts`, `cadences.contract.ts`, `components/LeadTimeline.tsx`, `src/features/leads/components/LeadTimelineTab.tsx`

## Change Log
- 05/11/2026 — Story criada junto da implementação (plano aprovado pelo Vini no chat). Partes A+B (discador) e C (IA) implementadas; aguarda validação @po e teste em produção.
