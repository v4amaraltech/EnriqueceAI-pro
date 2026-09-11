# 2026-08-18 — Dashboard: gráficos de insights empilhados

## O que foi feito
- "Motivos de Perda" e "Conversão por Origem" deixaram de dividir um grid de 2 colunas (`lg:grid-cols-2`) no dashboard e agora ocupam uma linha inteira cada.
- Mudança de 1 linha em `src/features/dashboard/components/DashboardView.tsx` (slot `insights-charts`).

## Entrega
- PR [#337](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/337) — squash `48d663eb` na main.
- Deploy confirmado via `/api/version` (commit `48d663e` em produção, ~4 min após o merge).

## Validação
- 15 testes do `DashboardView.test.tsx` passando (testes checam `data-slot`, não classes).
- Conferência visual no dev local pelo usuário.

## Notas
- Branch `fix/docker-standalone-pnpm` local ficou obsoleto (já mergeado no #336); o trabalho saiu do novo branch `fix/dashboard-insights-charts-stacked` criado a partir da `origin/main`.
- Continuam fora de versionamento (pré-existentes): `create-checkout.ts` modificado, `next-env.d.ts`, docs de sessões anteriores.
