# Improvements Backlog

Fila de melhorias técnicas (não-bloqueantes) identificadas em varreduras / sessões de manutenção. Cada item tem: contexto, por que importa, ação proposta. Ordenar por impacto/esforço quando for puxar.

---

## DB

### ~~`interactions.lead_id` FK sem `ON DELETE CASCADE`~~ — RESOLVIDO (comportamento intencional)
- **Identificado:** 2026-05-16 durante hard delete do lead Eurofrut.
- **Status (2026-05-30):** Esse item está **desatualizado**. Em `20260329000100_fix_fk_cascade_to_restrict` a FK foi mudada deliberadamente para `ON DELETE NO ACTION` (protege histórico contra hard-delete acidental). O `23503` agora é comportamento *intencional*, não bug. Mesma decisão aplicada a `cadence_enrollments.lead_id` e `enrichment_attempts.lead_id`. (`calls.lead_id` = SET NULL; `scheduled_activities.lead_id` = CASCADE.)
- **Workaround para hard delete manual continua válido:** deletar interactions explicitamente antes (`DELETE FROM interactions WHERE lead_id=...; DELETE FROM leads WHERE id=...;`).

### 215 leads `status='archived'` cosméticos
- **Identificado:** 2026-05-16. Bug histórico do botão Arquivar (antes do enum ter 'archived') deixou esses leads com status='archived' + deleted_at setado.
- **Impacto:** zero (todas queries filtram `deleted_at IS NULL`).
- **Ação proposta:** mass UPDATE pra normalizar `status` pra um valor padrão (`new` ou `unqualified`), ou aceitar como histórico.

### ~~`cadence_enrollments.loss_reason_id` gravado de forma incompleta~~ — RESOLVIDO (2026-06-06)
- **Resolução (PR #10, `63515d6`):** adotada a Opção B — `leads.loss_reason_id` (+ `loss_notes`) virou a **fonte canônica**. Migration `20260606120000` adicionou as colunas + backfill da última interação `lead_lost` por lead (~1072). `markLeadLost` e `expireInactiveLeads` passam a gravar o motivo no lead; dashboard e relatório leem de `leads` (não mais de interactions/enrollments). A coluna `cadence_enrollments.loss_reason_id` segue sendo escrita (denormalizada) mas **não é mais fonte de leitura** — candidata a depreciação futura, sem urgência.
- **Identificado:** 2026-06-06 investigando o gráfico de Motivos de Perda vazio.
- **Causa original:** `markLeadLost` só gravava `loss_reason_id` em enrollments `active`/`paused`; lead perdido sem cadência nesse estado (a maioria) não recebia o motivo. V4 Amaral junho = 157 perdas, 0 com motivo no enrollment.

---

## Performance

### LDR indexes não usados (~1 MB total)
- **Identificado:** 2026-05-16 via Supabase performance advisor.
- **Indices:** `idx_empresas_cnpj` (232k), `idx_empresas_status`, `idx_empresas_segmento`, `idx_empresas_uf`, `idx_empresas_prioridade`, `idx_empresas_score_ia`, `idx_socios_empresa`, `idx_socios_cnpj` (280k), `idx_socios_validacao`, `idx_socios_decisor`, `idx_ldr_pipeline_log_empresa_id`, `idx_ldr_pipeline_log_socio_id`.
- **Causa:** feature LDR (Lead Discovery Robot) pouco usada — queries nunca acertam esses indices.
- **Impacto:** writes no `ldr_empresas`/`ldr_socios` pagam manutenção desses indices à toa.
- **Ação proposta:** auditar uso real da LDR. Se permanecer dormente, drop indices. Se for ativar, manter.

### ~~`idx_calls_hangup_cause` recém-criado, ainda sem queries~~ — não aparece mais no advisor
- **Identificado:** 2026-05-16 (criado nesse mesmo dia em `20260516171313_calls_add_connected_answered_at`).
- **Status (2026-05-30):** Performance advisor não lista mais esse índice como `unused_index` — passou a ser usado ou foi dropado. Resolver/remover da fila.

### `unused_index` — vários índices novos além dos LDR (~37 no total)
- **Identificado:** 2026-05-30 via Supabase performance advisor.
- Além dos 12 índices LDR já listados acima, o advisor aponta dezenas de índices de FK criados preventivamente em `20260328160000_add_performance_indexes` e `20260329000200_add_missing_fk_indexes` que nunca foram acionados: `idx_interactions_original_template_id`, `idx_cadences_auto_loss_reason_id`, `idx_cadences_created_by`, `idx_cadences_deleted`, `idx_subscriptions_plan_id`, `idx_lead_imports_org_id`, `idx_organizations_owner_id`, `idx_closers_org_id`, `idx_daily_activity_goals_user_id`, `idx_goals_created_by`, `idx_goals_per_user_user_id`, `idx_leads_created_by_simple`, `idx_leads_telefone_digits`, `idx_members_user`, `idx_wa_credits_org_period`, `idx_provider_events_org_id`, `idx_api_keys_created_by`, `idx_api_keys_org_active`, `idx_api4com_connections_user_id`, `idx_call_daily_targets_user_id`, entre outros.
- **Impacto:** baixo (manutenção de write à toa). Índices de FK valem manter se houver DELETEs de pai frequentes; o resto é candidato a drop.
- **Ação proposta:** auditar `pg_stat_user_indexes.idx_scan` em conjunto antes de qualquer drop em massa. Não dropar `idx_leads_whatsapp_invalid` (criado 25/05, novo demais para avaliar).

---

## Security / Auth (config Supabase Studio)

### Habilitar Leaked Password Protection
- Studio → Authentication → Settings → "Have I Been Pwned" check.
- Bloqueia signup/reset com senhas vazadas (lista HIBP).

### Habilitar mais opções de MFA
- Studio → Authentication → Settings → MFA factors.
- Hoje TOTP único; advisor recomenda adicionar phone/webauthn.

### Upgrade Postgres 17.4.1.075 → versão mais recente
- Patches de segurança pendentes.
- Requer planejamento de downtime (~5min) ou usar leitor durante upgrade.

### `count_leads_by_status`, `get_distinct_lead_canais/cnaes`, `get_executed_steps` callable por authenticated
- Funções SECURITY DEFINER chamadas via session do usuário em `fetch-leads.ts` e `fetch-pending-activities.ts`.
- **Não pode revogar** sem reescrever os callers para usar service-role.
- **Ação proposta:** migrar callers pra service-role + revogar EXECUTE de authenticated. Médio esforço.

---

## Sales Hub Integration

### Trocar regra do n8n `nJK3px1s2WLTthqj` no SH
- Hoje: `connected = (status='significant')` — subreportava antes do fix
- Depois do fix do Enriquece: deve virar **`connected = calls.connected`** (consumir a nova coluna direto)
- Bonus: reverter o workaround `duration_seconds >= 15` em `get_sdr_team_stats` no SH

---

## Webhook reliability

### `markEventReceived` race condition no WhatsApp webhook
- **Identificado:** sessões anteriores (mencionado em memory).
- **Ação proposta:** ainda não investigado — manter na fila pra rodada futura.

---

## Governança de schema (ALTO — novo 2026-05-30)

### Drift de migrations local ↔ produção — MAIOR do que parecia
- **Identificado:** 2026-05-30. Diff bidirecional por nome entre `supabase_migrations.schema_migrations` (registro remoto, 230 nomes únicos) e `supabase/migrations/` (repo local, 197).
- **Dimensão real (não é só "4 faltando"):**
  1. **~62 migrations só no REMOTO** (no banco, ausentes do repo) — todo o bloco LDR/decisor/v4sales/RPCs de mar–abr (`create_rpc_buscar_proximo_decisor`, `create_get_leads_for_v4sales`, `get_sdr_monthly_metrics_*`, `update_dashboard_view_*`, etc.).
  2. **24 migrations só no LOCAL** (no repo, ausentes do registro) — incl. `add_lost_at_to_leads`, `add_qualified_at_to_leads`, `add_meeting_held_at`, `scheduled_activities`, `security_hardening`, `enable_rls_ldr_tables`.
  3. **Timestamps divergentes** (offset BRT→UTC, ~3h) nas migrations que coincidem por nome (ex.: avatars storage policy local `20260522004255` vs remoto `20260522034236`).
- **Causa raiz provável:** os históricos bifurcaram (squash/rebaseline de um lado, `db push`/`apply_migration` com renome do outro). **Os efeitos do DDL estão TODOS em produção** — verificado: colunas `leads.lost_at/qualified_at/meeting_held_at` e tabela `scheduled_activities` existem em prod, embora seus nomes de migration não estejam no registro. Ou seja: a app funciona; o que está fora de sincronia é o *histórico versionado*, não o schema efetivo.
- **Impacto:** ALTO para reprodutibilidade. `supabase db reset`/`db push` a partir do repo NÃO reproduz prod e pode tentar re-aplicar/recriar objetos. Zero impacto no runtime atual.
- **Progresso (2026-05-30):** as 4 migrations mais recentes que faltavam (hotfixes de 27/05: `fix_rls_backup_tables`, `fix_anon_execute_calls_function`, `fix_indicacoes_ranking_anon_bypass`, `fix_calls_function_revoke_public`) foram trazidas do registro remoto para o repo com timestamp idêntico e nota de reconciliação. Reduz o gap remoto-only de ~62 para ~58.
- **Ação proposta (PROJETO dedicado — @data-engineer/@devops, decisão estratégica antes de tocar):** adotar **produção como fonte da verdade** e regenerar o histórico local a partir dela (dump do schema + baseline), OU `supabase migration repair` para alinhar o registro. NÃO reconciliar por rename manual de 86 arquivos — risco alto. Nenhuma execução contra o banco sem plano aprovado.

### 4 tabelas `calls_*_backup_20260517` órfãs em produção
- **Identificado:** 2026-05-30 via security + performance advisors.
- **Tabelas:** `calls_dedupe_backup_20260517`, `calls_ghost_backup_20260517`, `calls_guilherme_extra_backup_20260517`, `calls_refined_backup_20260517`.
- **Sintoma:** RLS habilitada sem policy (default-deny, ok) + sem PK; criadas ad-hoc numa operação de dedupe de calls em 17/05, não existem em nenhuma migration.
- **Impacto:** baixo (default-deny), mas é lixo de schema que polui advisors.
- **Ação proposta:** confirmar que os dados já foram reconciliados e `DROP TABLE` (operação em prod — requer aprovação).

### ~~Convenção de `supabase/rollbacks/` abandonada~~ — RESOLVIDO (descontinuada 2026-06-05)
- **Resolução:** convenção **descontinuada** por decisão do time. Removidos os 10 scripts de `supabase/rollbacks/` (diretório deletado) e a menção no `.claude/CLAUDE.md` (agora "forward-only migrations"). Comentários `-- ROLLBACK: See supabase/rollbacks/...` no topo de `20260221001500_calls_module.sql` e `20260222120000_call_settings.sql` ficam obsoletos, mas não se edita migration aplicada.
- **Identificado:** 2026-06-01 ao avaliar pedido de "deletar rollback antigo".
- **Estado:** existem 10 scripts em `supabase/rollbacks/`, **todos pareados** com migrations reais de fev–mar (nenhum órfão — os 3 que pareciam órfãos eram só diferença de formato de timestamp: `20260221_000004` ↔ `20260221000400`). Porém a convenção **parou**: das ~200 migrations no repo, só as ~10 primeiras (até `20260329000400`) têm rollback; as ~190 seguintes não têm.
- **Impacto:** baixo no runtime; **falsa sensação de segurança** (parece haver estratégia de rollback, mas cobre <5% das migrations) e contradiz a menção em `CLAUDE.md` ("Rollbacks in `supabase/rollbacks/`"). Agravado pelo drift de migrations acima.
- **Ação proposta (decidir conscientemente — NÃO deletar avulso):** ou **reviver** a convenção (rollback por migration daqui pra frente + backfill das críticas), ou **descontinuar formalmente** (remover `supabase/rollbacks/` + tirar a menção do CLAUDE.md) para não enganar. Recomendação: **descontinuar**, dado o drift — rollback por arquivo tem valor limitado quando o histórico versionado não reproduz prod. Ver item de drift acima.

---

## Testes (ALTO — novo 2026-05-30)

### ~~Regressão da suíte: 159 falhas / 46 arquivos~~ — RESOLVIDO (2026-05-30)
- **Status:** Suíte voltou a 100% verde (1335 passando, 1 arquivo de integração skipped, 0 falhas). Corrigido nesta sessão: `tests/setup.ts` (env + mock `next/cache`), `tests/mocks/supabase.ts` (query-builder completo), `vitest.config.ts` (`testTimeout` 15s), ~41 arquivos de teste alinhados ao código atual, e 1 bug real de produção (`update-organization.ts` engolia `NEXT_REDIRECT`). `features/admin` segue sem testes (cobertura futura).
- **Identificado:** 2026-05-30 rodando `pnpm test:run`. Subiu de ~39 falhas reportadas antes.
- **Nenhum bug de produção** — falhas concentradas em infra de teste:
  - **~60×** chains de mock Supabase incompletos (faltam `ilike`, `not`, `is`, `in`, `limit`, `rpc`). Maior ofensor: `tests/mocks/supabase.ts` (compartilhado por 24 arquivos) + mocks locais.
  - **~40×** ambiente: `revalidatePath`/`revalidateTag` não mockados, `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL` ausentes no setup, `cookies()` fora de escopo de request.
  - **~30×** drift de assertion: copy renomeada não acompanhada pelos testes ("Oportunidades"→"Reuniões", `formatDuration` `0:00`→`00:00`, `AVAILABLE_TEMPLATE_VARIABLES`, loss-reasons, DateRangePicker, AnalyticsFilters).
- **`features/admin` tem ZERO testes** (única feature sem cobertura).
- **Status:** em correção nesta sessão (Opção 2). Ordem: setup (env + next/cache) → mock compartilhado → mocks locais + assertions.

---

## Dependências (MÉDIO — novo 2026-05-30)

### 38 deps desatualizadas, 10 com major bump
- **Identificado:** 2026-05-30 via `pnpm outdated`. typecheck e lint estão 100% limpos — risco é drift acumulado, não quebra imediata.
- **Majors de maior impacto (breaking, caminhos críticos):** `zod` 3→4 (validação em todo o projeto), `stripe` 20→22 (billing), `typescript` 5→6 e `eslint` 9→10 (toolchain — validar `eslint-config-next`), `@supabase/ssr` ainda 0.x (sessão/auth), `lucide-react` 0.x→1.x, `react-day-picker` 9→10.
- **Ação proposta:** subir um major de cada vez, isolado, com suíte de testes saudável como rede (depende da correção de testes acima). Começar pelos de baixo risco (minors atrasados: `next`, `react`, `@sentry/nextjs`, `@supabase/supabase-js`).

