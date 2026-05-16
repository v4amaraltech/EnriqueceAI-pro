# Gap Enriquece ↔ API4COM — Briefing Time Enriquece

> **Data:** 2026-05-17
> **Solicitante:** Vinicius Mercante (Gestor V4 Amaral)
> **Sistema afetado:** Sales Hub `/sdrs`, `/operacional`, `/closer` — todos consomem `call_logs` que vem do Enriquece via sync n8n.
> **Status:** sync funcionando, mas dados na fonte (`enriquece.calls`) divergem do API4COM.

---

## TL;DR

Após o refator do API4COM no Enriquece (16/05), os números de ligações por SDR no Enriquece **ainda não batem** com o dashboard oficial da API4COM. Sales Hub é réplica fiel do Enriquece — então o gap aparece em todos os dashboards de SDR/Closer downstream.

**Objetivo:** zerar o gap entre `enriquece.calls` e o dashboard API4COM até nível SDR. Quando isso for resolvido, o BI alinha automaticamente na próxima janela de sync (sem mudança no Sales Hub).

---

## Evidência — Maio/2026

Comparação direta por ramal (período: 01–16/05/2026, mesmo recorte usado no dashboard API4COM):

| Ramal | SDR | Enriquece (`calls`) | API4COM dashboard | Diff | Direção |
|---|---|---:|---:|---:|---|
| 1028 | Matheus Martins | 537 | 545 | **−8** | faltam calls no Enriquece |
| 1040 | Rafael Alecio | 471 | 354 | **+117** | sobram calls no Enriquece |
| 1033 | Guilherme Marques | 508 | 453 | **+55** | sobram calls no Enriquece |
| 1024 | Ismael Dobelin | 763 | 733 | **+30** | sobram calls no Enriquece |
| 1042 | Giovanni Olivieri | 99 | 89 | **+10** | sobram calls no Enriquece |

**O gap é bidirecional** — Matheus tem calls a menos, os outros 4 têm calls a mais. Não é só um filtro descalibrado em um sentido.

### Conectadas (atendidas)

| Ramal | SDR | Enriquece `status IN (significant, not_significant)` | API4COM Atendidas | Diff |
|---|---|---:|---:|---:|
| 1028 | Matheus | 251 | 251 | **0 ✅** |
| 1040 | Rafael | 186 | 161 | +25 |
| 1033 | Guilherme | 245 | 228 | +17 |
| 1024 | Ismael | 290 | 294 | −4 |
| 1042 | Giovanni | 32 | 36 | −4 |

Matheus está perfeito em atendidas — sugere que a regra de classificação `connected` está correta. O gap vem do **fetch de total de calls**, não da classificação.

---

## O que já foi investigado no lado Sales Hub

1. **Sales Hub bate com Enriquece:** comparação row-a-row mostra que o SH replica fielmente `enriquece.calls`. Drift residual de 7–16 calls por SDR é do refator API4COM (mesmo `api4com_call_id` gerado em 2 versões) — já dedupado pelo SH.

2. **Hipótese de filtro `duration = 0`:** Rafael tem 105 calls com `duration_seconds = 0` no Enriquece, e o diff Enriquece↔API4COM dele é +117. Quase bate, mas não fecha — e a hipótese não se sustenta para os outros SDRs (Matheus tem 217 dur=0 mas API4COM mostra MAIS que Enriquece, não menos).

3. **Distribuição de `status` no Enriquece (Rafael, 471 total):**
   - `not_connected`: 277 (avg 18s) ← possivelmente o que API4COM exclui
   - `not_significant`: 97 (avg 28s, 100% com recording_url)
   - `significant`: 89 (avg 137s, 69% com recording_url)
   - `no_contact`: 8 (avg 28s)

---

## Hipóteses prováveis (pra equipe do Enriquece validar)

### H1 — Refator API4COM no Enriquece está pegando calls "técnicas" extras
Talvez o fetch atual inclui events que o dashboard API4COM trata como "internas" ou "transbordos automáticos". Ex: `not_connected` com `duration = 0` (chamada que nunca discou de fato).

**Como validar:** comparar o JSON bruto da API API4COM (endpoint usado pelo refator) com o que aparece no dashboard. Provavelmente o dashboard aplica filtros próprios (`call.is_billable`, `call.has_audio`, etc).

### H2 — Janela temporal divergente
Dashboard API4COM mostra "01/05–16/05". Confirmar se o filtro no Enriquece é exatamente esse range em UTC vs America/Sao_Paulo.

**Como validar:** rodar o fetch com `from='2026-05-01T03:00:00Z'` e `to='2026-05-17T03:00:00Z'` (= 00:00–24:00 BRT).

### H3 — Calls atribuídas ao ramal errado / user_id mapeado errado
Matheus tem MAIS calls no API4COM que no Enriquece (−8). Pode ser que algumas calls disparadas do ramal 1028 estão chegando no Enriquece com `assigned_to` de outro user.

**Como validar:** pegar 5 calls do API4COM que existem (Matheus, Maio) e verificar se estão no `enriquece.calls` com `origin = '1028'`.

### H4 — Fetch incompleto por paginação/limit
Se o refator usa `limit` por chamada à API4COM e algumas páginas estão sendo skip-adas. Matheus −8 calls poderia ser isso.

---

## Critério de aceitação

Pra fechar o gap (idealmente até final de Maio pra fechamento do mês):

- [ ] Por ramal, `enriquece.calls` Maio/2026 = API4COM dashboard Maio/2026 (tolerância ≤ 1 call por SDR)
- [ ] Mesma paridade pra `connected = true` (= API4COM "Atendidas")
- [ ] Backfill dos meses anteriores se factível (Abril/2026 e antes pra não quebrar séries históricas)

---

## Pós-fix: zero mudança no Sales Hub

Quando o Enriquece estiver alinhado:
- Sales Hub `call_logs` se ajusta automaticamente na próxima janela de sync (workflow n8n `nJK3px1s2WLTthqj`, schedule 24min + pg_cron watchdog 30min)
- Dashboards `/sdrs`, `/operacional`, `/closer` mostram os números certos sem deploy
- O RPC `get_sdr_team_stats` já está usando `connected = true` (alinhado com a flag canônica do API4COM via Enriquece), validado em paridade exata pra Matheus

---

## Query de validação rápida (rodar no Enriquece)

```sql
-- Total calls Maio/2026 por ramal SDR
SELECT origin AS ramal, COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status IN ('significant','not_significant')) AS conectadas
FROM calls
WHERE org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'
  AND origin IN ('1024','1028','1033','1040','1042')
  AND started_at >= ('2026-05-01'::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
  AND started_at <  ('2026-06-01'::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
GROUP BY origin
ORDER BY total DESC;
```

Esperado pós-fix (= dashboard API4COM):
- 1024: 733 total / 294 conectadas
- 1028: 545 / 251
- 1033: 453 / 228
- 1040: 354 / 161
- 1042: 89 / 36

---

## Contato

Dúvidas sobre o lado Sales Hub: **Vinicius Mercante** (`vinicius.mercante@v4company.com`).

Documentação adicional: `funil_sync_enriquece_sales_hub.md` no Sales Hub memory (descrição da arquitetura de sync, padrões de bug conhecidos).
