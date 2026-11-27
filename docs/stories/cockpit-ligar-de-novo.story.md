# Story: "Ligar de novo" no Discador do Cockpit

**Status:** InReview

## Problema
O lead atendeu e a internet caiu no meio da conversa. A tela ficava no desfecho sem como religar, e o portão recusaria
(`answered_today`, `gap`).

## Critérios de aceite
- [x] Botão "Ligar de novo" em "O lead conversou" e em resultado desconhecido; disca na hora para o mesmo número/contato.
- [x] Ao terminar (atendida ou não), volta ao desfecho do mesmo lead; nunca avança sozinho nem grava `no_answer` pela religação.
- [x] Servidor confirma a ligação anterior (mesmo usuário, mesmo lead, do motor, criada há menos de 60 min, com conversa possível).
- [x] Na religação não valem: `answered_today`, `gap`, 3 por dia, conversa depois da perda, conversa sem ação, retorno futuro.
- [x] Continuam: flags, janela, feriado, teto do motor, bloqueios, dono, status e motivo de perda, trava de disparo duplo.
- [x] Não disca com a ligação anterior viva no webphone; recusa/falha mostra mensagem e mantém o desfecho.
- [x] Conta no resumo do dia como ligação do motor; anotação digitada é gravada antes de religar.
- [x] Pausar durante a religação vale depois do desfecho; Parar desliga o motor sem derrubar a ligação; simulado não grava.
- [x] A IA não cria retorno, não cancela tarefa nem pausa cadência pela ligação que caiu quando uma religação dela
      (cadeia A<-B<-C) foi atendida, virou conversa ou ainda está no ar; desfecho e resumo seguem. Religação não atendida
      ou caixa postal: como antes. Falha ao conferir: nada é criado nem cancelado (revisar).
- [ ] Teste em ligação real.

## Onde fica o desfecho
Na ligação nova se ela teve conversa; senão (não atendeu, sem resultado, recusa, falha) na ligação que caiu.

## File List
- `src/features/cockpit/auto-dial.types.ts`
- `src/features/cockpit/actions/auto-dial.ts`
- `src/features/cockpit/services/cockpit-auto-dial.service.ts`
- `src/features/cockpit/services/cockpit-auto-dial-outcome.service.ts` (+ `.test.ts`)
- `src/features/cockpit/services/cockpit-recovery-candidates.service.ts`
- `src/features/cockpit/services/cockpit-auto-dial.redial.test.ts`
- `src/features/cockpit/utils/auto-dial-rules.ts`
- `src/features/cockpit/utils/cockpit-auto-dial-machine.ts` (+ `.redial.test.ts`)
- `src/features/cockpit/hooks/use-cockpit-auto-dial.ts` (+ `.redial.test.tsx`)
- `src/features/cockpit/components/AutoDialAnsweredActions.tsx` (+ `.redial.test.tsx`)
- `src/features/cockpit/components/DialerTab.tsx`
- `src/features/calls/services/redial-supersedes-call.service.ts` (+ `.test.ts`)
- `src/features/calls/services/apply-ai-call-outcome.service.ts` (+ `.test.ts`)
