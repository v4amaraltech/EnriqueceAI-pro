# Dev Checkpoints — Enforcement Rule

> This rule is loaded automatically in every Claude Code session.
> It enforces 3 mandatory checkpoints during story development to prevent schema/migration bugs.

---

## Canonical Schema Conventions (Quick Reference)

### Function Names — CRITICAL

| What | Correct Name | WRONG Names (NEVER use) |
|------|-------------|------------------------|
| Trigger function for `updated_at` | `update_updated_at()` | ~~`set_updated_at()`~~, ~~`handle_updated_at()`~~, ~~`trigger_updated_at()`~~ |
| Trigger name on tables | `set_updated_at` | ~~`trigger_updated_at`~~, ~~`update_timestamp`~~ |
| Get user's org | `public.user_org_id()` | ~~inline subquery~~ |
| Check if manager | `public.is_manager()` | ~~inline role check~~ |

### Enum Values (Complete Reference)

| Enum Type | Valid Values |
|-----------|-------------|
| `member_role` | `'manager'`, `'sdr'` |
| `member_status` | `'invited'`, `'active'`, `'suspended'`, `'removed'` |
| `lead_status` | `'new'`, `'contacted'`, `'qualified'`, `'unqualified'`, `'archived'` |
| `enrichment_status` | `'pending'`, `'enriching'`, `'enriched'`, `'enrichment_failed'`, `'not_found'` |
| `import_status` | `'processing'`, `'completed'`, `'failed'` |
| `cadence_status` | `'draft'`, `'active'`, `'paused'`, `'archived'` |
| `enrollment_status` | `'active'`, `'paused'`, `'completed'`, `'replied'`, `'bounced'`, `'unsubscribed'` |
| `channel_type` | `'email'`, `'whatsapp'`, `'phone'`, `'linkedin'`, `'research'`, `'crm'` |
| `interaction_type` | `'sent'`, `'delivered'`, `'opened'`, `'clicked'`, `'replied'`, `'bounced'`, `'failed'`, `'meeting_scheduled'`, `'crm_synced'`, `'crm_deal_created'` |
| `crm_type` | `'hubspot'`, `'pipedrive'`, `'rdstation'` |
| `connection_status` | `'connected'`, `'disconnected'`, `'error'`, `'syncing'` |
| `subscription_status` | `'active'`, `'past_due'`, `'canceled'`, `'trialing'` |
| `sync_direction` | `'push'`, `'pull'` |

> **When a migration adds a new enum or new values to an existing enum**, update this table.

### Table Design Pattern

```sql
CREATE TABLE {plural_table_name} (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  -- ... domain columns ...
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE {plural_table_name} ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON {plural_table_name}
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### Migration File Format

- Filename: `YYYYMMDDHHMMSS_{description}.sql` (14-digit unique timestamp)
- Wrapped in `BEGIN;` / `COMMIT;`
- Uses `IF NOT EXISTS` / `CREATE OR REPLACE` for idempotency

---

## 3 Mandatory Checkpoints

### Checkpoint 1: Schema/Migration Pre-Flight

**When:** BEFORE writing any SQL migration file (only when story has DB tasks)
**What:** Execute `.aios-core/product/checklists/schema-migration-preflight-checklist.md`
**Key checks:**
- Migration timestamp is unique (14 digits, no conflicts)
- Enum values cross-referenced against table above
- Trigger function is `update_updated_at()`, trigger name is `set_updated_at`
- RLS uses `public.user_org_id()` and `public.is_manager()`
- Table has standard columns (id, org_id, created_at, updated_at)
- **Todo `DROP` + `CREATE` de função `SECURITY DEFINER` traz `REVOKE ... FROM anon, authenticated, PUBLIC` no mesmo arquivo** (ver seção abaixo)

**On failure:** STOP, fix the SQL draft, re-check before writing the file.

#### DROP + CREATE de SECURITY DEFINER — regra obrigatória

O `DROP` **descarta a ACL da função**. O `CREATE` seguinte a recria com o default
privilege do schema `public`, que concede **EXECUTE a `PUBLIC`** — ou seja, a `anon` e
`authenticated`. Um `REVOKE` feito numa migration antiga **NÃO sobrevive**: ele agiu
sobre o objeto, não sobre o nome. Foi assim que `20260909184311` reabriu
`fetch_inactive_enrollment_candidates` (varre `leads`/`cadence_enrollments` de todas as
orgs) para qualquer usuário logado.

Atenção: acrescentar um parâmetro com `DEFAULT` **muda a assinatura**. `CREATE OR REPLACE`
nesse caso cria uma **sobrecarga** e deixa a função antiga no ar, ainda exposta — use
`DROP` + `CREATE` e trate a ACL.

Padrão obrigatório, no mesmo arquivo, logo após o `CREATE`:

```sql
DROP FUNCTION IF EXISTS public.minha_funcao(uuid);
CREATE FUNCTION public.minha_funcao(p_org_id uuid, p_api_token text DEFAULT NULL)
  RETURNS ... LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ ... $function$;

REVOKE EXECUTE ON FUNCTION public.minha_funcao(uuid, text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.minha_funcao(uuid, text) TO service_role;  -- só quem precisa
```

- **Antes de revogar**, cheque `pg_policies`: helper usado dentro de policy RLS
  (`user_org_id()`, `is_manager()`, `lead_visibility_mode()`) **nunca** perde EXECUTE — nem
  de `authenticator`/`supabase_realtime_admin`, sob pena de derrubar o Realtime.
- **Antes de revogar**, cheque o tráfego real por role nos logs do PostgREST. Uma função
  que parece órfã pode estar em uso por `anon` (foi o caso das 3 RPCs do Sales Hub).
- Se a função pode mesmo ser chamada pelo cliente, registre-a em
  `supabase/security/definer-exec-allowlist.json` com a justificativa.
- **Depois de aplicar**, releia `proacl` — `{"success": true}` do MCP não prova que a
  permissão ficou correta. Script pronto: `scripts/audits/definer-exec-audit.sql`.

O CI cobre o lado do repositório em `tests/security/definer-acl.test.ts`.
Contexto completo: `docs/stories/security-definer-execute-audit.story.md`.

### Checkpoint 2: Post-Implementation QA

**When:** AFTER all tasks [x], BEFORE CodeRabbit self-healing
**What:** Execute `.aios-core/product/checklists/post-implementation-qa-checklist.md`
**Key checks:**
- TypeScript enums match PostgreSQL enums
- Migration timestamps unique, dependencies ordered
- `pnpm typecheck && pnpm lint && pnpm test:run && pnpm build`
- No regressions, no security issues

**On failure:** Fix issues immediately, re-run failed checks.

### Checkpoint 3: Deploy Verification

**When:** AFTER CodeRabbit, BEFORE story-dod-checklist
**What:** Execute `.aios-core/product/checklists/deploy-verification-checklist.md`
**Key checks:**
- Migrations committed, git state clean
- Types regenerated with `pnpm gen:types` (mandatory when the schema changed; `TYPES_STALE` is no longer accepted)
- `pnpm build` passes
- File List and Change Log complete

**On failure:** Fix and re-verify before proceeding to DoD.

---

## Activation Rule

- **Checkpoint 1** only activates when the story has tasks involving database changes (new migration, alter table, new enum, etc.)
- **Checkpoints 2 and 3** activate for ALL stories after implementation

---

## Bug Prevention Map

| Past Bug | Prevented By |
|----------|-------------|
| Wrong function name (`set_updated_at()` instead of `update_updated_at()`) | Checkpoint 1 — Function Names table |
| Non-existent enum value (`'owner'` not in `member_role`) | Checkpoint 1 — Enum Reference table |
| Duplicate migration timestamps (14 files with same prefix) | Checkpoint 1 — Unique timestamp check |
| Migrations not committed/pushed | Checkpoint 3 — Migration status |
| Stale TypeScript types after schema changes | Checkpoint 2 + 3 — Type sync checks |
| Inline RLS subquery instead of helper function | Checkpoint 1 — RLS policies |
| Table missing `updated_at` trigger | Checkpoint 1 — Trigger check |
