# Sessão 2026-09-14 — Mover "SDR selecionado" para depois dos rankings

## O que foi feito
- Seção "SDR selecionado" (select + 7 cards de meta) saiu do topo do Dashboard e passou a ficar
  **depois dos rankings operacionais e antes de Insights**. Ordem nova:
  cabeçalho/filtros → 4 cards do time → gráfico RM/RR → rankings do funil → rankings operacionais →
  **SDR selecionado** → Insights → Tempo de resposta.
- Decisão do Vini entre 3 opções (depois dos rankings / depois dos 4 cards / fim da página).
- Só posição no JSX. Comportamento intacto (`?sdr=`, troca sem reload, filtro de mês).

## Arquivos
- `src/features/dashboard/components/DashboardView.tsx` — bloco movido.
- `src/features/dashboard/components/DashboardSkeleton.tsx` — skeleton na mesma ordem.
- `src/features/dashboard/components/DashboardView.test.tsx` — teste novo de ordem (rankings → SDR → insights).
- `docs/stories/dashboard-sdr-pace-cards.story.md` — Change Log.

## Verificação
- typecheck ✅, lint ✅, `vitest run src/features/dashboard` ✅ (236 testes).
- Não conferido logado no navegador (Dashboard exige sessão).

## Pendente
- Vini decide commit/PR. Conferir visualmente em prod após deploy.
