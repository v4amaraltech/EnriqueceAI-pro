# Plano de Reconciliação do Histórico de Migrations

> **Status:** proposto — 2026-05-30. Execução: @data-engineer (Dara) + @devops (Gage).
> **Pré-requisito de aprovação:** este plano não toca o banco até ser revisado e aprovado.

## 1. Problema

O histórico de migrations do repositório (`supabase/migrations/`) e o registro de produção (`supabase_migrations.schema_migrations` no projeto `dhkmonctyoaenejemkrt`) **bifurcaram** por volta do fim de março/2026.

| Métrica | Valor |
|---|---|
| Nomes únicos no registro remoto | 230 |
| Arquivos no repo local | 197 |
| Só no remoto (ausentes do repo) | ~58 — bloco LDR/decisor/v4sales/RPCs (mar–abr) |
| Só no local (ausentes do registro) | 24 — colunas/enums/RLS/cron (30/03 a 16/05) |
| Coincidem por nome mas timestamp diverge | offset BRT→UTC (~3h) |

### Fato crítico (verificado em 2026-05-30)
**Produção é um superset do repo.** Todos os efeitos de DDL das 24 migrations só-local já estão aplicados em prod (verificado: `cadence_enrollments.org_id`, `calls.transcription*`, `leads.lost_at/qualified_at/meeting_held_at`, tabela `scheduled_activities`, `channel_type='system'`, RLS em `ldr_empresas`, índices de interactions, enum `notification_type` com 20 valores, tabela `whatsapp_instances`).

**Implicação:** o schema efetivo de produção está correto e completo. O que está fora de sincronia é apenas o *histórico versionado*. Nenhuma mudança do repo está "pendente" contra prod → um baseline tirado de prod não perde nada.

### Por que importa
- `supabase db reset` / `db push` a partir do repo **não reproduz prod** e pode tentar re-aplicar/recriar objetos.
- Os testes de integração RLS (`tests/integration/rls-policies.test.ts`) dependem de um Supabase local fiel, hoje impossível de montar do zero pelo repo.
- Onboarding de dev e qualquer ambiente novo (preview/staging) ficam comprometidos.

## 2. Estratégia escolhida: baseline a partir de produção (squash)

Reconciliar 86 migrations divergentes uma a uma é frágil e propenso a erro. Como prod é a fonte da verdade verificada e um superset, a abordagem correta e documentada pela Supabase é **regenerar o histórico local a partir de um dump de prod** e alinhar o registro.

Resultado final: uma migration de baseline única (≈ snapshot do schema de prod) + migrations novas a partir daí. O histórico granular antigo é preservado no git (e em `_archive/`), não no runtime.

## 3. Fases de execução

### Fase 0 — Pré-flight e segurança (NÃO toca o banco)
1. **Backup/checkpoint:** confirmar PITR habilitado no projeto; criar um restore point manual no dashboard antes de qualquer `migration repair`.
2. **Snapshot do registro atual:** `select * from supabase_migrations.schema_migrations order by version` → salvar em `docs/audits/schema_migrations_snapshot_20260530.csv` (trilha de auditoria + rollback).
3. **Verificação de superset (completar):** estender a checagem já feita (colunas/tabelas) para **funções, policies RLS, triggers, grants e cron jobs** — confirmar que cada migration só-local tem efeito presente em prod. Se alguma NÃO estiver → tratar como mudança genuinamente pendente e aplicar/decidir antes do squash.
4. **Branch dedicada:** todo o trabalho em `chore/migration-history-reconciliation` — nunca em `main` direto.

### Fase 1 — Capturar prod como baseline
1. `supabase link --project-ref dhkmonctyoaenejemkrt` (ou usar o que já estiver linkado).
2. Dump do schema:
   - `supabase db dump --linked -f supabase/migrations/20260530120000_baseline_from_prod.sql` (schema `public`).
   - **Atenção a objetos fora de `public`** que o `db dump` padrão pode não cobrir e o `db reset` precisa:
     - **pg_cron jobs** (schema `cron`) — exportar `cron.job` e recriar via `cron.schedule(...)` no baseline ou em migration companheira.
     - **policies de `storage.objects`** (ex.: policy do bucket `avatars`) — garantir no dump ou em companion.
     - **grants customizados** anon/authenticated (os REVOKEs de `get_calls_for_v4sales`, `get_indicacoes_ranking`, etc.) — `pg_dump` de schema captura grants; validar explicitamente.
     - **extensões** (`pg_cron`, `pgcrypto`, etc.) e **roles**.
3. Revisar o baseline gerado: remover `OWNER TO`/linhas específicas do ambiente conforme convenção Supabase.

### Fase 2 — Reorganizar o repo
1. Mover as 197 migrations atuais para `supabase/migrations/_archive_pre_20260530/` (git preserva histórico; `_archive` não é lido pelo CLI).
2. Deixar `supabase/migrations/` com **apenas** o baseline + (se necessário) companions de cron/storage.
3. Manter `supabase/seed.sql`.

### Fase 3 — Alinhar o registro de produção (repair)
> Esta é a única etapa que muda estado no servidor — só o **registro** `schema_migrations`, não o schema. @devops executa.
1. Marcar o baseline como aplicado em prod sem rodá-lo:
   - `supabase migration repair --status applied 20260530120000`
2. Marcar as 230 entradas antigas como revertidas/removidas do tracking conforme o fluxo de squash (`migration repair --status reverted <versions>`), de modo que `migration list` mostre local e remoto idênticos (só o baseline).
3. Validar: `supabase migration list` → local e remoto batem.

### Fase 4 — Verificar reprodutibilidade local
1. `supabase db reset` local → deve construir limpo a partir do baseline + seed, sem erro.
2. Rodar `pnpm exec vitest run tests/integration/rls-policies.test.ts` com o Supabase local (chave real) → deve passar (hoje pula).
3. `supabase db diff --linked` → deve vir **vazio** (baseline == prod). Qualquer diff = corrigir o baseline e repetir.

### Fase 5 — Validar em branch de preview ANTES de prod (mais seguro)
1. Criar uma Supabase branch (preview) a partir de prod.
2. Aplicar o repo reconciliado nela; rodar `db diff` contra prod → vazio.
3. Só depois aplicar o `migration repair` em produção (Fase 3 contra prod).

### Fase 6 — Commit, PR e fechamento
1. Commit na branch, PR, @devops faz merge + push.
2. Atualizar `docs/improvements-backlog.md`: item de drift → RESOLVIDO.
3. Guardar o snapshot da Fase 0 como trilha de auditoria.

## 4. Riscos e mitigações

| Risco | Severidade | Mitigação |
|---|---|---|
| Perda de objeto não capturado pelo dump (cron/storage/grants) | Alta | Fase 1.2 trata explicitamente; Fase 4.3 `db diff` vazio é o gate |
| `migration repair` errado deixa registro inconsistente | Média | Snapshot da Fase 0.2 + PITR; validar em preview (Fase 5) antes de prod |
| Migration só-local genuinamente NÃO aplicada em prod | Baixa (sample = 0 pendentes) | Fase 0.3 verifica as 24 antes do squash |
| Perda de dados | **Nenhuma** | Operação é schema-only; dados de prod intocados; só registro é reparado |
| `db reset` local quebra por dependência de extensão/role | Média | Baseline inclui extensões; testar na Fase 4 antes de tocar prod |

## 5. Divisão de responsabilidades

| Etapa | Responsável |
|---|---|
| Fase 0 (verificação/superset/snapshot) | @dev + @data-engineer |
| Fase 1–2 (dump, baseline, reorg repo) | @data-engineer |
| Fase 3 (`migration repair` em prod) | @devops (exclusivo) |
| Fase 4–5 (verificação local + preview) | @dev + @data-engineer |
| Fase 6 (PR/merge/push) | @devops |

## 6. Estimativa
~Meio dia de trabalho, com a branch de preview (Fase 5) como rede de segurança. Janela de baixo tráfego recomendada para a Fase 3, embora não haja downtime (só o registro muda).

## 7. Definition of Done
- [ ] `supabase migration list` mostra local == remoto (só o baseline + novas).
- [ ] `supabase db reset` local constrói limpo a partir do repo.
- [ ] `supabase db diff --linked` vazio.
- [ ] `tests/integration/rls-policies.test.ts` passa contra o local.
- [ ] cron jobs, storage policies e grants confirmados presentes pós-reset.
- [ ] Backlog atualizado; snapshot de auditoria arquivado.
