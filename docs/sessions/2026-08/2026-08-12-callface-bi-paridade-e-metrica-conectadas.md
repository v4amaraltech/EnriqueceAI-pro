<!-- Sessão: métrica de ligações/conexões — API4COM + Callface no BI -->
<!-- Data: 2026-08-12 -->
<!-- Org: V4 Company Amaral (c2727473-1df8-4faa-9264-a9fc1759fe3b) -->
<!-- Projetos: Enriquece (dhkmonctyoaenejemkrt) + Sales Hub (ejxlbbbjyexsoltsxiqq) -->

## Pergunta que encerrou a sessão

"Preciso que essas ligações [Callface] estejam aparecendo no BI e nas suas
[métricas]. Está igual, 100%? Como está isso?"

**Resposta validada com dados reais dos dois bancos: SIM, paridade 1:1 exata,
e o sync novo já pega ligação nova sozinho (não é só backfill).**

---

## Verificação de paridade — Callface no Sales Hub (agosto/2026)

Regra de "conectada" idêntica nas duas pontas (answered-first:
`answered_at IS NOT NULL OR status='significant' OR duration_seconds>=30`).

| SDR | Enriquece (feitas / conectadas) | Sales Hub (feitas / conectadas) | Bateu? |
|-----|--------------------------------|--------------------------------|--------|
| João Fogaça | 75 / 39 | 75 / 39 | ✅ |
| Matheus Martins | 12 / 6 | 12 / 6 | ✅ |
| Guilherme Marques | 9 / 4 | 9 / 4 | ✅ |
| **Total** | **96 / 49** | **96 / 49** | ✅ **1:1** |

- **Enriquece** (`calls` where `origin='callface'`, mês corrente): 96 linhas.
- **Sales Hub** (`call_logs` where `raw_payload->>'origin'='callface'`): 96 linhas.
- **Trigger durável funcionando pra frente:** a última ligação Callface é a
  MESMA nos dois lados — `2026-08-12 20:49:57.924+00` (≈1h antes da verificação).
  Antes do fix só **2 de 96** chegavam; agora entra no BI na hora.

---

## O que foi feito nesta sessão (encadeamento)

### 1. API4COM — bug do `connected` inflado (raiz)
- `answeredAt=""` (string vazia) passava `!== null` e contaminava
  `not_significant` → conexão de todos os SDRs inflada ~2x em mai–jul.
- Fix no app: `parseApi4ComTimestamp(answeredAt) !== null`
  (`src/features/calls/services/api4com-classification.ts`) +
  `isConnectedCall` reordenado answered-first
  (`src/features/calls/connection.ts`). **PR #207**.
- Sales Hub: `sync_calls_from_enriquece` passou a answered-first e o
  histórico mai–jul foi recomputado (23.329 linhas). Doc:
  `docs/integrations/saleshub-connected-metric-fix-2026-08.md`. **PR #272**.
- Export RPC `get_calls_for_v4sales` passou a incluir `answered_at` no payload
  e usar answered-first nas métricas
  (`supabase/migrations/20260812120000_get_calls_for_v4sales_answered_first.sql`). **PR #272**.
- Registro de webhook robusto (retry + verify) + cron de reregister
  (`src/features/integrations/services/api4com.service.ts`,
  `src/app/api/admin/reregister-api4com-webhooks/route.ts`). **PR #271**.
- Enum de desfecho separado (`call_disposition` / `calls.sdr_disposition`,
  `sdr_outcome` deprecado). **PR #207**.
- Relatório cirúrgico à API4COM
  (`docs/integrations/api4com-webhook-report-2026-08.md` + PDF). **PR #273**.

### 2. Callface — 2ª fonte de ligações, metrificada no BI
- Pipeline já era LIMPO (`connected` por sinal real; `answered_at` preenchido
  quando conectada) — não tem o bug do `answeredAt=""`.
- **Gap de sync corrigido:** o n8n "Sync Calls" (que alimenta o SH) era
  disparado só pelo fluxo API4COM; o Callface (fonte separada) não acionava o
  sync → só 2 de 96 chegavam. Fix:
  1. **Backfill** server-side das 96 (via `net.http_post` →
     `sync_calls_from_enriquece_logged`).
  2. **Trigger durável:** nó "Disparar Sync V4" no workflow n8n
     "Callface → EnriqueceAI" (`CC1zZHetFviVHD3O`) aciona o webhook do Sync
     Calls após cada ingest — publicado.
- **Threshold significant alinhado 50s → 30s** em `ingest_callface_call`
  (`supabase/migrations/20260812210000_ingest_callface_significant_threshold_30.sql`).
  Não muda "conectadas" (o `answered_at` resolve), só o rótulo
  significant/not_significant, pra bater com o resto do sistema. **PR #274**
  (merge `ff35187`).

---

## Estado final

- **Callface:** ✅ no BI, 100% de paridade, sync automático ligado.
- **API4COM:** ✅ métrica answered-first corrigida, histórico recomputado.
- **PRs mergeados na sessão:** #271, #272, #273, #274 (todos deploy Coolify na main).

## Pendência externa (NÃO é código nosso)

Ramais **1042 (Giovanni)** e **1045 (João)** no API4COM: a API4COM entrega
`channel-hangup` (com duração + gravação) mas **nunca** `channel-answer` /
`answeredAt`, mesmo em ligações claramente atendidas. O ramal 1028 (Matheus)
popula `answeredAt` em 100% na mesma conta — logo é config por-ramal do lado
deles. Evidência cirúrgica no relatório merge (#273). Por isso o João foi
movido pro Callface, onde aparece certinho (75/39). Ação depende da API4COM.

## Referências de memória

- [[callface-integration]] — pipeline, gap de sync, trigger durável.
- [[api4com-connected-empty-answered-at-bug]] — bug do `answeredAt=""`, ramal 1042/1045.
- [[calls-connected-metric-unified]] — fonte única `features/calls/connection.ts`.
- [[calls-bi-sync-path]] — n8n "Sync Calls" → `sync_calls_from_enriquece`.
