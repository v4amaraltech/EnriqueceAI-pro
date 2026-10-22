# Story: Power Dialer com discagem automática

**Status:** InProgress
**Tipo:** Feature / telefonia
**Origem:** Vini (22/10/2026) — "No menu Power Dialer conseguimos pensar em uma solução, onde ligamos ele e ele vira um discador automático?"
**Épico relacionado:** nenhum. Continua a story `api4com-embedded-webphone` (webphone embutido no ar, PRs #487–#492) e a `3.17.power-dialer-placeholder`.
**Estimativa:** M (3 a 4 dias úteis). Um PR.

## Dependências
- **Interna, resolvida:** PR #492 mesclado (sinal de atendimento pelo webhook: `useWebphoneLeadAnswer`, `leadAnswer` no `DialerCallPanel`).
- **Operacional:** o modo automático exige o webphone embutido ligado para o SDR (`api4com_connections.webphone_enabled`) e registrado na aba. Hoje só o Vini tem a flag.
- Sem migration.

## Problema
O Power Dialer liga um lead por vez e tudo é manual: o SDR clica para ligar, clica para concluir e só então o próximo lead aparece. Com o webphone embutido, a página já atende o ramal sozinha. O que falta é o discador encadear as ligações.

Três defeitos atuais que o modo automático multiplicaria:
1. **Linha duplicada em `calls`.** `completeDialerCall` insere uma segunda linha (`origin='power_dialer'`, 0 s) além da criada pelo `initiateCall` — 348 em jul/2026, 31 em out/2026. O limite diário por lead conta linhas de `calls`, então cada ligação do Power Dialer vale por duas.
2. **Fim de ligação não atendida não é detectado.** `useCallHangupDetection` só dispara com `status != 'not_connected'`; ligação não atendida continua `not_connected` e só o clique do SDR encerra.
3. **Etapa errada.** A fila inclui inscrições cuja etapa atual não é ligação (usa a próxima etapa de ligação). Concluir avança a cadência a partir dela e pula as etapas do meio.

## Valor
O SDR deixa de gastar cliques e atenção com números que não atendem (a maioria das tentativas: no teste de 22/10, 5 de 5 sem atendimento) e só para quando há alguém do outro lado. Ao mesmo tempo, os números ficam corretos: uma linha por ligação em `calls`, limite diário por lead contado certo e cadência sem etapas puladas.

## Decisões do Vini (22/10/2026)
- Um lead por vez (não usar "Leads simultâneos").
- Não atendeu → registra "Não atendeu" sozinho, avança a cadência e liga o próximo; o SDR só para quando alguém atende.
- 5 segundos de contagem regressiva entre ligações, com Pausar, Ligar agora e Pular.
- Só o telefone principal de cada lead.

## Escopo
**IN**
- Chave "Discagem automática" no Power Dialer (tela inicial e barra de controles), habilitada só com o webphone pronto; escolha lembrada por pessoa no navegador.
- Laço automático: contagem de 5 s → liga o principal → fim da ligação detectado pelo webphone → sinal da API4COM → não atendeu: conclui sozinho e conta 5 s para o próximo; atendeu: para e espera o SDR concluir.
- Só disca quem está na etapa de ligação; os demais ficam na lista, marcados, para uso manual.
- `completeDialerCall` grava o resultado na linha da ligação existente (sem segunda linha em `calls` nem segunda interação).
- Fim de ligação pelo webphone também no modo manual.
- Painel flutuante não pede avaliação de áudio quando o lead não atendeu.

**OUT**
- Discagem simultânea / preditiva.
- Tentar os outros números do lead.
- Intervalo configurável.
- Modo automático com a extensão do Chrome.
- Seletor de desfecho no formulário do Power Dialer quando o lead atende (continua anotações + Concluir).
- Limpeza das linhas duplicadas antigas (`origin='power_dialer'`).

## Critérios de aceite
1. **Dado** o webphone verde e a chave ligada, **quando** o SDR inicia o Power Dialer, **então** aparece "Próxima ligação em 5 s — {lead}" e, ao zerar, o telefone principal do primeiro lead elegível é discado.
2. **Dado** uma ligação em que o lead não atende, **quando** ela termina e a API4COM confirma (`hangup_cause` sem `answered_at`), **então** o resultado "Não atendeu" (0 s, anotações do painel) é gravado na mesma linha de `calls`, a cadência avança uma etapa e a contagem de 5 s começa para o próximo.
3. **Dado** uma ligação atendida, **quando** ela termina, **então** o automático para, mostra o formulário e só volta a contar depois de Concluir.
4. **Dado** que o sinal da API4COM não chega em 20 s, **então** o automático para e espera o SDR.
5. Pausar, Ligar agora e Pular funcionam durante a contagem; Pular marca o lead como pulado.
6. Leads fora da etapa de ligação nunca são discados no automático e aparecem marcados na lista.
7. Com o webphone não pronto (desconectado, sem microfone, ligação em andamento) ou erro ao discar, o automático pausa e mostra o motivo.
8. Fim da fila desliga o automático com aviso.
9. Nenhuma linha nova com `origin='power_dialer'` é criada quando há `callId`; `calls.status` nunca é escrito pelo app.
10. Ligação não atendida não pede estrelas no painel flutuante.

## Critério de pronto
Critérios 1–10 cobertos por testes; `pnpm typecheck`, `pnpm lint`, `pnpm test:run` e `pnpm build` verdes; PR mesclado e deploy confirmado; teste do Vini em produção com 3 leads (2 não atendidos passam sozinhos, 1 atendido para).

## Riscos
- O retorno da API4COM chega alguns segundos depois do fim: até 20 s em espera; depois o SDR decide.
- Limite de 15 ligações por minuto por ramal: 5 s de intervalo + toque ficam abaixo.
- Caixa postal que "atende" (`answered_at` preenchido) para o automático; o formulário já permite "Não atendeu".
- Ramal ainda ocupado logo após desligar (424): coberto pela nova tentativa do `originateCall` e pelos 5 s.

## Validação @po (22/10/2026)
Checklist de 10 pontos: 1 título ✅ · 2 descrição ✅ · 3 critérios testáveis (Dado/Quando/Então) ✅ · 4 escopo IN/OUT ✅ · 5 dependências ✅ · 6 estimativa ✅ · 7 valor de negócio ✅ (seção "Valor" adicionada na validação) · 8 riscos ✅ · 9 critério de pronto ✅ · 10 alinhamento ⚠️ (sem PRD/épico; origem é pedido direto do Vini, continuação da `api4com-embedded-webphone` e da `3.17`). **Veredito: GO, 9/10.** Status Draft → Ready. Observações para o @dev: (a) o modo automático não pode depender do Realtime para fim de ligação não atendida (critério 2) — usar o estado do webphone; (b) cobrir o critério 9 com teste que falhe se houver `insert` em `calls`; (c) CodeRabbit não está habilitado no projeto — qualidade pelos gates de lint/typecheck/test/build.

## Dev Agent Record

### Tarefas (branch `feat/power-dialer-auto-dial`, worktree `EnriqueceAI_Pro-webphone`, 22/10/2026)
- [x] Máquina de estados pura `activities/utils/auto-dialer.ts` (fases off/countdown/dialing/in-call/resolving/auto-completing/awaiting-sdr/paused; elegibilidade; preferência no `localStorage` com try/catch) — 13 testes.
- [x] Serviço `calls/services/apply-sdr-call-result.ts` extraído do `classifyWebphoneCall` (sem mudar o comportamento dele) — 2 testes + os 2 do classify.
- [x] `completeDialerCall` com `callId`/`sdrOutcome`: grava na linha existente, marca `cadence_id`/`step_id` na interação `internal_api4com`, webhook `call.completed` com o id real; caminho antigo sem `callId` mantido em função própria — 4 testes (um falha se houver `insert` em `calls` com `callId`).
- [x] `currentStepIsPhone` na fila + selo "Fora da etapa" na lista.
- [x] Fim da ligação pelo webphone no `PowerDialerTab` (vale também no manual): a ligação integrada desta discagem em `ended` trava `callState='ended'`.
- [x] Laço automático com `useReducer` + `useEffectEvent`; chave "Discagem automática" (`AutoDialToggle`) na tela inicial e na barra; faixa `AutoDialStatusBar` com Pular/Ligar agora/Pausar/Retomar; botão de ligar manual escondido enquanto o automático cuida da vez; escolher um lead na lista pausa — 5 testes de tela com relógio falso.
- [x] Painel flutuante sem estrelas quando o lead não atendeu (inclusive se o sinal chega com a avaliação já na tela). Sem teste de tela (o `WebphonePanel` não tem harness de render); coberto pela regra pura `leadConnected`.
- [x] typecheck, lint, test:run (2627 passaram) e build verdes.

### Decisões do dev
- Nome do componente: `AutoDialControls.tsx` (chave + faixa de status) em vez de `AutoDialCountdown.tsx` do plano — os dois controles andam juntos.
- Concluir manual de ligação que a API4COM marcou como não atendida também grava `sdr_disposition='no_answer'`.
- Retomar só fica habilitado sem ligação em aberto (o SDR conclui a anterior antes).

## File List
- `src/features/activities/utils/auto-dialer.ts` + `.test.ts` (novos)
- `src/features/activities/components/AutoDialControls.tsx` (novo)
- `src/features/activities/components/PowerDialerTab.tsx` + `PowerDialerTab.auto.test.tsx` (novo) + `PowerDialerTab.test.tsx` (fixture)
- `src/features/activities/components/DialerCallPanel.tsx` (`manualDialHidden`)
- `src/features/activities/components/PowerDialerIdleLayout.tsx` (`autoDialToggle`)
- `src/features/activities/components/DialerQueueList.tsx` (selo "Fora da etapa")
- `src/features/activities/actions/fetch-dialer-queue.ts` (`currentStepIsPhone`)
- `src/features/activities/actions/complete-dialer-call.ts` + `.test.ts` (novo)
- `src/features/calls/services/apply-sdr-call-result.ts` + `.test.ts` (novos)
- `src/features/calls/actions/classify-webphone-call.ts` (usa o serviço)
- `src/features/integrations/webphone/WebphonePanel.tsx` (sem estrelas quando não atendeu)

## Change Log
- 22/10/2026 — @dev: avaliação com estrelas removida do painel (story `api4com-embedded-webphone`); o critério 10 vale sempre. No manual, concluir com o formulário vazio usa as anotações do painel. Branch `feat/webphone-no-rating`.
- 22/10/2026 — @dev: implementado na branch `feat/power-dialer-auto-dial` (todas as tarefas). Status Ready → InProgress. Typecheck, lint e testes verdes. Nada commitado.
- 22/10/2026 — @po: validada (GO 9/10). Status Draft → Ready. Adicionada a seção "Valor".
- 22/10/2026 — Story criada (Draft) a partir do plano aprovado pelo Vini.
