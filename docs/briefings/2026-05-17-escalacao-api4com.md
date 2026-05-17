# Escalação API4COM — Lacuna entre dashboard e API REST `/calls`

> **Data:** 2026-05-17
> **Solicitante:** Vinicius Mercante (V4 Amaral)
> **Domínio API4COM:** `v4amaral.api4com.com`
> **Endpoint base:** `https://api.api4com.com/api/v1/`

---

## Problema observado

A API REST `GET /calls` está omitindo **calls com status "Caixa postal"** (voicemail) que o dashboard web da API4COM exibe corretamente.

### Evidência (V4 Amaral, mai/1–16 2026)

Exportei o CSV do dashboard "Chamadas por Ramal" dos 5 SDRs principais — 2.174 calls. Confrontei com o que `GET /calls` retorna no mesmo período (com paginação completa, sem filtros): **138 calls do CSV não aparecem na resposta da API REST**.

Composição das 138 calls "faltantes" no REST:

| Causa do desligamento | Quantidade |
|---|---:|
| Caixa postal | 59 |
| Atendida | 41 |
| Cancelada | 32 |
| Número não encontrado | 3 |
| Não foi possível completar | 2 |
| Rejeitada | 1 |

**Caixa postal é o cluster principal** (43% das missing). E são calls REAIS — têm `record_url` no dashboard, têm `from` (ramal) e `to` (destino).

### Sondagem dos endpoints (também 17/05)

Testei 14 variações com a API key de um ramal `connected` em `v4amaral.api4com.com`:

```
/voicemails              → 404 "Não há método para manipular GET /voicemails"
/messages                → 404 "Não há método para manipular GET /messages"
/recordings              → 404 "Não há método para manipular GET /recordings"
/calls/voicemails        → 404 "Shared class Call has no method handling GET /voicemails"
/calls?include_voicemail=true   → 200 (mas mesma primeira call do /calls puro — query ignorada)
/calls?has_voicemail=true       → 200 (idem)
/calls?status=voicemail         → 429 rate limit (não foi possível validar)
/calls?call_type=voicemail      → 200 (idem)
/calls?direction=voicemail      → 200 (idem)
/calls?is_voicemail=true        → 200 (idem)
```

Todos os query params são **silenciosamente ignorados** — devolvem o mesmo conjunto que `/calls` sem parâmetros. Não há endpoint dedicado.

## O que precisamos

Para fechar a paridade com o dashboard (requisito do gestor V4 Amaral, fechamento de Maio):

1. **Ideal**: um endpoint ou query param documentado que retorne calls de tipo "Caixa postal" via REST. Algo como `GET /voicemails`, `GET /calls?hangup_cause=VOICEMAIL`, ou um filtro que inclua voicemails no `/calls`.

2. **Aceitável**: documentação dos filtros server-side que o dashboard aplica em `/calls` para que possamos replicá-los. Atualmente os números do REST e do dashboard divergem em ~10% por SDR.

3. **Diagnóstico cruzado** (opcional): podemos enviar uma lista de `call_id`s do CSV que não aparecem no REST para vocês verificarem se há algum bug específico nesse subconjunto.

## Impacto

- Dashboards SDR no Enriquece sub-relatam ~6% das chamadas atendidas por SDR (até 25 calls/SDR em maio).
- Sales Hub (BI agregado) herda esse gap.
- Gestor V4 Amaral usa esses números para metas comissionáveis — impacto direto em comp.

## Contato

- **Conta API4COM:** `v4amaral`
- **Email do gestor:** vinicius.mercante@v4company.com
- **Período de evidência:** 01/05/2026 a 16/05/2026
- **Sample de call_ids "missing" disponíveis sob demanda** (138 IDs, formato UUID).

---

## Workaround temporário enquanto API4COM não responde

Documentar nos dashboards internos do Enriquece que "chamadas atendidas" sub-relata voicemails. Quando alinharmos com API4COM, ajuste retroativo via reingest.
