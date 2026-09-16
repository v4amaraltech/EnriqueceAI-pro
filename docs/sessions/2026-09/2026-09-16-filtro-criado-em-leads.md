# Handoff 16/set/2026 — Filtro e coluna "Criado em" na tela de Leads

**Story:** `docs/stories/leads-created-at-filter.story.md` (Ready for Review)
**Branch:** `feat/leads-created-at-filter` (worktree `.claude/worktrees/leads-created-at`, a partir de `origin/main` `a1996f3c`)
**Estado:** implementado e verificado localmente; **nada commitado** (aguardando o Vini).

## Dor
Pré-vendas não conseguiam separar os leads adicionados hoje dos antigos na tela de Leads. A lista já vinha ordenada por `created_at` desc, mas sem coluna de data nem filtro de período.

## O que foi feito
- **Filtro "Criado em"** na barra de filtros: Hoje, Ontem, Últimos 7 dias, Este mês, Personalizado (de/até). Vai para a URL como `created_period=today` (favorito continua certo amanhã) ou `created_from`/`created_to` (`YYYY-MM-DD`).
- **Dias em BRT** via `createdAtRange` (reusa `brt-date.ts`). "Hoje" às 22h de Brasília continua sendo hoje.
- Filtro aplicado na lista, no "selecionar todos os filtrados" e na exportação CSV filtrada. Na lista segue a regra existente: busca por texto ignora os demais filtros.
- **Coluna "Criado em"** ordenável na tabela: "Hoje HH:mm" (em vermelho V4), "Ontem", "há N dias", "dd/MM", "dd/MM/aa"; data completa no tooltip.
- Testes: +22 (helper, formatador, schema, fetch, filtros, tabela). typecheck/lint/testes verdes.

## Como testar
1. `/leads` → "Criado em" → Hoje. URL deve ter `created_period=today`; contador "N leads encontrados" muda.
2. Personalizado → preencher de/até; URL com `created_from`/`created_to`.
3. Clicar no cabeçalho "Criado em" alterna a ordenação.
4. Selecionar todos + exportar CSV com o filtro ativo: só os leads do período.

## Observações
- Abas de status (Novo/Contatado…) continuam com contagem global (fora do escopo).
- Selo "Novo hoje" (opção 3) não foi feito; a célula "Hoje" em destaque cobre parte disso.
- Para preview em worktree: o botão de preview lê `.claude/launch.json` da pasta principal; usar entrada com `pnpm -C <worktree> dev` (ver memória).
