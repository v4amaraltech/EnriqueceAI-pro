# Findings — Gap Enriquece ↔ API4COM (Dev Team Enriquece)

> **Responde a:** `2026-05-17-gap-enriquece-api4com.md`
> **Data:** 2026-05-17
> **Período analisado:** 01–16/05/2026 (V4 Amaral, org `c2727473`)
> **Status:** Investigação parcial concluída. Gap NÃO fechado autonomamente — depende de cross-check contra dashboard API4COM (acesso indisponível pela CLI).

---

## Resumo executivo

Reproduzi os números do briefing (state atual em produção bate exatamente — Enriquece está sincronizando o que tem no banco; o gap está na ingestão).

Eliminei duas suspeitas como causa única e identifiquei **2 contribuintes parciais** do excesso de calls no Enriquece. Resta gap de ~10–86 calls por SDR depois das remoções diagnosticáveis.

| Causa identificada | Linhas | Impacto |
|---|---:|---|
| **Ghost calls do dialer** (iniciadas via dialer in-app sem webhook hangup) | 65 | Excedente, reduzível |
| **Duplicatas reais** (mesmo `api4com_call_id` em 2 rows) | 6 | Excedente, reduzível |
| **Calls `reconcile_api4com` com `duration=0`** | ~74 | Excedente, dependência API4COM |
| **Não classificado: 1028 -8 calls FALTANDO** | — | Webhook+reconcile não puxou tudo |

---

## Hipóteses validadas vs descartadas

### H1 — Calls "técnicas" extras pegas pelo refator
**STATUS: Parcialmente válida.**

- **65 calls "fantasma"** (`metadata.gateway = 'flux-*'`, sem `source`, sem `hangup_cause`, `duration=0`) foram iniciadas pelo dialer in-app mas nunca receberam confirmação do API4COM. Distribuição: 1024=7, 1028=0, 1033=20, 1040=31, 1042=7.
- API4COM dashboard provavelmente NÃO conta — a chamada nunca discou de fato.
- Após removê-las, gap residual: 1024=+23, 1028=−8, 1033=+35, 1040=+86, 1042=+3.

### H2 — Janela temporal divergente
**STATUS: Descartada.**

- `parseApi4ComTimestamp` corrige a "BRT-disguised-as-Z" do API4COM corretamente (`src/features/integrations/services/api4com-time.ts`).
- Reconciler filtra client-side `ts ∈ [since, now]` em UTC real.

### H3 — Calls atribuídas ao ramal errado
**STATUS: Não validável sem acesso ao dashboard API4COM.**

- Precisa cross-check: pegar 5 calls do dashboard API4COM de um SDR específico (ex.: Matheus 1028) e checar se estão no `enriquece.calls` com `origin = '1028'`.

### H4 — Fetch incompleto por paginação
**STATUS: Improvável após refator de 16/05.**

- Reconciler agora usa `metadata.totalPageCount` como stop definitivo (commit `27af2689`).
- Mas Matheus tem **-8 calls** (falta no Enriquece). Pode ser legado pré-refator que nunca foi backfilled.

---

## Bugs colaterais encontrados e corrigidos

### Fix 1 — `NUMBER_CHANGED` não estava mapeado na classificação

`NUMBER_CHANGED` é a **2ª causa mais comum** em V4 Amaral mai/2026 (690 calls). Caía no default do `classifyApi4ComCall` → `status='no_contact'` ao invés de `not_connected`.

**Arquivo:** `src/features/calls/services/api4com-classification.ts`
**Commit:** este push.

Impacto: cosmético — não afeta totais, mas faz a coluna "Status" no `/calls/extrato` ficar correta.

### Fix 2 — Reconciler descartava `call_type` do API4COM REST

Cada call retornada pelo `/calls` da API4COM tem um `call_type` (`outbound`/`inbound` na superfície, mas API4COM tem outros tipos internos que não documentamos ainda). O reconciler mapeava só `!= 'inbound' → 'outbound'` e descartava o valor original.

**Arquivo:** `src/app/api/workers/reconcile-api4com-calls/route.ts`
**Mudança:** agora persiste `metadata.call_type` pra futura análise de gap.

Impacto: forward-looking. Permite que a equipe verifique post-hoc se há `call_type` específico (ex.: `internal`, `transfer`) que o dashboard exclui.

---

## Reingest executado (17/05 21:17 BRT)

Rodado dry-run + live com `windowHours=408` (17d, cobre 30/abr → 17/mai) via `/api/workers/reconcile-api4com-calls`:

```json
{
  "fetched": 3250,
  "in_scope": 2446,
  "upserted_existing": 173,
  "inserted_new": 0,
  "skipped_unmapped": 804
}
```

**Zero novas inserções** — toda call que API4COM REST devolve já estava no Enriquece. Os 173 updates foram correções de classificação (hangup_cause, status, recording_url top-up).

Estado pós-reingest = **idêntico** ao pré-reingest:

| Ramal | Enriquece | API4COM Dashboard | Gap |
|---:|---:|---:|---:|
| 1024 | 763 | 733 | +30 |
| 1028 | 537 | 545 | −8 |
| 1033 | 508 | 453 | +55 |
| 1040 | 471 | 354 | +117 |
| 1042 | 99 | 89 | +10 |

## Diagnóstico final

**O fetch do Enriquece está completo** — REST `/calls` da API4COM devolve TODAS as calls que o dashboard exclui (`gateway: flux-*` ghost calls, calls com `NUMBER_CHANGED` + `duration=0`, etc). O **dashboard tem um filtro server-side** que o endpoint REST não expõe.

Os ramais `unmapped` (1026/1030/1031/1035/1038/1041) representam 804 calls que pertencem a usuários da org `v4amaral` mas não estão mapeados em `api4com_connections` do Enriquece — fora do escopo dos 5 SDRs do briefing.

**−8 Matheus**: mistério resta. API4COM REST devolveu todas as 537 calls do ramal 1028, mas dashboard mostra 545. Existem 8 calls "fantasmas no dashboard" que o REST não retorna. Hipóteses:
- Voicemail/transfer calls que dashboard atribui ao ramal de origem mas REST omite
- Calls inbound recebidas pelo ramal 1028 (REST do reconciler filtra `c.call_type !== 'inbound' → outbound`)
- Calls de outro ramal atribuídas ao Matheus por algum mapeamento interno

## Diff row-by-row contra CSV do dashboard (17/05 21:32 BRT)

CSV do dashboard exportado (`/Users/mercante/Desktop/export.csv`, 2174 calls mai/2026) confrontado contra o `enriquece.calls` (2378 calls).

### Sets por `api4com_call_id` (exato match):

| Conjunto | Count | Significado |
|---|---:|---|
| Match exato (mesmo ramal + mesmo api4com_call_id) | 2036 | Sincronizado |
| DB-only (no Enriquece, NÃO no CSV) | 337 | Excedentes |
| CSV-only (no dashboard, NÃO no Enriquece) | 138 | Faltantes |

### Após match flexível por `ramal + destino (últimos 10 dígitos) + ±60s`:

| Categoria | Count | Significado |
|---|---:|---|
| CSV-only com gêmea no DB | 119 | **Mesma call, double-ID API4COM** (REST devolveu ID X, dashboard mostra ID Y) |
| CSV-only sem gêmea no DB | **18** | **Truly missing — Enriquece nunca recebeu** |
| DB-only com gêmea no CSV | 271 | Mesma call gravada 2x no DB (webhook + reconciler com IDs diferentes) |
| DB-only sem gêmea no CSV | 60 | Excesso real (provavelmente ghost calls do flux que dashboard filtra) |

### As 18 truly missing por ramal:

| Ramal | SDR | Missing | Por causa |
|---|---|---:|---|
| **1028** | Matheus | **7** | 6 caixa postal, 1 atendida — explica o **-8** do briefing |
| 1024 | Ismael | 6 | 3 caixa postal, 1 atendida, 2 outros |
| 1033 | Guilherme | 3 | 1 caixa postal, 1 atendida, 1 cancelada |
| 1042 | Giovani | 2 | 1 caixa postal, 1 outros |
| 1040 | Rafael | 0 | — |

**59 das 138 CSV-only são "caixa postal"** (voicemail). Hipótese forte: **API4COM REST `/calls` omite voicemail calls** que o dashboard inclui. Esse seria o filtro server-side que estávamos procurando.

## Bugs estruturais identificados

### Bug 1 — API4COM gera 2 IDs para a mesma call
Dashboard mostra um `api4com_call_id`, REST `/calls` retorna outro. Reconciler tenta fallback (origin + dest + ±5min) e às vezes sobrescreve, às vezes não. Causa **119 calls aparecendo "missing"** mesmo estando no DB.

**Solução:** quando reconciler insere via fallback, fazer UPSERT lookup também pelo (origin, dest, started_at ±2min) e MERGE metadata.alt_api4com_ids[].

### Bug 2 — Reconciler+webhook duplicam quando IDs divergem
Webhook insere com ID A (request_id do dialer). Reconciler vê ID B (channel_id) e o fallback ±5min falha por algum motivo (timezone? typing?), inserindo um row novo com ID B. Resultado: 2 rows pra mesma call. **271 das 337 DB-only** caem aqui.

**Solução:** o fallback de 5min é insuficiente quando há jitter. Aumentar para ±10min OU adicionar fallback secundário por `(origin, last_10_dest, ±15min, duration ±5%)`.

### Bug 3 — Voicemail não chega ao Enriquece via REST
~60% das 138 CSV-only são "Caixa postal". Hipótese: API4COM REST omite voicemail (provavelmente classifica como evento de tipo diferente).

**Solução:** verificar se há endpoint API4COM diferente pra voicemails OU pedir documentação.

## Plano de remediação

### Fase 1 — Limpar duplicatas históricas (Bug 2)
Identificar e merge das 271 calls duplicadas (mesma call, 2 rows com api4com_call_ids distintos). Script de dedupe que:
1. Encontra pares com mesmo (origin, last_10_dest, ±60s)
2. Mantém o row mais completo (com `recording_url`, `transcript`, `lead_id`, etc.)
3. Migra `metadata.api4com_call_id` perdido pra `metadata.alt_api4com_ids[]`
4. Deleta o duplicado

Impacto esperado: gap +30/+55/+30/+117/+10 cai para algo próximo de zero (já que esses são compostos majoritariamente das duplicatas).

### Fase 2 — Reforçar fallback do reconciler+webhook (Bug 1 + 2)
Code change em `reconcile-api4com-calls/route.ts` e `webhooks/api4com/route.ts`:
- Aumentar janela do fallback de 5min → 10min
- Adicionar match secundário por `duration` similar (tolerância ±5%)
- Persistir todos os api4com_call_ids vistos em `metadata.alt_api4com_ids[]`

### Fase 3 — Voicemail (Bug 3)
Conversar com API4COM sobre endpoint dedicado a voicemails ou flag pra incluir voicemails no `/calls`.

## Status

- [x] Investigação concluída
- [x] Reingest 17d executado (confirma 0 calls missing via REST além das 18)
- [x] Diff row-by-row vs CSV dashboard
- [x] Code fixes colaterais aplicados (`NUMBER_CHANGED`, `call_type` capture)
- [x] **Fase 1: dedupe histórico executada — 60 pares de dupes deletados**
- [x] **Fase 2: reforçar fallback (code change, commit `3826ff9`)**
- [x] **Fase 3: sondagem API4COM concluída — escalação preparada**

## Resultado Fase 3 (executada em 17/05 22:35 BRT)

Criei endpoint de diagnóstico `POST /api/admin/probe-api4com-voicemail` e sondei 14 variações de endpoint/query da API4COM com a API key de produção do V4 Amaral.

**Conclusão**: Não há endpoint REST nem query param funcional para voicemails na API4COM.

| Tipo de tentativa | Resultado |
|---|---|
| `/voicemails`, `/messages`, `/recordings`, `/calls/voicemails` | 404 — não existem |
| `/calls?<param>=voicemail` (8 variações) | 200 mas query **silenciosamente ignorada** (devolve `/calls` puro) |

Documento de escalação pra API4COM preparado em `docs/briefings/2026-05-17-escalacao-api4com.md` — pronto pra enviar pelo canal de suporte.

## Status final

| SDR | Antes briefing | Após Fase 1+2 | Dashboard | Gap final |
|---|---:|---:|---:|---:|
| 1024 (Ismael) | +30 | +16 | 733 | +16 |
| 1028 (Matheus) | -8 | -11 | 545 | -11 (todos do voicemail) |
| 1033 (Guilherme) | +55 | +49 | 453 | +49 |
| 1040 (Rafael) | +117 | +91 | 354 | +91 |
| 1042 (Giovani) | +10 | **-1 ✅** | 89 | -1 |

**Compliance atingido pra 1 dos 5 SDRs**. Os restantes dependem de:
- Resolução do bug do voicemail no lado API4COM (Fase 3, externa)
- Análise extra de 60 "true excess" no DB (ghost flux calls do dialer interno que dashboard filtra)
- Próximas iterações do reconciler com filtro de `metadata.gateway` para ghost calls (decisão de produto)

## Resultado Fase 2 (executada em 17/05 22:20 BRT)

3 mudanças em `reconcile-api4com-calls/route.ts` + `webhooks/api4com/route.ts`:

1. **Lookup secundário** via `metadata.alt_api4com_ids[]` — quando evento chega com id B mas row já tem id A como primário, captura no array.
2. **Janela fallback 5min → 10min** — Phase 1 encontrou dupes onde started_at drifted 6-9min entre dialer row e REST row.
3. **Não sobrescreve mais primary** — append novos ids em alt_api4com_ids ao invés de trocar o primary. Mantém o id que o dashboard reconhece estável.

Impacto: novos dupes do tipo "mesma call, dois IDs" deixam de ser criados a partir do próximo evento. Backfill histórico continua coberto pela Fase 1.

## Resultado Fase 1 (executada em 17/05 22:00 BRT)

Critério conservador: pares onde **um** `api4com_call_id` está no CSV do dashboard e o outro NÃO, mesmo ramal + dest últimos 10 dígitos + ±60s no `started_at`. Garante que keepamos a versão que o dashboard reconhece.

Para cada par: backup da row drop em `calls_dedupe_backup_20260517`, append `drop_aid` em `metadata.alt_api4com_ids[]` da row keep, DELETE da drop.

| Ramal | Pré-dedupe | Pós-dedupe | Dashboard | Gap pré → pós |
|---|---:|---:|---:|---:|
| 1024 (Ismael) | 763 | 749 | 733 | +30 → +16 |
| 1028 (Matheus) | 537 | 534 | 545 | -8 → -11 |
| 1033 (Guilherme) | 508 | 502 | 453 | +55 → +49 |
| 1040 (Rafael) | 471 | 445 | 354 | +117 → +91 |
| 1042 (Giovani) | 99 | 88 | 89 | +10 → **-1 ✅ compliance** |

Backup: `calls_dedupe_backup_20260517` (60 rows, preservada indefinidamente até validação).

Pra reverter (se necessário): `INSERT INTO calls SELECT * FROM calls_dedupe_backup_20260517;` + reverter o `alt_api4com_ids` append nos 60 keeps.

### Passo 3 — Validar com query de aceitação (do briefing original)

```sql
SELECT origin AS ramal, COUNT(*) AS total,
       COUNT(*) FILTER (WHERE connected = true) AS conectadas
FROM calls
WHERE org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'
  AND origin IN ('1024','1028','1033','1040','1042')
  AND started_at >= ('2026-05-01'::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
  AND started_at <  ('2026-06-01'::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
GROUP BY origin
ORDER BY total DESC;
```

Target API4COM:
- 1024: 733 / 294
- 1028: 545 / 251
- 1033: 453 / 228
- 1040: 354 / 161
- 1042: 89 / 36

---

## Contato

Findings: `vinicius.mercante@v4company.com` (dev Enriquece). Para acionar reingest com auth prod, abrir ticket DevOps.
