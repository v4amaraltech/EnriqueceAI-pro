# Story: Ganhos rápidos no banco — índice em calls e limpeza do histórico do cron

## Status
InReview

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-04 | @dev (Dex) | Migration `20261004151311_db_quick_wins_calls_index_cron_cleanup` **aplicada em prod**. Limpeza inicial + VACUUM feitos (domingo, baixa carga). Banco 991 MB → 469 MB. |
| 2026-10-04 | Vini + Claude | Story criada a partir da auditoria de 04/out (agente de banco, itens 2 e 8). Retenção do histórico do cron: **14 dias** (decisão do Vini). |

## Origem

Auditoria de 04/10/2026, conferida em produção:

- `calls` (~52k linhas, 47 MB) com **~1,9 mi de varreduras completas**. A consulta campeã (`select id from calls where metadata->>$1 = $2`, ~1,5 mi execuções, ~18.600 s) busca ligação pelo id da API4COM — webhook `api4com`, conferência horária `reconcile-api4com-calls` e worker `back-associate-api4com-webhooks` (a cada 30 min). Só havia índice para `callface_call_id`.
  - A auditoria supôs `service_call_id`; o `pg_stat_statements` normaliza a chave para `$1`. Contagem: 47.348 linhas com `api4com_call_id` × 313 com `service_call_id` → a chave real é `api4com_call_id`.
- `cron.job_run_details` nunca limpo: **316k linhas desde 27/03, 302 MB** (maior tabela do banco).
- `net._http_response` com **235 MB para ~360 linhas** (inchaço; o pg_net apaga as linhas em 6h, mas o espaço não voltava).

## Acceptance Criteria

1. Busca de ligação por `metadata->>'api4com_call_id'` usa índice (plano com `Index Scan`, inclusive em statement preparado).
2. Idem para `service_call_id`.
3. Job diário apaga `cron.job_run_details` com mais de 14 dias.
4. Espaço devolvido ao disco sem parar o cron/pg_net.

## Resultado (prod, 04/10)

| Item | Antes | Depois |
|---|---|---|
| Busca por `api4com_call_id` | Seq Scan (~50k linhas, 6.4k buffers, custo 4.490) | Index Scan (custo 1,5) |
| `cron.job_run_details` | 316k linhas / 302 MB | 28k linhas / 12 MB |
| `net._http_response` | 235 MB | 744 kB |
| Banco | 991 MB | **469 MB** |

- Limpeza inicial: 287.913 linhas apagadas (> 14 dias). Job `cleanup-cron-job-run-details` (jobid 64) às 06:15 UTC (03:15 BRT).
- `VACUUM FULL` em `cron.job_run_details` e `net._http_response`. Conferido depois: jobs seguem `succeeded`, fila do pg_net vazia, respostas novas chegando.

## Scope

**IN:** índices de expressão em `calls.metadata`, job de limpeza, limpeza inicial + VACUUM.

**OUT:** demais lentidões da auditoria (view `leads_no_active_enrollment`, lista/busca de leads, fila de atividades), ~29% de chamadas pg_net com timeout de 5s, índices sem uso e FKs sem índice.

## Riscos

- `net._http_response` volta a inchar com o tempo (o pg_net apaga linhas a cada 6h, o autovacuum não devolve o espaço). Se voltar a pesar, repetir `VACUUM FULL net._http_response` (rápido, ~400 linhas).

## Tasks

- [x] Identificar a chave real da consulta (api4com_call_id)
- [x] Migration: índices + job de limpeza
- [x] Aplicar em prod + conferir planos (`EXPLAIN`, statement preparado)
- [x] Limpeza inicial + `VACUUM FULL` + conferir cron/pg_net
- [x] PR

## File List

- `supabase/migrations/20261004151311_db_quick_wins_calls_index_cron_cleanup.sql` (novo)
- `docs/stories/db-quick-wins-calls-index-cron-cleanup.story.md` (novo)
