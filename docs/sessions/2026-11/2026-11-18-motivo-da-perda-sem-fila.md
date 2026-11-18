# Handoff — dropdown "Motivo da perda" demorava para abrir (18/11/2026)

Pedido do Vini: no modal **Desqualificar lead**, o dropdown "Motivo da perda" demorava para abrir depois do clique. Às vezes era preciso clicar várias vezes.

## Causa
- O modal (`MarkLeadLostDialog`) buscava a lista **ao abrir**, chamando `fetchLossReasons` + `fetchActiveCadences` como **Server Actions**.
- O Next manda as Server Actions **uma por vez, em fila**. No Cockpit/discador há consultas por action rodando o tempo todo, então a lista chegava segundos depois.
- Até a lista chegar, o Radix `Select` abria **vazio** (caixa sem itens). Parecia que o clique não tinha pegado.
- A causa é a mesma do "Ligar de novo" lento (PR #664, handoff `2026-11-18-ligar-de-novo-sem-fila.md`).
- O `BulkMarkLeadsLostDialog` (desqualificar em lote) tinha o mesmo problema.

## Correção
- **Rota nova `GET /api/leads/loss-dialog-options`** (`src/app/api/leads/loss-dialog-options/route.ts`).
  - Chama as mesmas `fetchLossReasons` e `fetchActiveCadences` em paralelo: mesma auth e o mesmo filtro por org.
  - Responde `{ lossReasons, cadences }` com `Cache-Control: no-store`. Rota comum não entra na fila.
- **Helper do navegador `fetchLossDialogOptions`** (`src/features/leads/fetch-loss-dialog-options.ts`).
  - Devolve `null` em erro HTTP ou de rede.
  - Guarda em memória a última lista que veio com sucesso (`getCachedLossDialogOptions`).
- **`MarkLeadLostDialog`:**
  - Começa com a lista guardada, então reabrir não espera a rede. A lista é atualizada por trás a cada abertura.
  - Enquanto a primeira lista não chega, o campo fica desabilitado e mostra **"Carregando motivos…"**.
- **`BulkMarkLeadsLostDialog`** usa o mesmo helper e a mesma lista guardada.

## Entregue
- **PR #666** mesclado com squash (`a78ace54`) e no ar (`/api/version` = `a78ace54`).
- **Testes:**
  - `route.test.ts`: devolve motivos e cadências juntos, `no-store`, e repassa erro de auth.
  - `fetch-loss-dialog-options.test.ts`: URL certa, guarda a lista, não guarda quando os motivos falham, `null` em erro.
  - `MarkLeadLostDialog.test.tsx`: mostra "Carregando motivos…" até chegar e abre pronto com a lista guardada. O mock da Server Action lança erro, então o teste falha se o modal voltar a usá-la.
  - Testes de leads, cockpit, activities e da rota: 110 arquivos ok. Typecheck e lint ok.
- **CI:** falhou uma vez em `CloserCalendarControls.test.tsx`, teste instável e sem relação com esta mudança (passou 3 de 3 vezes no local). Passou no re-run, sem pular nada.
- **Conferido em produção, logado no Cockpit:**
  - 1ª abertura: ~1,1 s com "Carregando motivos…", depois o dropdown abre no 1º clique com a lista completa.
  - 2ª abertura: já pronto.
  - Nenhum lead foi alterado: o modal sempre foi fechado pelo "Fechar".
- Sem migration.
- **Limpeza feita:** worktree `EnriqueceAI_Pro-motivo-perda` removida; branch local apagada.

## Pontos de atenção
- **Regra (reforçada):** leitura disparada pelo navegador em telas com polling (Cockpit, discador, tarefa de ligação) vai por rota GET, não por Server Action.
- A lista guardada vive na memória da aba. Se um motivo for criado ou editado nas configurações, a aba mostra a lista antiga só até o modal terminar de recarregar na próxima abertura.
- Sem login, a rota nova devolve 307 (o middleware manda para o login). Isso é esperado.
- Se a org não tiver nenhum motivo cadastrado, o campo fica desabilitado com "Selecione o motivo".

## Pendente
- A branch remota `fix/loss-reason-select-no-queue` ainda existe no GitHub e pode ser apagada.
- Este handoff não foi commitado.
