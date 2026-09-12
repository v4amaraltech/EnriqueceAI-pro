# Story: SAO no Sales Hub — expor `oportunidade_qualificada` no sync e mostrar "% SAO" no funil por SDR

## Status
Ready

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-12 | Vini + Claude | Story criada (pedido: "cria a story do SAO no Sales Hub"), como continuação da `dashboard-sao-kpi-card` (Done, PR #404/#405), que deixou o Sales Hub fora de escopo. Base levantada nos dois repos e conferida em prod: a RPC `get_leads_for_v4sales` no ar é a versão `20260815100000` do repo `v4-sales-hub` (tem `first_touch_at`), sem SAO; `anon` tem EXECUTE (o n8n chama como anon). |
| 2026-09-12 | @po (Pax) | `*validate-story-draft`: **8/10 → GO condicional**, correções aplicadas: AC 5 apontava para `tests/security/definer-acl.test.ts`, que NÃO existe na `main` (vive na branch de hardening não mergeada) — reescrito como conferência SQL obrigatória + teste opcional; adicionadas as seções **Dependências** e **Definition of Done**. As 3 decisões abertas foram fechadas pelo Vini: migration **neste repo**; nome **`oportunidade_qualificada`** ponta a ponta; sem feedback = **nulo, conta só nas realizadas** (igual ao Dashboard). Draft → **Ready**. |

## Executor Assignment
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools: ["vitest", "typecheck", "lint", "sql-explain"]

## Origem

Desde 09/set/2026 o closer responde, em toda reunião **Realizada**, se a oportunidade é "Qualificada" — o **SAO** (Oportunidade Aceita por Vendas), coluna `closer_feedback_requests.oportunidade_qualificada`. O Dashboard do EnriqueceAI já mostra card, ranking e "Taxa SAO" (story `dashboard-sao-kpi-card`). O Sales Hub (`v4-sales-hub`, Supabase `ejxlbbbjyexsoltsxiqq`) **não recebe o campo**: a RPC `get_leads_for_v4sales` não o expõe, `leads_pv` não tem a coluna e a taxonomia do funil dele para em SAL (= reunião realizada) → Oportunidade (`won_at`).

O caminho a seguir é o mesmo que o `decisor_presente` percorreu em ago/2026: subselect na RPC do Enriquece → chave no JSON → `upsert_leads_pv` grava em `leads_pv` → `get_sdr_funil_breakdown` / `get_sdr_team_stats` / `vw_mb_sdr_funil` → coluna "% Decisor" em `/operacional` e `/sdrs`. Referências: `v4-sales-hub/docs/briefings/2026-08-04-decisor-na-call-enriquece.md`, `docs/sessions/2026-08/2026-08-09-closer-feedback-qualificacao-aderencia.md`.

Estado real em prod (12/set): set/2026 tem 21 realizadas, 4 avaliadas em SAO (4 qualificadas). O sync roda **só o mês corrente** (`p_from_date` = dia 1), então **não há SAO retroativo** — coerente com o Dashboard.

## Story

**As a** gestor que acompanha o time no Sales Hub,
**I want** ver, no funil por SDR, quantas reuniões realizadas o closer aceitou como oportunidade (SAO) e a taxa SAO ÷ realizadas,
**so that** o Sales Hub conte o mesmo degrau que o Dashboard do Enriquece, sem eu ter que abrir os dois.

## Acceptance Criteria

### Lado Enriquece (este repo — dono do schema)
1. `get_leads_for_v4sales(p_api_token, p_from_date)` devolve a chave **`oportunidade_qualificada`** (boolean ou null) por lead, com a MESMA regra do Dashboard: resposta mais recente de `closer_feedback_requests` com `result = 'meeting_done'` e `oportunidade_qualificada IS NOT NULL`, ordenada por `responded_at DESC NULLS LAST`, `LIMIT 1`. Sem fallback/derivação (não existe proxy para SAO).
2. A migration parte do **corpo em produção** (= `v4-sales-hub/supabase/migrations/20260815100000_enriquece_get_leads_for_v4sales_propaga_first_touch_at.sql`), preservando `first_touch_at`, `decisor_presente`, `tem_feedback_closer`, a autenticação por `p_api_token`/`verify_api_secret` e o filtro de janela. Só `CREATE OR REPLACE` (retorno é `SETOF json`, assinatura não muda).
3. A migration **re-GRANTa** `EXECUTE ... TO anon, authenticated, service_role` e a conferência pós-aplicação usa `has_function_privilege('anon', ...)` (o `proacl` mente). Recriar a função sem GRANT já parou o sync por 3 dias em mai/2026.
4. `EXPLAIN (ANALYZE)` da RPC antes/depois com `p_from_date` do mês: o subselect novo não pode mais que dobrar o custo do subselect de `decisor_presente`. Se estourar, criar índice `closer_feedback_requests (lead_id, responded_at DESC) WHERE oportunidade_qualificada IS NOT NULL` na mesma migration.
5. Conferência de ACL logo após aplicar a migration, registrada no Change Log com o resultado: `SELECT has_function_privilege('anon', 'public.get_leads_for_v4sales(text,text)', 'EXECUTE')` = true (idem `authenticated` e `service_role`) **e** uma chamada real da RPC com o token do n8n devolvendo a chave `oportunidade_qualificada`. Se a branch de hardening (`tests/security/definer-acl.test.ts`, commit `f48abfed`, ainda não mergeada) estiver na `main` até lá, incluir a RPC na allowlist do teste; se não, não criar o arquivo nesta story.

### Lado Sales Hub (repo `v4-sales-hub` — tarefas registradas aqui, executadas lá)
6. `leads_pv.oportunidade_qualificada boolean` (nullable) + `upsert_leads_pv` lê `(v_lead->>'oportunidade_qualificada')::boolean` e no `ON CONFLICT` usa `COALESCE(EXCLUDED.oportunidade_qualificada, leads_pv.oportunidade_qualificada)` (**sticky**, igual ao `decisor_presente`: sync posterior com null não apaga resposta já recebida).
7. `get_sdr_funil_breakdown(year, month)` devolve `+ sao int` (count `oportunidade_qualificada = true`) e `+ sao_conf int` (count `IS NOT NULL`); `vw_mb_sdr_funil` ganha as duas colunas **no fim** (CREATE OR REPLACE preserva grants); `get_sdr_team_stats` ganha `by_member.pct_sao = {actual, sao, realizadas}`.
8. UI: coluna **"% SAO"** ao lado de "% Decisor" em `src/components/operacional/tables.tsx` (`/operacional` e `/sdrs`), com o mesmo mecanismo de rótulo provisório (`"% SAO*"` enquanto `sao_conf = 0`) e o contador `conf N/M`; nova chave `pct_sao` em `METRICS` de `src/pages/SDRs.tsx`. Cores: verde ≥ 60%, amarelo ≥ 40%, vermelho abaixo (faixa de mercado para reunião realizada → oportunidade aceita: 50–60%).
9. Taxonomia (`docs/taxonomia.md`): novo degrau **SAO** entre SAL (realizada) e Oportunidade (`won_at`), com a definição e a data de início (09/set/2026).
10. Após o primeiro sync pós-deploy, paridade: `SELECT count(*) FILTER (WHERE oportunidade_qualificada) FROM leads_pv WHERE year=2026 AND month=9` = número do card "SAO" do Dashboard do Enriquece no mesmo instante.

## Scope
**IN (Enriquece):** 1 migration (`get_leads_for_v4sales` + GRANT [+ índice se o EXPLAIN pedir]); `pnpm gen:types` (a função não muda assinatura, diff deve ser vazio ou mínimo); teste de ACL; docs de integração.
**IN (Sales Hub):** migration de coluna + `upsert_leads_pv`; RPCs/view de funil; 2 componentes de UI; taxonomia. Sem mudança no n8n (o payload é jsonb, chave nova passa sozinha).
**OUT:** backfill de SAO em meses anteriores (o sync só cobre o mês corrente e o campo não existia antes de 09/set); meta de SAO em `pdi_monthly_goals` (meta fixa no front, como o "% Decisor" com 80%); SAO na tela `Closer.tsx` (candidato natural, fica para depois); aplicar a migration pendente `20260909210100` (outra frente, não toca esta RPC).

## Complexity
**M**. 1 migration no Enriquece com risco operacional (GRANT/sync), 3 migrations e 2 telas no Sales Hub, coordenação de deploy em 2 projetos.

## Risks
- **Perder o GRANT de `anon` ao recriar a função para o sync** (aconteceu em `20260512170000`; 3 dias sem sync). Mitigação: AC 3 + AC 5 + conferir `has_function_privilege` logo após aplicar.
- **Usar o corpo do repo Enriquece (`20260813130000`) como base** derruba `first_touch_at`, que alimenta o topo do funil do Sales Hub. Mitigação: AC 2 — base é o arquivo do repo B, conferido em prod (`tem_first_touch = true`).
- **Custo da RPC:** dois subselects por lead sobre `closer_feedback_requests` (só há o índice parcial `idx_feedback_unique_pending` em `lead_id`). Mitigação: AC 4.
- **Histórico curto:** o Sales Hub nasce com 4 linhas de setembro. Rótulo `"% SAO*"` + `conf N/M` (AC 8) evitam leitura errada.
- **Nome da chave:** coordenar `oportunidade_qualificada` ponta a ponta antes de subir (decisão registrada abaixo; se o Sales Hub preferir `sao`, muda nos dois lados de uma vez).
- **Ordem de deploy:** Enriquece primeiro (chave extra no JSON é ignorada pelo upsert atual, sem quebrar), depois Sales Hub. Na ordem inversa a coluna fica null até o Enriquece subir — inofensivo, mas confunde.

## Decisões (confirmadas pelo Vini em 12/set/2026, na validação do @po)
- Migration do Enriquece fica **neste repo** (dono do schema), com comentário apontando para a migration do repo B que serviu de base. O repo B passa a referenciar a versão daqui em vez de manter cópia (anotar no `docs/taxonomia.md` deles).
- Chave no JSON e coluna em `leads_pv`: **`oportunidade_qualificada`** (mesmo nome ponta a ponta, como `decisor_presente`).
- Sem proxy para SAO (diferente de `is_job_title_decisor`): quando não há resposta, é **null e conta só em `realizadas`** — mesma regra do Dashboard e da "Taxa SAO" por SDR. A coluna mostra `conf N/M` para deixar visível quantas ainda não foram avaliadas.

## Dependências
- **Pré-requisito (pronto):** story `dashboard-sao-kpi-card` Done e no ar (`1d46c38b`) — define a regra de SAO que esta story replica.
- **Base da migration:** corpo da RPC em produção = `v4-sales-hub/supabase/migrations/20260815100000_...` (conferido em prod em 12/set: `first_touch_at` presente, `anon` com EXECUTE). Re-conferir com `pg_get_functiondef` no dia da implementação.
- **Ordem de deploy obrigatória:** (1) migration do Enriquece em prod via MCP → (2) conferência de ACL (AC 5) → (3) migrations do Sales Hub → (4) redeploy manual do Sales Hub (Coolify) → (5) esperar 1 ciclo do sync (≤ 15 min) → (6) paridade (AC 10).
- **Não depende** da migration pendente `20260909210100` (hardening de outras RPCs) nem do n8n (payload jsonb, chave nova passa sozinha).
- **Acesso necessário:** MCP do Supabase do Enriquece (`dhkmonctyoaenejemkrt`) e do Sales Hub (`ejxlbbbjyexsoltsxiqq`), repo `v4-sales-hub` local, Coolify do Sales Hub.

## Definition of Done
- Todos os ACs 1–10 atendidos e a paridade do AC 10 registrada no Change Log (número do Sales Hub = número do card do Dashboard no mesmo instante).
- `has_function_privilege('anon', ...)` = true conferido e registrado após a migration (AC 5).
- `EXPLAIN` antes/depois anexado nos Dev Notes (AC 4).
- Enriquece: `pnpm typecheck && pnpm lint && pnpm test:run` verdes; `pnpm gen:types` sem diff (ou diff explicado).
- Sales Hub: build verde e telas `/operacional` e `/sdrs` conferidas com a coluna "% SAO".
- Handoff em `docs/sessions/2026-09/` e `docs/taxonomia.md` (repo B) atualizados.
- Sem commit/push/PR/merge sem pedido explícito, em cada um dos repos.

## Tasks
### Enriquece (este repo)
- [ ] Copiar o corpo de `v4-sales-hub/supabase/migrations/20260815100000_...` e conferir contra `pg_get_functiondef` em prod (diff zero) antes de editar
- [ ] Migration `YYYYMMDDHHMMSS_get_leads_for_v4sales_oportunidade_qualificada.sql`: subselect novo logo após `decisor_presente`, `CREATE OR REPLACE`, GRANT reafirmado, comentário de origem (Checkpoint 1)
- [ ] `EXPLAIN (ANALYZE, BUFFERS)` antes/depois; índice parcial só se necessário
- [ ] Aplicar em prod via MCP (pedido explícito) → conferir `has_function_privilege('anon', ...)` e uma chamada da RPC com `p_from_date` do mês devolvendo a chave
- [ ] `pnpm gen:types` (esperado: sem diff) + conferência de ACL registrada (AC 5)
- [ ] Docs: `docs/integrations/` (nota do campo novo no contrato do sync) + handoff
### Sales Hub (repo `v4-sales-hub`)
- [ ] Migration: `leads_pv.oportunidade_qualificada` + `upsert_leads_pv` (INSERT, VALUES, `ON CONFLICT` sticky)
- [ ] Migration: `get_sdr_funil_breakdown` (+`sao`, +`sao_conf`), `vw_mb_sdr_funil` (colunas no fim), `get_sdr_team_stats` (`pct_sao`)
- [ ] UI: `tables.tsx` (coluna "% SAO", rótulo provisório, `conf N/M`, cores 60/40) e `SDRs.tsx` (`METRICS.pct_sao`)
- [ ] `docs/taxonomia.md`: degrau SAO
- [ ] Redeploy manual do Sales Hub (Coolify) e paridade (AC 10)

## File List
_(preencher na implementação)_
- Enriquece: `supabase/migrations/<ts>_get_leads_for_v4sales_oportunidade_qualificada.sql`, `tests/security/definer-acl.test.ts`, `docs/integrations/…`
- Sales Hub: `supabase/migrations/<ts>_leads_pv_oportunidade_qualificada.sql`, `<ts>_sdr_funil_pct_sao.sql`, `src/components/operacional/tables.tsx`, `src/pages/SDRs.tsx`, `docs/taxonomia.md`

## Dev Notes
- Subselect a adicionar (espelha `latestSaoByLead` do Dashboard):
  ```sql
  (SELECT c.oportunidade_qualificada
     FROM closer_feedback_requests c
    WHERE c.lead_id = l.id
      AND c.result = 'meeting_done'
      AND c.oportunidade_qualificada IS NOT NULL
    ORDER BY c.responded_at DESC NULLS LAST
    LIMIT 1) AS oportunidade_qualificada,
  ```
- `upsert_leads_pv(p_leads jsonb)` tem **um único parâmetro jsonb** — não existe `p_decisor_presente`; campos entram por chave do payload. O n8n (`cNdb9RZLqFEM5S3t`, "Sync Leads PV", 4×/h) não precisa mudar.
- `data_reuniao_realizada` no Sales Hub já é a data do EVENTO (`20260909190000`), então SAO cai no mesmo mês nos dois lados.
- `upsert_leads_pv` não tem `SET search_path` (padrão do Enriquece tem) — fora de escopo, registrar.
- Não confundir `oportunidade_qualificada` (SAO) com `qualificacao_aderente` ("a qualificação bateu?").
- Ver também memória/handoff `docs/sessions/2026-09/2026-09-12-sao-no-dashboard.md`.

## QA Results
_pendente_
