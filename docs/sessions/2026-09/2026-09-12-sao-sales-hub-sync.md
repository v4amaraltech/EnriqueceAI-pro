# Handoff — SAO no Sales Hub (story `sao-sales-hub-sync`)

**Data:** 12/09/2026
**Pedido de origem (Vini):** "cria a story do SAO no Sales Hub" → "@po valida" → "@dev implementa a story sao-sales-hub-sync".
**Estado final:** implementado nos DOIS repos e **migrations aplicadas em prod** (Enriquece `20260912151440`; Sales Hub `20260912151522` + `20260912151658`), ACL e grants conferidos, `gen:types` sem diff. **PRs:** Enriquece #408 **mergeado** (`b035db98`, no ar) · Sales Hub v4amaraltech/v4-sales-hub#135 **mergeado** (`00d78a10`) · docs #409 **mergeado** (`130719d5`, 14/set). **Paridade ✅** (AC 10): sync 15:22 UTC → `leads_pv` 4 SAO em set = Dashboard. Story **Done**. Falta só o redeploy manual do Sales Hub (Coolify) para as telas.

---

## 1. O que foi feito

### Enriquece (`EnriqueceAI_Pro`)
- `supabase/migrations/20260912151440_get_leads_for_v4sales_oportunidade_qualificada.sql` — `CREATE OR REPLACE` da RPC com o subselect de SAO (resposta `meeting_done` mais recente com `oportunidade_qualificada IS NOT NULL`) + re-GRANT para `anon, authenticated, service_role`. **Base = corpo em produção** (= `20260815100000` do repo `v4-sales-hub`, conferido por `pg_get_functiondef`, diff zero).
- `docs/integrations/saleshub-sync-leads-pv-contrato.md` — contrato do sync, onde a RPC é mantida, regras de GRANT, campos derivados do feedback.
- EXPLAIN (AC 4): subselect novo ≈ 0,066 ms/lead, igual ao do `decisor_presente`; índice dispensado.

### Sales Hub (`v4-sales-hub`)
- `supabase/migrations/20260912151522_leads_pv_oportunidade_qualificada.sql` — coluna `leads_pv.oportunidade_qualificada` + `upsert_leads_pv` lendo a chave (sticky no `ON CONFLICT`) + GRANT. Corpo copiado de prod.
- `supabase/migrations/20260912151658_sdr_funil_pct_sao.sql` — `get_sdr_funil_breakdown` (+`sao`, +`sao_conf`; DROP+CREATE porque o `RETURNS TABLE` muda), `vw_mb_sdr_funil` (colunas no fim), `get_sdr_team_stats(year, month, fonte)` (`by_member.pct_sao = {actual, sao, sao_conf, realizadas}`); GRANT em tudo. Corpos copiados de prod (`ejxlbbbjyexsoltsxiqq`).
- `src/components/operacional/tables.tsx` — coluna "% SAO" (ou "% SAO*" enquanto `sao_conf = 0`) ao lado de "% Decisor", com `conf N/M`; cores 60/40.
- `src/pages/SDRs.tsx` — indicador `pct_sao` (meta fixa 60%); agregador de ratio generalizado por `ratioNumKey` (antes hardcoded em `decisor`).
- `docs/taxonomia.md` — degrau SAO (tabela, seção, histórico), e nota de que a RPC passa a ser mantida no repo Enriquece.
- `tsc` ✅, `vite build` ✅, eslint sem problemas novos (os erros de `no-explicit-any` já existiam nos dois arquivos).

## 2. Ordem de deploy (passos 1–3 e 5 feitos em 12/set; falta só 4 = redeploy manual do Sales Hub)

1. **Enriquece:** aplicar `20260912151440` via MCP → conferir `has_function_privilege('anon', 'public.get_leads_for_v4sales(text,text)', 'EXECUTE')` = true e chamar a RPC com o token do n8n devolvendo `oportunidade_qualificada` → `pnpm gen:types` (esperado sem diff).
2. **Sales Hub:** aplicar `20260912151522` e depois `20260912151658` via MCP (projeto `ejxlbbbjyexsoltsxiqq`) → conferir grants das 3 funções e da view.
3. Esperar 1 ciclo do sync (≤ 15 min) ou disparar o webhook do n8n.
4. Redeploy manual do Sales Hub (Coolify) para as telas.
5. Paridade (AC 10): `SELECT count(*) FILTER (WHERE oportunidade_qualificada) FROM leads_pv WHERE year=2026 AND month=9` = card "SAO" do Dashboard (12/set: 4).
6. Commits/PRs nos dois repos (pedido explícito, um por repo).

## 3. "22 × 21 realizadas" — investigado em 14/set: não era divergência

Na sexta (12/set) o funil do Sales Hub somava **22** realizadas em setembro e o Dashboard do Enriquece mostrava **21**. Cruzamento lead a lead em 14/set: os dois bancos têm **os mesmos 22 leads**, com as mesmas datas de evento e de carimbo; nenhum deletado, nenhuma reunião futura, nenhum SDR sem mapeamento.

A diferença era o **horário da medição**: a leitura "21" do Dashboard foi feita antes das 09:30 BRT de 12/set; a 22ª reunião (evento 12/set 10:00 BRT) foi carimbada como realizada às 10:00 BRT (13:00 UTC), e o funil do Sales Hub foi lido à tarde, já com ela. Conferido com corte de horário: `meeting_held_at <= 12/set 09:30 BRT` → 21; agora → 22.

**Regra para as próximas comparações:** ler Dashboard e Sales Hub no mesmo instante, ou comparar com um corte de horário fixo. Sem isso, qualquer reunião carimbada entre as duas leituras vira "divergência" falsa.

## 4. Lições

- **Duas fontes da mesma RPC em dois repos**: a versão em produção era a do outro repo. Regra nova: conferir `pg_get_functiondef` antes de usar qualquer arquivo como base; a definição canônica volta a viver no Enriquece (dono do schema).
- **MCP do Supabase alcança os dois projetos** (`dhkmonctyoaenejemkrt` e `ejxlbbbjyexsoltsxiqq`) — copiar corpos de função direto de prod evita usar migration desatualizada.
- `upsert_leads_pv` não tem `SET search_path` (padrão do Enriquece tem) — mantido como estava; fora de escopo.
