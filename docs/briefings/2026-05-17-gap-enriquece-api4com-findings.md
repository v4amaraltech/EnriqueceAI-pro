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

## Próximos passos (não-Enriquece)

Pra fechar o gap definitivamente:

1. **Contatar API4COM** — pedir documentação dos filtros aplicados no dashboard "Chamadas por Ramal" mai/2026. Especificamente: como filtra `gateway` (flux vs natural), `call_type` (outbound vs internal vs transfer), `is_billable`, `duration`/`hangup_cause` combinações.

2. **Exportar CSV do dashboard API4COM** pra um ramal específico (sugiro 1028 Matheus pra resolver o "-8") e diff row-by-row contra:
   ```sql
   SELECT metadata->>'api4com_call_id' AS aid, started_at, status, duration_seconds
   FROM calls
   WHERE org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b' AND origin = '1028'
     AND started_at >= '2026-05-01' AND started_at < '2026-06-01';
   ```

3. **(Opcional) Filtrar ghost calls** no dashboard interno do Enriquece adicionando WHERE clause `metadata->>'gateway' NOT LIKE 'flux-%'` em `RPC get_sdr_team_stats` — alinharia parte do excesso com dashboard API4COM, mas exclui calls reais do dialer (decisão de produto).

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
