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

### Drift de migrations local ↔ produção
- **Identificado:** 2026-05-30 cruzando `list_migrations` (remoto) com `supabase/migrations/` (local).
- **Sintomas:**
  1. **4 migrations existem só no DB remoto, não commitadas no repo:** `20260527172645_fix_rls_backup_tables`, `20260527172653_fix_anon_execute_calls_function`, `20260527172751_fix_indicacoes_ranking_anon_bypass`, `20260527172833_fix_calls_function_revoke_public`. Pelos nomes, são hotfixes de findings de advisor aplicados direto em prod.
  2. **Mesmas migrations lógicas com timestamps diferentes** local vs remoto (ex.: avatars storage policy local `20260522004255` vs remoto `20260522034236`; goals/dashboard de 22-26/05).
- **Impacto:** ALTO. `supabase db reset` local não reproduz o estado de produção — schema parcialmente fora de controle de versão.
- **Ação proposta (precisa @devops/@data-engineer, NÃO mexe no DB):** baixar os 4 SQLs de 27/05 do remoto e commitar no repo; reconciliar timestamps divergentes (`supabase migration repair` ou alinhar manualmente). Nenhuma execução contra o banco — só sincronizar o histórico versionado.

### 4 tabelas `calls_*_backup_20260517` órfãs em produção
- **Identificado:** 2026-05-30 via security + performance advisors.
- **Tabelas:** `calls_dedupe_backup_20260517`, `calls_ghost_backup_20260517`, `calls_guilherme_extra_backup_20260517`, `calls_refined_backup_20260517`.
- **Sintoma:** RLS habilitada sem policy (default-deny, ok) + sem PK; criadas ad-hoc numa operação de dedupe de calls em 17/05, não existem em nenhuma migration.
- **Impacto:** baixo (default-deny), mas é lixo de schema que polui advisors.
- **Ação proposta:** confirmar que os dados já foram reconciliados e `DROP TABLE` (operação em prod — requer aprovação).

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

