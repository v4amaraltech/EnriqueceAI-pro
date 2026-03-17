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

**On failure:** STOP, fix the SQL draft, re-check before writing the file.

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
- Types regenerated or `TYPES_STALE` documented
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
