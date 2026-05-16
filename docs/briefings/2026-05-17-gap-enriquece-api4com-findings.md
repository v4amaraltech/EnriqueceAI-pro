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

## O que falta pra fechar gap

A análise via SQL no Enriquece não consegue distinguir calls "extras" das "esperadas" sem cross-check contra o que API4COM dashboard mostra. Os próximos passos exigem ferramentas do lado API4COM:

### Passo 1 — Exportar dashboard API4COM por SDR
Pegar o CSV/export do API4COM para os 5 ramais (mai/1–16) — total + lista de `call_id`. Trazer pra mim e comparo row-by-row.

### Passo 2 — Backfill via `/api/admin/reingest-api4com-calls`
Com `windowHours=1440` (60d), `dryRun=true` primeiro. Auth: prod `SUPABASE_SERVICE_ROLE_KEY` (DevOps). Vai retornar:
- `fetched`: total que API4COM REST devolveu
- `in_scope`: depois do filtro de ramal
- `inserted_new`: missing no Enriquece
- `upserted_existing`: já existia mas precisava atualizar

Se `fetched` (API4COM) bater com dashboard, o gap é só na nossa ingestão histórica. Reingest com `dryRun=false` resolve.

Se `fetched` ≠ dashboard, o problema é semântico (filtro do dashboard vs filtro do API4COM REST).

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
