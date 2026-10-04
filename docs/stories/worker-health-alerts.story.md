# Story: Alertas de robô parado — motor de cadência, respostas de e-mail e caixa do BDR

## Status
InReview

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-04 | @dev (Dex) | Revisão adversarial (AJUSTAR) aplicada: (1) aviso só para orgs que usam o robô (`notifyOrgIds`: motor → cadência auto_email ativa = 1 org; respostas → Gmail conectado = 3; BDR → caixa BDR IA = 1; API4COM segue para todas) e texto de impacto sem jargão; (2) erro devolvido pelo supabase no upsert agora é checado e vai ao Sentry, `metadata` nunca nulo, `not_tracked_yet` avisa o time no Sentry; (3) `fingerprint` por robô e sem evento duplicado em exceção. Confirmado: nenhum dos 3 robôs devolve falha em situação normal (sem alarme falso). |
| 2026-10-04 | @dev (Dex) | Implementado + testado. |
| 2026-10-04 | Vini + Claude | Story criada a partir da auditoria de 04/out (agente de confiabilidade, achado 9). |

## Origem

- O cron `health-check-workers` (a cada 2h) só vigiava **um** robô: `reconcile-api4com-calls`.
- Nenhuma rota de cron mandava erro ao **Sentry**: elas capturam o erro e respondem 500, e o `onRequestError` do Next só vê erros não capturados.
- O motor de cadência, a detecção de respostas e a leitura da caixa do BDR podiam parar sem ninguém saber. A detecção de respostas passou **30 dias** respondendo "sucesso, 0 encontradas" (corrigida no PR #445).

## Story

**As a** gestor / time de produto,
**I want** ser avisado quando um robô crítico parar,
**so that** a falha dure horas, não semanas.

## Acceptance Criteria

1. `runTrackedWorker(jobName, fn)` grava cada execução em `worker_run_state`: sucesso → `last_success_at` + resumo (≤ 4 KB); falha (`success:false` ou exceção) → `last_status='error'` sem tocar `last_success_at`, e evento no Sentry com a tag `worker`. Falha ao gravar nunca derruba o robô.
2. `execute-cadence-steps`, `check-email-replies` e `ingest-email-inbox` usam `runTrackedWorker`.
3. O health-check vigia os três (sem sucesso há > 1h = parado), além da API4COM (inalterada).
4. O motor de cadência só é cobrado em seg–sex 12–21 UTC (09–18 BRT) — o cron dele roda seg–sex 08:00–17:55 BRT; fora disso fica `off_hours`.
5. Robô novo sem registro (logo após o deploy) fica `not_tracked_yet`, sem alerta. A API4COM continua alertando sem registro.
6. Robô parado → evento no Sentry a cada checagem + notificação aos gestores **das orgs que usam aquele robô** (cooldown de 24h, como antes), com texto do impacto.
7. Erro ao gravar o estado (inclusive `{ error }` devolvido pelo supabase-js) vai ao Sentry; robô sem registro no horário esperado gera aviso ao time no Sentry.

## Scope

**IN:** `src/lib/workers/worker-run.ts`, `src/lib/workers/critical-workers.ts`, as 3 rotas de cron, `health-check-workers/route.ts`, testes.

**OUT:** demais crons (transcrições, lembretes, sync de CRM etc.); conferir o código HTTP das chamadas do pg_net (~29% batem no timeout de 5 s do pg_net, mas a rota segue executando); trocar o `CRON_SECRET` fixo nos comandos do pg_cron.

## Tasks

- [x] `runTrackedWorker` + testes
- [x] 3 rotas envolvidas
- [x] `critical-workers.ts` (lista + janela do motor) + testes
- [x] Health-check: janela, sem registro, Sentry + testes
- [x] typecheck / lint / test:run / build
- [x] Revisão (ajustes aplicados)
- [x] PR
- [ ] Conferir `worker_run_state` em prod depois do deploy

## File List

- `src/lib/workers/worker-run.ts` (novo) · `worker-run.test.ts` (novo)
- `src/lib/workers/critical-workers.ts` (novo) · `critical-workers.test.ts` (novo)
- `src/app/api/cron/execute-cadence-steps/route.ts` (modificado)
- `src/app/api/cron/check-email-replies/route.ts` (modificado)
- `src/app/api/cron/ingest-email-inbox/route.ts` (modificado)
- `src/app/api/cron/health-check-workers/route.ts` (modificado) · `stale-workers.test.ts` (novo)
- `docs/stories/worker-health-alerts.story.md` (novo)
