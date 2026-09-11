# Story: Teste de integração das RPCs de estatística num banco local (e no CI)

## Status
Ready

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
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

## Opções (decidido: **A**, pelo Vini em 11/set)

**A — Testes `vitest` de integração com Supabase local + job novo no CI. ✅ ESCOLHIDA**
Um workflow separado sobe o Supabase local (`supabase start`, Docker no runner do GitHub), aplica as migrations (`supabase db reset`), cria 2 orgs com gestores e um conjunto pequeno de dados, e chama as funções **com a sessão do gestor** (RLS valendo). Os resultados são comparados com a **mesma referência JS** que os testes unitários usam (movida para `tests/helpers/`). Roda só quando o PR mexe nos caminhos listados no Scope (item 5).

**B — Testes em SQL (pgTAP, `supabase test db`) + job no CI.**
Asserções direto no banco. Não reaproveita a referência JS nem testa a chamada pelo PostgREST (paginação, `order`, parâmetros omitidos).

**C — Só local, sem CI.**
O teste existe e o dev roda com `supabase start` quando mexer nas funções. Barato, mas depende de lembrar — é o que já falhou com o `rls-policies`.

## Scope

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

## Acceptance Criteria
- [ ] AC1 — Dado um Supabase local com as migrations do repo, quando o teste roda, então `get_interaction_counts` e `get_conversion_universe` devolvem exatamente o que a referência JS calcula para os mesmos dados, em pelo menos: sem filtro, filtro de SDR, filtro de cadência.
- [ ] AC2 — Dado dois gestores de orgs diferentes, quando cada um chama as funções, então só vê dados da própria org.
- [ ] AC3 — Quando `anon` chama as funções, então recebe erro de permissão.
- [ ] AC4 — Os testes de integração **não rodam** se `SUPABASE_URL` não for local, mesmo com uma chave válida no ambiente (teste da própria trava).
- [ ] AC5 — Num PR que muda uma das duas migrations, o job de integração roda e fica vermelho se a função mudar o resultado sem a referência mudar junto (provado num PR/commit de teste descartado).
- [ ] AC6 — Um PR que não toca `supabase/`, `src/features/statistics/` nem `tests/` não dispara o job.

## Tasks
- [ ] T1 — Pré-voo: `npx supabase start` + `supabase db reset` local; anotar tempo e o que quebra; rodar o `rls-policies.test.ts` existente contra o banco local (nunca rodou no CI — pode estar quebrado). **Parar e reportar** se alguma migration não subir. Conferido 11/set: o trigger de novo usuário cria a org com o usuário como `manager` `active` (`20260509175233`).
- [ ] T2 — Trava de URL local em `tests/helpers/supabase-test-client.ts` + ajuste do `rls-policies.test.ts` (AC4).
- [ ] T3 — Referências JS em `tests/helpers/` (interaction counts movida; conversion universe nova) + teste de equivalência usando a referência movida. A referência **nova** da Conversão (o código antigo já saiu) é conferida **uma vez contra prod**, só leitura, pelo mesmo método de md5 da story anterior, antes de virar especificação.
- [ ] T4 — `tests/integration/statistics-rpcs.test.ts` (AC1–AC3).
- [ ] T5 — @devops: `.github/workflows/integration.yml` com filtro de caminhos; medir tempo do job (AC5, AC6).
- [ ] T6 — typecheck, lint, testes, build.

## Complexity
**M** — sem mudança de produto; 1 workflow novo, 1 arquivo de teste de integração, helpers, ajuste da trava. O risco maior está no T1 (migrations fora do repo).

## Risks
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

## Dependencies
- `conversion-analytics-rpc` (Done) e `activity-performance-analytics-rpc` (Done) — funções e referências JS.
- Docker disponível no runner `ubuntu-latest` do GitHub Actions (padrão) e na máquina do dev.
