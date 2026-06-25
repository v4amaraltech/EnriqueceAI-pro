# Sessão 2026-06-25 — Notificação de atividades atrasadas: clique morto + texto cortado

**Agente:** @devops (Gage) · **Branch base:** main

## Problema (relato Vinícius)

A notificação **"X leads esperando sua ação"** (resumo de atividades atrasadas), no sino do SDR, tinha dois defeitos:

1. **Clicar não fazia nada** — nenhum redirecionamento.
2. A mensagem aparecia **cortada em uma linha** (`Você tem 1 atividade atrasada na fila: 1 Liga...`), sem dar pra ler por completo.

Comportamento desejado: clicar deveria levar ao menu **Atividades** já filtrado por **Atrasadas**.

## Diagnóstico

- A notificação é criada em `features/cadences/actions/sdr-overdue-summary.ts` com `resource_type: 'cadence'`, **sem `resource_id`**, e `metadata.alert_type === 'overdue_summary'`.
- `NotificationDropdown.handleClick` só navegava `if (resource_type && resource_id)` → sem `resource_id`, abortava silenciosamente. (E `cadence` apontaria para `/cadences`, alvo errado.)
- `NotificationItem` usava `truncate` (1 linha) no título e no corpo → mensagem cortada.
- A página `/atividades` não lia query params; o filtro de status era só estado local (`defaultFilters`), então não dava pra deep-link na fila filtrada.

## Entrega — PR #97 (mergeado, squash `af48fc9`, deployado via Coolify, confirmado por Vinícius)

| Mudança | Arquivo |
|---------|---------|
| `handleClick` detecta `metadata.alert_type === 'overdue_summary'` → `router.push('/atividades?status=overdue')` (deep-link na fila pré-filtrada) | `features/notifications/components/NotificationDropdown.tsx` |
| Filtro de status semeado a partir do query param `?status=overdue\|due` via lazy initializer do `useState` (novo `useSearchParams`) | `features/activities/components/ActivityQueueView.tsx` |
| `truncate` → `line-clamp-2` (título) e `line-clamp-3` (corpo) | `features/notifications/components/NotificationItem.tsx` |

Quality gate: typecheck ✓ · lint ✓ · CI `Lint · Typecheck · Test · Build` ✓ (4m16s).

## Notas

- Mudança **puramente front-end** — sem alteração de banco, do cron `sdr-overdue-summary` ou da estrutura da notificação.
- Notificações de atividade individual (próximos 30 min, `resource_type: 'lead'` + `resource_id`) seguem indo para `/leads/:id` — comportamento inalterado.
- `useSearchParams()` não exige Suspense aqui: `/atividades` já é rota dinâmica (via `requireAuth`/cookies); confirmado pelo build do CI.
- Build local indisponível neste ambiente: Turbopack falha varrendo `/Users/mercante/Documents` por **restrição de privacidade do macOS (TCC)**. Não é erro de código; o build do CI é o gate autoritativo.
- Deploy = **Redeploy manual no painel Coolify** após o merge.
- Validação em produção (Vinícius): hard refresh → clique na notificação → caiu na fila de Atividades filtrada por "Atrasada", com a mensagem completa visível.
