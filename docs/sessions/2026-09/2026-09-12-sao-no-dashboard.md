# Handoff — SAO (Oportunidades Aceitas por Vendas) no Dashboard

**Data:** 12/09/2026
**Pedido de origem (Vini):** "Como agora estamos mapeando via feedback do closer se é uma oportunidade qualificada, conseguimos criar uma visualização dessa em anexo para SAO?", com o print do card grande "Reuniões realizadas em Setembro" (21 / meta 79 / 30% abaixo do ritmo).
**Estado final:** **PR #404 mergeado** 10:15 UTC (squash `1d46c38b`); story **Done**. ⚠️ `gh pr merge --auto --squash` mergeou com o job "Lint · Typecheck · Test · Build" ainda pendente (a proteção da branch não exige esse check; `--auto` não espera) — lição: esperar o CI do PR terminar antes de mergear. Implementado originalmente na `main` local, **sem commit/push/PR** até o pedido. typecheck ✅ lint ✅ testes ✅ (2.067 no total; +19 novos) build ✅. **Migration aplicada em prod** às ~09:55 UTC (versão `20260912095504`, pedido do Vini) e `pnpm gen:types` rodado (diff de 6 linhas). Story `docs/stories/dashboard-sao-kpi-card.story.md` em InProgress.

---

## 1. Decisões (AskUserQuestion, 12/set)

| Pergunta | Decisão |
|---|---|
| Número grande | **Quantidade de SAO** (não taxa). |
| Meta | **Meta própria** no "Editar metas": `goals.sao_target` (org) e `goals_per_user.sao_target` (por SDR). |
| Escopo | Card grande **+** ranking "SAO" por SDR **+** ranking "Taxa SAO" (SAO ÷ realizadas) **+** corrigir o tooltip de "Reuniões realizadas" (ainda falava em `status='won'`). |

Decisões técnicas minhas (rotina):
- **Âncora = data da REUNIÃO** (`meetingHeldAnchor`), não `responded_at`/`sent_at` das telas de feedback. SAO ⊆ realizadas em todo ponto do gráfico; evita o "carimbo × evento" corrigido em 09/set.
- **Feedback por lead = o mais recente entre os que preencheram a pergunta** (`oportunidade_qualificada IS NOT NULL`, `responded_at` not null). No-show/remarcada depois reabre o lead e zera `meeting_held_at`, então ele sai do universo sozinho.
- Reunião **sem feedback não entra** (nem aceita, nem recusada). O card diz "N avaliadas de M realizadas · K sem feedback do closer".
- Régua dupla mantida (contagem até hoje, pacing até ontem).
- Ranking de realizadas não aplica filtro de cadência (nunca aplicou); KPI aplica. SAO espelha cada lado.

Estado real em prod ao começar (só leitura): set/2026 = 21 realizadas, 19 com feedback, **4 avaliadas em SAO (4 qualificadas)**, primeira em 09/set. O card nasce mostrando 4 — a linha "avaliadas de realizadas" existe para o gestor não ler como queda.

## 2. O que foi feito (arquivos)

- **Banco:** `supabase/migrations/20260912095504_goals_sao_target.sql` — `sao_target integer NOT NULL DEFAULT 0` em `goals` e `goals_per_user`. Aditiva; RLS já cobre.
- **Novos:** `utils/latest-sao-by-lead.ts` (util puro, resolve o feedback mais recente por lead) e `services/sao-feedback.service.ts` (`fetchSaoByLead`: `closer_feedback_requests` em `chunkedIn`, fonte única do SAO no Dashboard).
- **KPI** (`dashboard-metrics.service.ts`): `fetchOpportunityKpi` dividido em `fetchHeldLeadsForKpi` (universo + filtros) e `buildKpiData` (pacing/série); nova `fetchSaoKpi` devolve `SaoKpiData` (= `OpportunityKpiData` + `heldTotal`/`evaluatedTotal`/`qualifiedTotal`). `get-dashboard-data` cria a promise de realizadas **uma vez** e passa aos dois KPIs.
- **Ranking** (`ranking-metrics.service.ts`): `fetchHeldLeadsForRanking` extraído de `fetchMeetingsHeldRanking`; `buildRateRanking` extraído do corpo duplicado de Hit Rate/Comparecimento (sem mudança de comportamento, testes antigos passam); novas `fetchSaoRanking` e `fetchSaoRateRanking`; `fetchIndividualTargets` aceita `'sao_target'`; `RankingData.sao`/`saoRate`. `get-ranking-data` passou a iterar `Object.values(ranking)` (não há mais lista manual de cards para esquecer).
- **Metas:** `saveGoalsSchema`/`userGoalSchema` (`saoTarget` opcional, default 0 — deployment skew), `GoalsData`/`UserGoalRow`, `get-goals`, `save-goals`, `GoalsModal` (card "Meta de SAO" + coluna "SAO" por vendedor).
- **UI:** `OpportunityKpiCard` ganhou `subtitleExtra` e mantém sigla em maiúsculas na frase da meta ("Meta de SAO para setembro"); `DashboardView` tem o card "SAO" após "Reuniões realizadas", grid do funil com 6 cards em **3 colunas** (Abertos → Marcadas → Realizadas → SAO → Hit Rate → Taxa SAO), tooltips de realizadas corrigidos.
- **Docs:** `docs/guides/dashboard-cards.md` (SAO + regra atual de realizadas), story nova.

Conferência visual: página temporária `src/app/docs/sao-check/page.tsx` (apagada) no preview, claro e escuro — card, linha de contexto, meta, gráfico e os 3 rankings OK.

## 3. Pendências (nesta ordem)

1. ~~Aplicar a migration em prod~~ ✅ feito 12/set (`20260912095504`; `sao_target integer NOT NULL DEFAULT 0` conferido nas 2 tabelas).
2. ~~`pnpm gen:types`~~ ✅ feito (6 linhas). Commitar separado (`chore(types): regenerate`).
3. ~~Commit + PR~~ ✅ PR #404 mergeado (`1d46c38b`). Confirmar deploy pelo `/api/version` = `1d46c38`.
4. Gestor preencher a **meta de SAO de setembro** (org e por SDR) no "Editar metas" — sem meta, card sem ritmo e rankings sem "ideal dia".
5. Paridade pós-deploy (só leitura): card = 4 SAO de 21 realizadas em set (query de conferência na memória `dashboard-sao-kpi-card`).
6. Fora de escopo, anotar como story futura: SAO no Sales Hub (`get_leads_for_v4sales` não expõe `oportunidade_qualificada`).

## 4. Lições

- `closer_feedback_requests` não tem coluna de data de reunião nem de SDR: tudo vem do join com `leads` (`meeting_starts_at`/`meeting_held_at`/`assigned_to`). As telas de feedback filtram por `sent_at` — **não** copiar isso para o Dashboard.
- `buildRankingCardData` preenche `idealToDate` em **todo** SDR quando há `individualTargets` (fallback compartilhado por entrada) — um teste novo assumiu `undefined` e errou.
- `fetchLeadsFinishedRanking` não consulta `leads` quando não há enrollments — contar chamadas de `from('leads')` em `fetchRankingData` depende disso.
- Working tree da `main` tinha deleções staged de outra sessão (arquivos do PR #401) — não tocadas.
