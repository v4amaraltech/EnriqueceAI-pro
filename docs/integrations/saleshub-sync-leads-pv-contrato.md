# Contrato do sync "Sync Leads PV" (Enriquece → Sales Hub)

**Fluxo:** n8n `cNdb9RZLqFEM5S3t` ("V4 Flux <> Enriquece AI > Sync Leads PV"), 4×/h, chama a RPC
`get_leads_for_v4sales(p_api_token, p_from_date)` neste banco (`dhkmonctyoaenejemkrt`) como `anon`,
com o segredo `v4sales_public_rpc` e `p_from_date` = dia 1 do mês corrente, e repassa o array JSON
para `upsert_leads_pv(p_leads jsonb)` no Sales Hub (`ejxlbbbjyexsoltsxiqq`). Identidade: `enriquece_lead_id`
(= `leads.id`); SDR: `enriquece_user_id` (= `leads.assigned_to`) → `source_user_mapping`.

**Só o mês corrente é sincronizado** — campo novo não tem backfill automático.

## Onde a RPC é mantida

A partir de 12/set/2026 a definição canônica de `get_leads_for_v4sales` volta a viver **neste repo**
(`supabase/migrations/`). Até então a última versão em produção era a migration
`20260815100000_enriquece_get_leads_for_v4sales_propaga_first_touch_at.sql` do repo `v4-sales-hub`
(rodada aqui). Antes de alterar a RPC, conferir o corpo em produção com `pg_get_functiondef` — os dois
repos já divergiram uma vez e a versão errada derrubaria `first_touch_at`.

## Regras operacionais

- A função é `SECURITY DEFINER` e retorna `SETOF json`: acrescentar chave **não** muda a assinatura,
  então `CREATE OR REPLACE` basta. Mesmo assim, **sempre re-GRANT** `EXECUTE ... TO anon, authenticated,
  service_role` e conferir depois com `has_function_privilege('anon', ...)` (o `proacl` mente). Recriar
  sem GRANT parou o sync por 3 dias em mai/2026.
- Chave nova no JSON passa pelo n8n sem mudança; o Sales Hub só a grava depois de alterar
  `upsert_leads_pv` (parâmetro único `p_leads jsonb`; campos lidos por chave).
- Ordem de deploy: Enriquece primeiro (chave extra é ignorada), depois Sales Hub.

## Campos derivados de `closer_feedback_requests`

| Chave | Regra | Desde |
|---|---|---|
| `tem_feedback_closer` | existe request para o lead | mar/2026 |
| `decisor_presente` | `COALESCE(explícito, derivação por qualificacao_aderente/divergencias)` no feedback `meeting_done` mais recente | ago/2026 |
| `oportunidade_qualificada` (**SAO**) | resposta `meeting_done` mais recente com a pergunta preenchida; `true`/`false`/`null`; **sem proxy** | 12/set/2026 (pergunta existe desde 09/set) |

O SAO segue a mesma regra do card "SAO" do Dashboard (`src/features/dashboard/utils/latest-sao-by-lead.ts`).
Migration: `20260912151440_get_leads_for_v4sales_oportunidade_qualificada.sql`. Story: `docs/stories/sao-sales-hub-sync.story.md`.
