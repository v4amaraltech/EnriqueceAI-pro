# Plano de Reconciliação do Drift de Migrations

> Status: **Planejado** (não executado). Autor: @devops (Gage). Data do mapeamento: 2026-06-08.
> Banco de referência: Enriquece AI (`dhkmonctyoaenejemkrt`).

## 1. Diagnóstico (mapa do drift)

O histórico de migrations do repo divergiu do banco de produção porque o projeto
aplica mudanças via **MCP `apply_migration`** (timestamp = hora de aplicação) e via
dashboard, enquanto os arquivos `supabase/migrations/*.sql` usam timestamps
"planejados". Os dois nunca foram mantidos em sincronia. `supabase db push`
**nunca foi o mecanismo de deploy** aqui.

Comparação por **nome** de migration (repo: 204 · tracking: 242 únicos):

| Categoria | Qtd | Significado | Ação |
|---|---:|---|---|
| **Em ambos** | 179 | Aplicada; só o timestamp tracking ≠ arquivo | Benigno (alinhar metadados) |
| **Só no repo** | 25 | Arquivo existe; nome ausente do tracking — mas o **objeto existe em prod** (aplicada via batch/nome diferente) | Verificado: aplicada. Tracking-only |
| **Só no tracking** | 63 | Aplicada em prod via MCP, **sem arquivo no repo** | Repo está **incompleto** — exportar |

**Conclusão-chave:** verificado que os objetos das 25 "só no repo" existem em
produção (`scheduled_activities`, `leads.meeting_held_at/qualified_at/lost_at`,
enums `notification_type.closer_feedback`, `channel_type.system`, etc). Portanto:

- ✅ **Não há schema drift destrutivo** — o schema de prod está completo e correto.
- ⚠️ O drift é de **tracking (metadados)** + **repo incompleto** (faltam 63 migrations
  que só existem no banco).
- 🎯 **O banco de produção é a fonte de verdade.** O repo divergiu.

**Por isso `supabase db push` é PERIGOSO hoje:** ele tentaria (re)aplicar as ~71
migrations locais ausentes do tracking (por timestamp) — a maioria já aplicada —
causando erros de "objeto já existe" e re-execução de backfills não-idempotentes.
**Não usar `db push` até reconciliar.**

## 2. Estratégia recomendada: Baseline (squash)

Dado o desalinhamento severo (timestamps + 63 órfãos + 25 com nome diferente),
alinhar 260+ migrations individualmente é inviável e arriscado. A abordagem padrão
para "histórico bagunçado, banco é fonte de verdade" é **criar um baseline**: um
snapshot do schema atual como ponto de partida limpo, arquivando o histórico antigo.

A operação é **non-destructive ao schema** — mexe só em arquivos do repo e na
tabela de metadados `supabase_migrations.schema_migrations`. Nenhuma DDL é
re-executada sobre produção.

### Alternativa conservadora (se não quiser squash)
Apenas **exportar as 63 migrations órfãs** para o repo (via `db pull`/`pg_dump` por
objeto) para o repo ficar completo, e aceitar que o tracking timestamp-mismatch
permanece (ou seja, continuar aplicando via MCP, nunca `db push`). Menos limpo,
menos risco, mas não destrava `db push`.

## 3. Fases (estratégia baseline)

### Fase 0 — Pré-requisitos e segurança
- [ ] Backup: `pg_dump --schema-only` do banco + `COPY` da tabela `schema_migrations`.
- [ ] CLI autenticado e linkado (`supabase login`, `supabase link --project-ref dhkmonctyoaenejemkrt`). **Requer ação interativa do usuário** (token/senha).
- [ ] Janela de baixo tráfego (prudência; a operação não altera schema, mas é produção multi-tenant).
- [ ] **NUNCA** rodar `supabase db push` durante o processo.

### Fase 1 — Capturar o baseline (read-only do schema)
- [ ] `supabase db pull` (ou `pg_dump --schema-only`) → gera `<ts>_baseline_schema.sql`.
- [ ] Revisar manualmente: tabelas, colunas, enums, funções, RLS, triggers, **pg_cron jobs**, extensions, grants. (db pull pode não capturar crons/roles — conferir.)
- [ ] Garantir que NÃO contém dados nem segredos.

### Fase 2 — Reorganizar o repo
- [ ] Mover as 204 migrations atuais para `supabase/migrations/_archive/` (preserva histórico fora do path ativo).
- [ ] Deixar o baseline como única migration ativa, com timestamp anterior a futuras.
- [ ] Commit: `chore(db): baseline migration history para reconciliar drift`.

### Fase 3 — Reconciliar o tracking
- [ ] Backup já feito (Fase 0). Substituir o conteúdo de `schema_migrations` pela
      entrada única do baseline (truncate controlado + insert, **só metadados**), ou
      `supabase migration repair --status applied <baseline>` + marcar as antigas como reverted.
- [ ] Validar: `supabase migration list` → local e remote alinhados.

### Fase 4 — Validar e estabelecer disciplina
- [ ] `supabase db diff` deve retornar **vazio** (repo == prod).
- [ ] Definir o fluxo dali pra frente (escolher um):
  - **A)** Migrations via arquivo + `db push` (repo = fonte de verdade de deploy).
  - **B)** Continuar via MCP `apply_migration`, mas **sempre** seguido de `supabase db pull` + commit, mantendo o repo sincronizado.
- [ ] Documentar o fluxo escolhido em `CLAUDE.md` / README.

## 4. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| `db pull` não captura pg_cron / roles / grants / extensions | Revisão manual + comparar com `get_advisors` e o catálogo (`cron.job`, `pg_extension`) |
| Mexer em `schema_migrations` confunde o CLI | Backup antes; testar em branch Supabase (`create_branch`) primeiro |
| Produção multi-tenant — zero downtime | Operação só toca metadados + arquivos; schema inalterado |
| Perda do histórico granular | Arquivado em `_archive/`, recuperável; git preserva tudo |
| `db push` acidental antes da reconciliação | Comunicar à equipe; só @devops opera; não automatizar |

## 5. Esforço estimado
- Baseline + reorganização + tracking: **meio dia** de trabalho focado + validação.
- Pré-requisito bloqueante: **autenticação do Supabase CLI** (interativa).
- Recomenda-se **testar primeiro numa branch Supabase** (`create_branch`) antes de tocar produção.
