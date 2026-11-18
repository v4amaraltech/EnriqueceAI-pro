# Handoff — "Ligar de novo" demorava ~10 s para tocar o ramal (18/11/2026)

Pedido do Vini: na tarefa de ligação, a 1ª ligação abre o componente flutuante na hora. Depois de desligar, o "Ligar de novo" (modal "Resultado da Ligação") levava uns 10 s para a API4COM tocar o ramal e o flutuante aparecer.

## Causa
- **Não era o motor nem a API4COM.** O pedido para a API4COM (`POST /calls`) é que saía atrasado.
- O Next manda as **Server Actions uma por vez, em fila** (doc do Next 16.3.8: "dispatches and awaits them one at a time").
- Depois da ligação, a tela consultava `getWebphoneCallOutcome` (Server Action) a cada 3 s:
  - `ActivityPhonePanel`: `useWebphoneLeadAnswer` + `usePostCallSuggestion`;
  - painel flutuante (`WebphonePanel`): `usePostCallSuggestion` e a consulta do resultado.
  - São 3 a 4 consultas por ciclo, até 40 voltas. Quando o lead não atende, a resposta nunca "resolve" e elas não param.
- O `handleRetryAttempt` ainda chamava `classifyWebphoneCall` e `fetchLeadPhones` **antes** do `initiateCall`.
- Resultado: o `initiateCall` entrava no fim da fila. Cada action confere login no Supabase e consulta o banco.
- A 1ª ligação era rápida porque a fila estava vazia.

## Correção
- **Rota nova `GET /api/webphone/call-outcome?callId=`** (`src/app/api/webphone/call-outcome/route.ts`).
  - Chama a mesma `getWebphoneCallOutcome`: mesma auth e o mesmo filtro por org. Resposta com `Cache-Control: no-store`.
  - Rota comum não entra na fila das Server Actions.
- **Helper do navegador `fetchWebphoneCallOutcome`** (`src/features/calls/fetch-webphone-call-outcome.ts`). Devolve `null` em erro HTTP ou de rede, e o polling tenta de novo no ciclo seguinte.
- `use-post-call-suggestion.ts` e `useWebphoneLeadAnswer.ts` passaram a usar o helper.
- **`handleRetryAttempt` (`ActivityPhonePanel.tsx`) disca primeiro.** Depois grava a tentativa anterior (`classifyWebphoneCall` com o `callId` anterior guardado antes do reset) e busca os telefones de novo. Nada deixou de ser gravado.
- **Power Dialer:** o "Ligar de novo" de lá só limpa a tela (o SDR clica em Ligar depois). Ganha só com a troca do polling.

## Entregue
- **PR #664** mesclado com squash (`eef7ecb0`) e no ar (`/api/version` = `eef7ecb0`).
- **Testes:**
  - `ActivityPhonePanel.post-call.test.tsx`: novo caso que garante a ordem `initiateCall` → `classify`. Falharia no código antigo.
  - `route.test.ts`: repassa o `callId` e responde `no-store`.
  - `fetch-webphone-call-outcome.test.ts`: URL certa e `null` em erro.
  - Mock de `WebphonePanel.server-follow.test.tsx` trocado para o helper novo.
  - 2.368 testes das áreas mexidas, typecheck e lint passaram. Os 4 avisos de lint são de arquivos não mexidos.
- Sem migration.
- **Limpeza feita:** worktree `EnriqueceAI_Pro-redial` removida; branch `fix/redial-sem-fila` apagada (local e remota).

## Pontos de atenção
- **Regra para o futuro:** polling ou leitura frequente no navegador vai por rota GET, nunca por Server Action. Qualquer action em loop atrasa todos os botões que também usam actions.
- A `getWebphoneCallOutcome` continua sendo Server Action. O teste dela segue valendo e a rota só a reaproveita.
- Sem login, a rota nova devolve 307 (o middleware manda para a tela de entrada). Isso é esperado.

## Pendente
- Testar numa ligação real: ligar para um número que não atende, desligar e clicar em "Ligar de novo". O flutuante deve abrir tão rápido quanto na 1ª ligação.
