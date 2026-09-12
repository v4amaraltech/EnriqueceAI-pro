# Story: Teste de integração das RPCs de estatística num banco local (e no CI)

## Status
Done

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-11 | @devops (Gage) | Ready for Review → **Done**. PR [#401](https://github.com/v4amaraltech/EnriqueceAI-pro/pull/401) mergeado 12:45 UTC (squash `8ab75674`), no ar 12:51 UTC (`/api/version`); CI e Integração verdes na `main`. **AC5 provado no CI:** commit temporário `e7a41433` (fuso `3 hours`→`2 hours` em `get_interaction_counts`) deixou o job de integração vermelho (5 falhas \| 8 ok, [run 34599145197](https://github.com/v4amaraltech/EnriqueceAI-pro/actions/runs/34599145197)); revertido em `39b63d8c` → verde ([run 34599301020](https://github.com/v4amaraltech/EnriqueceAI-pro/actions/runs/34599301020)); os dois commits sumiram no squash. No PR original o job rodou 13/13 de verdade (nada pulado). **AC6** é provado por este PR de docs: só mexe em `docs/**`, fora dos `paths` do workflow, então o job de integração não deve aparecer nele. |
| 2026-09-11 | @dev (Dex) | InProgress → **Ready for Review**. Correção aplicada em prod com autorização do Vini (versão `20260911111939`, arquivo renomeado; md5 do corpo em prod = arquivo `c04925b1…`; ACL intacta: anon ✗, authenticated/service_role ✓, sem DEFINER). **Mesmo snapshot: função antiga × nova idênticas sem filtro** (3.456 linhas); com filtro de SDR/cadência e Julio, impressões iguais às de antes. typecheck ✅ lint ✅ 2.020 testes ✅ integração 12/12 (local) ✅ build ✅. AC5/AC6 dependem do push (fase @devops). Nada commitado. |
| 2026-09-11 | @dev (Dex) | T4, T5 e T7 feitos; T6 escrito. Teste de integração **12/12** no Postgres local; suíte 2.020 ✅; typecheck/lint/build ✅. O teste **achou um defeito** em `get_conversion_universe` (`for_velocity` = null em vez de false com filtro de SDR e inscrição sem `enrolled_by`) → correção na migration nova `20260911111939_…_for_velocity_false.sql` (**ainda não aplicada em prod**). Nada commitado. |
| 2026-09-11 | @po (Pax) | **Escopo +1 (decisão do Vini):** corrigir o `for_velocity` null→false em `get_conversion_universe` nesta story (1 linha, `CREATE OR REPLACE`, sem efeito na tela). O item OUT "Mudar as funções" passa a ter essa exceção. |
| 2026-09-11 | @po (Pax) | **Revalidação por mudança de escopo → GO → Ready** (nota 8/10). T1 mostrou que o repo não recria o banco do zero; Vini escolheu o **banco de teste enxuto**: Postgres puro + schema mínimo copiado de prod + os 2 arquivos de migration do repo (verbatim), testes como gestor via SQL. Escopo, ACs e tarefas reescritos abaixo; o escopo anterior (Supabase local completo) fica registrado em "Escopo anterior". Sem dependência nova: `psql` (runner/containers) em vez de cliente `pg`. |
| 2026-09-11 | @dev (Dex) | Ready → **InProgress**. T2 e T3 feitos (trava de URL local + referências JS compartilhadas; referência nova da Conversão = função real em prod, md5 4/4). **T1 BLOQUEADO:** as migrations do repo não sobem do zero (2 quebras nas primeiras 108 de 277; prod tem ~330 migrations e várias nunca entraram no repo). Parado para decisão do Vini, como manda a story. Nada commitado. |
| 2026-09-11 | @po (Pax) | `*validate-story-draft`: **GO → Ready** (nota 8/10). Vini escolheu a **opção A**. Correções: gate `@qa` → `@architect` (regra de executor); origem das chaves locais (`supabase status -o env`); job **não obrigatório** na proteção de branch (filtro de caminhos + check obrigatório = PR preso); workflow inclui o próprio arquivo nos caminhos; conferência única da referência nova da Conversão contra prod; T1 também roda o `rls-policies` existente. |
| 2026-09-11 | Vini + Claude | Story criada a partir da dívida TEST-001 dos gates de QA de `conversion-analytics-rpc` e `activity-performance-analytics-rpc`. Aguarda o Vini escolher a opção e a validação do @po. |

## Executor Assignment
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["vitest", "supabase-cli", "github-actions"]
db_executor: "@data-engineer"
ci_executor: "@devops"

## Origem

As telas de Conversão, Atividades e Performance agora dependem de duas funções SQL em prod: `get_conversion_universe` (migration `20260911030704`) e `get_interaction_counts` (`20260911095436`). A paridade com o código antigo foi provada **à mão, contra prod**, na hora de cada entrega. Depois disso:

- **A SQL não roda em nenhum teste automático.** O CI (`.github/workflows/ci.yml`) só roda lint, typecheck, `vitest` e build — **não sobe banco**.
- Os testes atuais usam um PostgREST de mentira (`tests/mocks/postgrest-table.ts`) e uma **referência em JS** do que a SQL faz (`referenceCounts` em `interaction-counts.equivalence.test.ts`). Se alguém mudar a função sem mudar a referência (ou o contrário), **nada avisa**.
- O único teste de integração que existe (`tests/integration/rls-policies.test.ts`) é **sempre pulado no CI** (roda só quando há uma chave de serviço real no ambiente).

**Achado de passagem (risco):** o `rls-policies.test.ts` decide se roda só pelo formato da chave (`SUPABASE_SERVICE_ROLE_KEY` começando com `eyJ`). Numa máquina com a chave de **prod** no ambiente, ele criaria e apagaria usuários (`rls-test-a@test.com`) **em produção**. `tests/helpers/supabase-test-client.ts` usa `SUPABASE_URL` com padrão `127.0.0.1`, mas não impede outro endereço.

**O que já existe e ajuda:**
- Supabase CLI no projeto (`supabase` ^2.76 no `package.json`; `supabase/config.toml` com Postgres 17 e `seed.sql`); Docker instalado na máquina do Vini (parado em 11/set).
- As migrations do repo trazem tudo o que as duas funções usam (conferido em 11/set): `lost_at` (`20260407080000`), `meeting_held_at` (`20260508130000`), `won` em `lead_status` (`20260509120000`), `calendar`/`system` em `channel_type` (`20260327120000`, `20260330110000`), `org_id` em `cadence_enrollments` (`20260331090000`), `leads_org_read` (schema inicial).
- ⚠️ Prod tem migrations aplicadas **fora do repo** (memória do projeto). Ainda não se sabe se as 277 do repo sobem limpas do zero (`supabase db reset`).
- O trigger de novo usuário cria org + membro automaticamente (a menos de `skip_auto_org`), então dá para criar "gestores de teste" pela API de Auth local.

## Story

**As a** time de desenvolvimento,
**I want** que as duas funções de estatística sejam testadas contra um Postgres de verdade a cada PR que mexer nelas,
**so that** uma mudança na SQL (ou nas regras em TS) que altere os números da tela seja pega antes do merge, e não por um gestor.

## Opções (decidido: **A** em 11/set; depois do T1, revisto para **banco de teste enxuto** — ver Scope)

**A — Testes `vitest` de integração com Supabase local + job novo no CI. ✅ ESCOLHIDA**
Um workflow separado sobe o Supabase local (`supabase start`, Docker no runner do GitHub), aplica as migrations (`supabase db reset`), cria 2 orgs com gestores e um conjunto pequeno de dados, e chama as funções **com a sessão do gestor** (RLS valendo). Os resultados são comparados com a **mesma referência JS** que os testes unitários usam (movida para `tests/helpers/`). Roda só quando o PR mexe nos caminhos listados no Scope (item 5).

**B — Testes em SQL (pgTAP, `supabase test db`) + job no CI.**
Asserções direto no banco. Não reaproveita a referência JS nem testa a chamada pelo PostgREST (paginação, `order`, parâmetros omitidos).

**C — Só local, sem CI.**
O teste existe e o dev roda com `supabase start` quando mexer nas funções. Barato, mas depende de lembrar — é o que já falhou com o `rls-policies`.

## Scope (revisado 11/set — banco de teste enxuto)

**Por quê mudou:** no T1, `supabase db reset` quebrou na migration 57 (`20260324200000`) e na 108 (`20260331080000`, tabela `ldr_empresas` criada só em prod); prod tem ~330 migrations e o repo 277. Depender das 277 para testar 2 funções não é viável agora (consertar isso é outra story — ver OUT).

**IN:**
1. **Schema mínimo** `tests/integration/fixtures/statistics-schema.sql`, **copiado de prod** (só leitura, via MCP) no dia da criação, com cabeçalho dizendo a data e as consultas usadas para copiar:
   - papéis `anon`, `authenticated`, `service_role` (se não existirem) e `auth.uid()` lendo `request.jwt.claims` (como no Supabase);
   - enums usados (`lead_status`, `channel_type`, `interaction_type`, `member_role`, `member_status`);
   - tabelas `organizations`, `organization_members`, `leads`, `interactions`, `cadences`, `cadence_enrollments` — só as colunas que as duas funções e as regras de acesso usam;
   - `public.user_org_id()`, `public.is_manager()`, `public.lead_visibility_mode()` com o **mesmo corpo de prod** (`pg_get_functiondef`);
   - RLS ligada e as **políticas de SELECT de prod** dessas tabelas (`pg_policies`); `GRANT SELECT` a `authenticated` como em prod.
2. **O que é testado vem do repo, sem cópia:** o teste aplica o schema mínimo e depois os arquivos `supabase/migrations/20260911030704_get_conversion_universe.sql` e `20260911095436_get_interaction_counts.sql` **como estão** (mudou a migration → o teste pega).
3. **Banco descartável:** o teste cria um banco próprio (`stats_it_<aleatório>`), aplica tudo, roda e apaga no fim — nunca usa o banco de dev local nem prod. Conexão por `STATS_TEST_PG_URL` (superusuário local); **trava**: só roda se o host for `127.0.0.1`/`localhost` (mesma regra de `isLocalSupabaseUrl`).
4. **Execução via `psql`** (sem dependência nova): o teste chama `psql` com as consultas e lê o resultado em JSON. Comando configurável por `STATS_TEST_PSQL` — no CI, o `psql` do runner; **na máquina do dev (sem `psql` no host, conferido 11/set)**, `docker exec -i supabase_db_flux psql`, sem instalar nada. Se o `psql` não servir, **parar e pedir aprovação** para adicionar `pg` como devDependency.
5. **`tests/integration/statistics-rpcs.test.ts`:** 2 orgs, gestores e SDR; dados cobrindo interação sem autor, ex-membro, canais `system`/`calendar`, horário 00h–03h UTC, lead excluído, lead criado antes e tocado no período, won/lost/meeting_held no período, inscrições antigas e do período. Para cada função: resultado = referência JS (`tests/helpers/statistics-references.ts`) sem filtro / com filtro de SDR / com filtro de cadência; isolamento entre orgs; `anon` barrado. As funções são chamadas com `set local role authenticated` + `request.jwt.claims` (como na validação em prod).
6. **Workflow `.github/workflows/integration.yml`** (@devops): serviço `postgres:17`, `psql` do runner, `pnpm exec vitest run tests/integration/statistics-rpcs.test.ts`; `paths`: `supabase/migrations/**`, `src/features/statistics/**`, `tests/**`, `.github/workflows/integration.yml`; **não obrigatório** na proteção da `main`.
7. Já feito e mantido: trava de URL local do `rls-policies.test.ts` (T2) e referências JS compartilhadas (T3).

**OUT:**
- Fazer as 277 migrations subirem do zero / versionar o que só existe em prod → **story própria** (registrar no backlog).
- Rodar o `rls-policies.test.ts` no CI (precisa do Supabase completo → depende da story acima).
- Testar a chamada pelo PostgREST (paginação/ordem/parâmetros omitidos) — já coberta pelos testes com o PostgREST de mentira.
- Mudar as funções ou as regras das telas — **exceção (11/set, decisão do Vini):** correção `for_velocity` null→false em `get_conversion_universe`, achada por este teste.

### Escopo anterior (11/set, substituído)
<details><summary>Supabase local completo (`supabase start` + `db reset`)</summary>


**IN:**
1. **Pré-voo (spike):** subir Supabase local e rodar `supabase db reset` com as 277 migrations. Anotar o que quebra (ex.: migration que depende de objeto criado só em prod). Se quebrar, **parar e mostrar ao Vini** antes de mexer em migrations.
2. **Trava de segurança dos testes de integração:** só rodam se `SUPABASE_URL` for `127.0.0.1`/`localhost` **e** houver a chave; vale para o `rls-policies.test.ts` existente e para os novos. Nunca apontar para prod.
3. **Referência JS compartilhada:** mover a referência de `get_interaction_counts` para `tests/helpers/` (usada pelo teste de equivalência e pelo de integração) e escrever a referência de `get_conversion_universe` a partir da regra da story `conversion-analytics-rpc` (universo, marcadores, inscrições).
4. **`tests/integration/statistics-rpcs.test.ts`:** 2 orgs, gestores via Auth local, dados cobrindo: interação sem autor, ex-membro, canais `system`/`calendar`, horário 00h–03h UTC (dia anterior em Brasília), lead excluído, lead criado antes do período e tocado nele, won/lost/meeting_held no período, inscrições antigas e do período, filtro de SDR e de cadência. Para cada função: resultado = referência JS; **isolamento** (gestor da org A não vê nada da org B); `anon` recebe erro de permissão.
5. **Workflow `.github/workflows/integration.yml`** (@devops): `supabase start` (com `-x` dos serviços que o teste não usa — ex.: `studio`, `imgproxy`, `edge-runtime`, `logflare`, `vector`, `mailpit`; conferir a lista na versão da CLI) → `supabase db reset` → exportar as chaves com `supabase status -o env` (URL da API, anon e service role; `tests/setup.ts` só preenche valores falsos se a variável estiver vazia) → `pnpm exec vitest run tests/integration`.
   - Disparo por `paths`: `supabase/**`, `src/features/statistics/**`, `tests/**`, `.github/workflows/integration.yml`.
   - **Não marcar como check obrigatório** na proteção da `main`: com filtro de caminhos, um check obrigatório que não roda deixa o PR preso em "pendente". Não entra no job atual (não deixa todo PR mais lento).
   - `vitest.config` já inclui `tests/**` → no job normal os testes de integração continuam **pulados** (sem banco), como hoje.

**OUT:**
- Mudar as funções ou as regras das telas.
- Corrigir migrations antigas que não subirem limpas (vira story própria, se o pré-voo mostrar problema).
- Testes de integração de outras telas.


</details>

## Acceptance Criteria
- [ ] AC1 — Dado o banco de teste (schema mínimo + as 2 migrations do repo), quando o teste roda, então `get_interaction_counts` e `get_conversion_universe` devolvem exatamente o que a referência JS calcula para os mesmos dados, sem filtro, com filtro de SDR e com filtro de cadência.
- [ ] AC2 — Dado dois gestores de orgs diferentes, quando cada um chama as funções, então só vê dados da própria org.
- [ ] AC3 — Quando `anon` chama as funções, então recebe erro de permissão (vindo do `REVOKE` da própria migration).
- [ ] AC4 — Os testes de integração não rodam contra host que não seja local (trava da URL do Supabase ✅ feita no T2; mesma regra para `STATS_TEST_PG_URL`).
- [ ] AC5 — Mudar uma das duas migrations de forma que altere o resultado, sem mudar a referência, deixa o job vermelho (provado num commit de teste descartado).
- [ ] AC6 — Um PR que não toca os caminhos do workflow não dispara o job.
- [ ] AC7 — O schema mínimo é rastreável a prod: cabeçalho com data e consultas; corpo de `user_org_id`/`is_manager`/`lead_visibility_mode` e texto das políticas conferidos iguais a prod na criação (md5).

## Tasks
- [x] T1 — Pré-voo: `supabase db reset` local → **bloqueou** (migrations 57 e 108; ver Dev Agent Record). Decisão do Vini: banco de teste enxuto.
- [x] T2 — Trava de URL local em `tests/helpers/supabase-test-client.ts` + `rls-policies.test.ts` (AC4).
- [x] T3 — Referências JS em `tests/helpers/` (interaction counts movida; conversion universe nova, conferida contra prod).
- [x] T4 — Schema mínimo copiado de prod (só leitura) + conferência md5 (AC7).
- [x] T5 — `tests/integration/statistics-rpcs.test.ts` com banco descartável via `psql` (AC1–AC3); rodar local contra o Postgres do container `supabase_db_flux` (banco próprio, não o de dev).
- [ ] T6 — @devops: `.github/workflows/integration.yml` (AC5, AC6) e medir o tempo do job.
- [x] T7 — Registrar no backlog a story "migrations do repo sobem do zero"; typecheck, lint, testes, build.

## Complexity
**M** — sem mudança de produto; schema mínimo, 1 teste de integração, 1 workflow. (T1 já resolvido pela mudança de escopo.)

## Risks
- **Schema mínimo desatualizar em relação a prod** (ex.: mudou uma política de RLS de `leads`): o teste continuaria verde com a regra velha. Mitigação: AC7 (rastreável) + regra na DoD de stories que mexem em RLS/`user_org_id` dessas tabelas: atualizar o schema mínimo no mesmo PR.
- **`psql` indisponível ou frágil no teste:** mitigação: parar e pedir aprovação para `pg` (devDependency).
- **Migrations do repo podem não subir do zero** (prod teve alterações por fora). Mitigação: T1 primeiro, com parada obrigatória.
- **Tempo do CI:** subir o Supabase no runner leva minutos (a medir no T5). Mitigação: workflow separado, só com `paths` relevantes.
- **Instabilidade (Docker no runner, portas):** mitigação: `supabase start` com `--ignore-health-check` só se necessário; re-tentativa única do passo de start.
- **Dados de teste vazando para prod:** mitigado pela trava de URL local (AC4).

## Definição de Pronto
- AC1–AC6 com evidência (log do job verde, execução vermelha provocada no AC5).
- Trava de URL local ativa também no `rls-policies.test.ts`.
- typecheck, lint, testes e build verdes; gate do @qa.
- Nada de push/PR sem pedido explícito do Vini.

## Business Value
Os números de Conversão, Atividades e Performance ficam protegidos por teste automático contra o banco de verdade — uma mudança errada na SQL deixa o PR vermelho em vez de chegar à tela do gestor. De quebra, fecha um risco de um teste que poderia mexer em usuários de prod.

## PO Validation (11/set/2026 — Pax)
| # | Item | Resultado |
|---|---|---|
| 1 | Título claro | ✅ |
| 2 | Descrição completa | ✅ (estado do CI, testes atuais, achado de risco) |
| 3 | AC testáveis | ✅ (AC5 com execução vermelha provocada) |
| 4 | Escopo IN/OUT | ✅ |
| 5 | Dependências | ✅ |
| 6 | Complexidade | ✅ M |
| 7 | Valor de negócio | ✅ |
| 8 | Riscos | ✅ (+ check obrigatório com filtro de caminhos) |
| 9 | Definição de pronto | ✅ |
| 10 | Alinhamento | ⚠️ sem epic — fecha a dívida TEST-001 de dois gates de QA |

**Decisão: GO** — nota 8/10, confiança Média (depende do T1: migrations fora do repo). Executor @dev (+ @data-engineer no T1, @devops no T5), gate @architect ✅. CodeRabbit: N/A. Conferido no repo: `vitest.config` inclui `tests/**`; CLI tem `start -x` e `status -o env`; trigger cria gestor ativo; só existe `ci.yml` em `.github/workflows/`.

## PO Revalidation (11/set/2026 — Pax, mudança de escopo)
**GO → Ready** — nota 8/10, confiança Média-Alta (sem o risco das 277 migrations; resta o risco de desatualizar o schema mínimo, coberto por AC7 + regra de DoD). Sem dependência nova. Executor @dev (+ @devops no T6), gate @architect.

## Dependencies
- `conversion-analytics-rpc` (Done) e `activity-performance-analytics-rpc` (Done) — funções e referências JS.
- Docker disponível no runner `ubuntu-latest` do GitHub Actions (padrão) e na máquina do dev.

## Dev Agent Record

### Agent Model Used
Claude Opus 5 (@dev Dex)

### Debug Log / Decisões
- **T2 (trava):** `shouldRunIntegration()` em `tests/helpers/supabase-test-client.ts` — só roda com `SUPABASE_URL` em 127.0.0.1/localhost/::1 **e** chave real (não a falsa `test-service-role-key` do `tests/setup.ts`); não depende do formato da chave (a CLI local nova usa `sb_secret_…`, não JWT). `createAdminClient`/`createAnonClient` recusam URL não local (lançam erro). `rls-policies.test.ts` passa a usar a trava. 4 testes da trava (AC4), incluindo URL de prod com chave válida e `localhost.evil.com`.
- **T3 (referências):** `tests/helpers/statistics-references.ts` — `interactionCountsReference` (movida do teste de equivalência; retrato continua passando) e `conversionUniverseReference` (nova). Conferência única da nova contra prod (só leitura): md5 por lead (status, created_by, won_at, 3 marcadores, inscrições em ordem com `for_velocity`) — **função real = referência em 4/4 recortes** (V4 30d 3.456 · 30d 2 SDRs 278 · 30d Recovery 2.619 · Julio 30d 601).
- **T1 (pré-voo) — BLOQUEADO:** Docker ligado com autorização do Vini; Supabase local subiu em 16 s (`-x` de 10 serviços; o stack `flux` já existia com banco velho: 38 migrations, 20 leads, 1 usuário — reset autorizado). `supabase db reset` com as 277 migrations do repo:
  1. **Quebra 1 — migration 57** `20260324200000_fix_threecplus_connections_columns.sql`: renomeia `extension`→`login`, mas a migration que cria a tabela (`20260324170000`) foi editada depois (`99dd179f`, 24/mar) e já nasce com `login`/`domain`. Do zero, a coluna não existe.
  2. **Quebra 2 — migration 108** `20260331080000_enable_rls_ldr_tables.sql` (testado numa **cópia** no rascunho com a quebra 1 corrigida; repo intacto): liga RLS em `ldr_empresas`, tabela **criada direto em prod** e nunca versionada. Outras 6 migrations do repo citam tabelas `ldr_*`.
  - Amostra de 12 migrations que existem em prod (subsistema LDR, limpezas de 30/ago): **0 no repo**. Prod: ~330 registradas; repo: 277. Conclusão: **o repo não reproduz o banco de prod do zero**; o número de quebras depois da 108 é desconhecido.
  - Banco local ficou migrado até a 107 (só local). Docker e Supabase local continuam ligados.

### File List (sem commit)
- `tests/helpers/supabase-test-client.ts` — trava de URL local
- `tests/helpers/supabase-test-client.test.ts` (novo, 4 testes)
- `tests/helpers/statistics-references.ts` (novo)
- `tests/integration/rls-policies.test.ts` — usa a trava
- `src/features/statistics/services/interaction-counts.equivalence.test.ts` — usa a referência compartilhada
- `tests/mocks/postgrest-table.ts` — tipo do handler de RPC
- `tests/integration/fixtures/statistics-schema.sql` (novo) — schema mínimo copiado de prod
- `tests/integration/statistics-rpcs.test.ts` (novo, 12 testes)
- `supabase/migrations/20260911111939_get_conversion_universe_for_velocity_false.sql` (novo — **já aplicada em prod** 11/set)
- `.github/workflows/integration.yml` (novo)
- `docs/improvements-backlog.md` — atualização do item "Drift de migrations"

### Debug Log — T4 a T7 (11/set)
- **T4 (schema mínimo):** copiado de prod via MCP (só leitura): valores/ordem dos 5 enums, colunas usadas das 6 tabelas, `pg_get_functiondef` de `user_org_id`/`is_manager`/`lead_visibility_mode`/`auth.uid`, as 6 políticas de SELECT. Aplicado num banco descartável do Postgres local + as migrations das funções: sobe limpo; **md5 das 3 funções e das 6 políticas = prod**; `anon` sem EXECUTE nas duas funções.
- **T5 (teste):** `tests/integration/statistics-rpcs.test.ts` — banco `stats_it_<aleatório>` criado/apagado por execução; aplica o schema mínimo + **todas as migrations do repo que definem as duas funções** (descoberta pelo conteúdo, em ordem). 2 orgs, gestor/SDR/ex-membro, 575 interações, 75 leads, 105 inscrições, cadência excluída, horários 00–03h UTC. Casos: 4× `get_interaction_counts` e 4× `get_conversion_universe` vs referência JS; isolamento org B; `anon` barrado; md5 do schema = prod (AC7). Local: `STATS_TEST_PG_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres STATS_TEST_PSQL='docker exec -i supabase_db_flux psql' pnpm exec vitest run tests/integration/statistics-rpcs.test.ts` (~3 s).
- **Defeito achado pelo teste:** `get_conversion_universe` com filtro de SDR devolvia `for_velocity: null` para inscrição sem `enrolled_by` (`NULL = ANY(...)`). Sem efeito na tela (TS filtra por verdadeiro). Correção `coalesce(…, false)` em `20260911111939_get_conversion_universe_for_velocity_false.sql`; sem ela o caso "filtro de SDR" fica vermelho (prova local de que o teste pega regressão da SQL).
- **T6 (workflow):** `.github/workflows/integration.yml` — serviço `postgres:17`, `psql` do runner, `paths` da story, não obrigatório. AC5/AC6 dependem de push (fase @devops).
- **T7:** item existente "Drift de migrations local ↔ produção" em `docs/improvements-backlog.md` atualizado com as quebras de hoje (não criei item duplicado; já há 2 planos de baseline).

### Debug Log — correção em prod e fechamento (11/set)
- Antes de aplicar: em prod, 16 de 7.526 inscrições da V4 não têm `enrolled_by`; nenhum recorte medido (365 dias com filtro de todos os membros) produzia `null` → defeito real, raro, **sem efeito histórico na tela**.
- Aplicada `20260911111939_get_conversion_universe_for_velocity_false` (MCP); md5 do corpo em prod = arquivo; permissões intactas.
- Conferência: impressões digitais dos 4 recortes da Conversão — `v4_30d_sdrs`, `v4_30d_recovery` e `julio_30d` idênticas às de antes; `v4_30d` mudou por **dado vivo** (leads/inscrições alterados entre as medições). Prova: função antiga recriada em `pg_temp` × função nova, **na mesma transação** → `0d70b5fc…` nas duas.
- `pnpm gen:types`: a correção não muda a assinatura; o diff que apareceu (`goals_per_user.calls_target`/`calls_connected_target`) é de **outra mudança aplicada em prod por outra frente** — desfeito aqui para não misturar PRs (quem aplicou deve regenerar no PR dela).
- Pendente p/ @devops: AC5 (vermelho provocado no CI) e AC6 (filtro de caminhos) — exigem push.
- Docker e Supabase local continuam ligados (`supabase stop` para desligar).

## QA Results

### Review Date: 2026-09-11

### Reviewed By: Quinn (Test Architect)

### Code Quality Assessment
Infra de teste enxuta e bem isolada: banco descartável por execução, trava de host local, `psql` via argv (sem shell), schema mínimo rastreável a prod com md5 conferido no próprio teste, migrations descobertas pelo conteúdo (uma correção futura entra sozinha). O teste já provou valor achando o `for_velocity` null.

### Verificação independente (feita nesta revisão)
- **Teste de mutação da SQL** (mudança temporária nas migrations, restauradas pelo git): 10 mutações — dia de Brasília −2h, sem exclusão de canais, sem filtro de cadência (contagens e marcadores), `count` sem `DISTINCT`, leads excluídos no universo, cadências excluídas no vínculo, e tirar cada uma das 4 regras de entrada no universo (created/won/lost/meeting_held).
  - **Achado:** as 4 regras de entrada no universo **passavam despercebidas** (o teste seguia 12/12): nos dados aleatórios quase todo lead tem interação no período, então nenhuma regra era o único motivo de entrada.
  - **Corrigido nesta revisão (active refactoring):** 6 leads "de borda" (cada um entra por um único motivo; 2 não entram) + teste explícito. Depois disso: **10/10 mutações pegas** (2–5 testes vermelhos cada); original 13/13.
- **Correção em prod sem drift:** md5 do corpo em prod = arquivo `20260911111939_…` (`c04925b1…`); `prosecdef=false`; `anon` sem EXECUTE.
- **Workflow:** YAML válido (1 job, 4 caminhos); no job normal do CI os testes de integração ficam pulados (sem `STATS_TEST_PG_URL`).
- typecheck ✅ · lint ✅ · testes de `tests/` + estatísticas ✅.

### Rastreabilidade (AC → evidência)
| AC | Evidência |
|---|---|
| AC1 | 4 casos por função vs referência JS (sem filtro / SDR / cadência / cadência excluída) + teste de mutação |
| AC2 | "isolamento: o gestor da org B só vê a org B" |
| AC3 | "anon não executa as funções" |
| AC4 | `supabase-test-client.test.ts` (4 testes) + gate `isLocalSupabaseUrl` no teste novo |
| AC5 | Provado **localmente** por mutação (10/10) e pelo defeito real achado; falta ver o job vermelho **no CI** (depende de push) |
| AC6 | Declarativo (`paths` no workflow); falta observar no GitHub (depende de push) |
| AC7 | "schema mínimo continua igual a prod (md5…)" |

### Improvements Checklist
- [x] TEST-GAP-001 (medium → resolvido na revisão) — regras de entrada do universo sem cobertura; leads de borda adicionados.
- [ ] REQ-001 (low) — AC5/AC6 no CI: @devops mostra um run vermelho provocado (commit de teste descartado) e um PR fora dos caminhos sem o job.
- [ ] DRIFT-001 (low) — schema mínimo pode desatualizar se a RLS dessas tabelas mudar em prod; o teste de md5 só compara com o snapshot de 11/set. Regra de DoD registrada na story.
- [ ] MNT-001 (info) — `rls-policies.test.ts` segue sem rodar no CI (depende do drift de migrations — backlog).
- [ ] DOC-001 (low) — CodeRabbit não rodou (CLI sem login).

### Security Review
PASS — trava contra host não local (fecha o risco de o teste de RLS mexer em usuários de prod); `psql` sem shell; dados de teste só em banco descartável; correção em prod mantém ACL.

### Performance Considerations
PASS — teste de integração ~3 s local; job novo só nos caminhos relevantes e fora do caminho crítico (não obrigatório).

### Files Modified During Review
- `tests/integration/statistics-rpcs.test.ts` — leads de borda + teste "cada regra de entrada conta sozinha" (**não commitado — QA não commita; @dev deve commitar junto**).
- Esta seção e `docs/qa/gates/statistics-rpc-integration-tests.yml`.

### Gate Status
Gate: PASS → docs/qa/gates/statistics-rpc-integration-tests.yml

### Recommended Status
✓ Ready for Done — depois de REQ-001 (AC5/AC6 observados no CI). Decisão final do Vini.
