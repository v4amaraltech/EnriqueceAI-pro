# Handoff — Tela de Integrações minimalista (14–15/11/2026)

Sem story: pedido direto do Vini (ajuste visual em `/settings/integrations`).

## Entregue
- **PR #623** (`f5b9b6ea`, mesclado e no ar em 15/11 03:23 UTC, conferido por `/api/version`).
- Cada linha mostra só a ação principal (**Conectar** / **Desconectar**; na API4Com da organização, **Remover**) e uma seta. A seta abre uma faixa logo abaixo da linha com o resto. Tudo começa fechado e não guarda o estado entre recargas.

| Linha | Dentro da seta |
|---|---|
| WhatsApp | Reconectar |
| API4Com · conta da organização | Sincronizar ramais, Trocar token + tabela de ramais do time |
| API4Com · ramal individual | Testar, Gerenciar |
| WhatsApp Call (gestor) | Gerenciar números |
| Google | Testar, Assinatura |
| CRMs | Sincronizar, Campos |
| API Enriquece AI | Configurar |
| Webhooks | Novo webhook (dentro da área que já abria) |

Apollo (só Desconectar) fica sem seta. A linha de WhatsApp Call do SDR não mudou ("Parear meu número" segue à vista).

## Arquivos
- `src/features/integrations/components/RowExpand.tsx` — **novo**: `RowExpandToggle` (seta), `RowExtraActions` (faixa), `useExpandedRows` (quais linhas estão abertas).
- `src/features/integrations/components/IntegrationsView.tsx` — cada linha virou contêiner (borda/hover) + linha flex + faixa de extras (`pl-[68px]`).
- `src/features/integrations/components/Api4ComOrgCard.tsx` — seta compartilha o estado com a tabela do time; o aviso amarelo de pendências da sincronização continua visível com o card fechado.
- `src/features/cadences/components/WebhookEndpointsManager.tsx`
- `src/features/integrations/components/IntegrationsView.test.tsx` — testes abrem a seta antes de procurar os botões.

## Verificação
- Lint, typecheck e 830 testes de `src/features/integrations` + `src/features/cadences` passando; CI do PR verde.
- Testado no navegador (dev local): Google, API4Com e as setas abrindo/fechando.

## Limpeza feita
- Worktree `EnriqueceAI_Pro-api4com-collapse`, branch local e remota `feat/api4com-card-collapse` apagadas.
- Cópias soltas de `Api4ComOrgCard.tsx` / `IntegrationsView.test.tsx` no checkout principal descartadas. As outras mudanças em andamento na `fix/kommo-orphans-leadids` não foram tocadas.

## Lições
- Repo não aceita auto-merge do GitHub: para "mesclar quando o CI passar", loop com `gh pr checks` em segundo plano. `gh pr checks --watch` saiu cedo (exit 8) com o CI ainda rodando.
- Prettier não é cobrado no CI e os arquivos antigos não estão formatados: não rodar `prettier --write` em arquivo existente (gera diff enorme).
- Turbopack recusa `node_modules` em symlink na worktree; fazer `pnpm install` nela.
- `useEffect` lendo `localStorage` + `setState` é barrado pelo lint (`react-hooks/set-state-in-effect`).

## Pendências
- Nenhuma desta entrega.
- Para uma integração nova na tela: seguir o mesmo padrão (ação principal visível, resto em `RowExtraActions`).
