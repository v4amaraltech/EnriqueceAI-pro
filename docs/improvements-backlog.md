# Improvements Backlog

Fila de melhorias técnicas (não-bloqueantes) identificadas em varreduras / sessões de manutenção. Cada item tem: contexto, por que importa, ação proposta. Ordenar por impacto/esforço quando for puxar.

---

## DB

### `interactions.lead_id` FK sem `ON DELETE CASCADE`
- **Identificado:** 2026-05-16 durante hard delete do lead Eurofrut.
- **Sintoma:** `DELETE FROM leads WHERE id=...` falha com `23503: violates foreign key constraint "interactions_lead_id_fkey"` enquanto houver interactions referenciando.
- **Workaround atual:** deletar interactions explicitamente antes (`DELETE FROM interactions WHERE lead_id=...; DELETE FROM leads WHERE id=...;`).
- **Impacto:** baixo (hard deletes são raros — soft delete é o padrão), mas todo manager que tentar fazer hard delete via SQL Editor topa.
- **Ação proposta:** decidir entre:
  - `ON DELETE CASCADE` — apaga interactions junto (perde histórico, mas é a intenção quando o lead some)
  - `ON DELETE SET NULL` — mantém interactions mas com `lead_id=NULL` (preserva histórico, mas órfão)
- **Mesma análise vale pra:** `calls.lead_id`, `cadence_enrollments.lead_id`, `scheduled_activities.lead_id`, `notifications.resource_id` (não-FK), `audit_log.resource_id` (não-FK).

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

### `idx_calls_hangup_cause` recém-criado, ainda sem queries
- **Identificado:** 2026-05-16 (criado nesse mesmo dia em `20260516171313_calls_add_connected_answered_at`).
- **Ação proposta:** revisar em 30 dias. Se `pg_stat_user_indexes.idx_scan` continuar zero, drop.

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
