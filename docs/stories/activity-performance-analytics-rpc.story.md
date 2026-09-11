# Story: Atividades e Performance calculadas a partir de contagens agrupadas no banco (RPC)

## Status
Ready for Review

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-11 | @dev (Dex) | InProgress → **Ready for Review**. Migration aplicada em prod com autorização do Vini (versão `20260911095436`, arquivo renomeado; md5 do corpo em prod = arquivo); ACL conferida (anon negado na chamada real); função real como gestor = impressão digital esperada (Atividades V4 30d `a9ac0c54…`, 479 linhas), 30d 70 ms / 90d 158 ms; `pnpm gen:types` (+ só a função); typecheck ✅ lint ✅ 1.998 testes ✅ build ✅. CodeRabbit não rodou (CLI sem login). Nada commitado. |
| 2026-09-11 | @dev (Dex) | Ready → **InProgress**. T1–T4 feitas; T5 parcial (paridade provada; falta aplicar a migration — aguarda autorização do Vini — e `gen:types`). typecheck ✅ lint ✅ 1.998 testes ✅. Nada commitado. |
| 2026-09-11 | @po (Pax) | `*validate-story-draft`: **GO → Ready** (nota 8,5/10). Vini escolheu a **opção A**. Correções aplicadas: decisão registrada; contrato de retorno exato (tipo de linha, colunas, ordem única para paginar); formato de `last_at`; T3 detalhado (datas fixas, relógio e nomes de SDR fora da comparação); nota das 2 execuções por página. |
| 2026-09-11 | Vini + Claude | Story criada, próxima da fila da avaliação "paginar × agregar" (`statistics-fetch-all-rows`), no molde da `conversion-analytics-rpc` (Done, PR #385). Aguarda o Vini escolher a opção (A, B ou C) e a validação do @po. |

## Executor Assignment
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["vitest", "typecheck", "lint"]
db_executor: "@data-engineer"

## Origem

Desde `statistics-fetch-all-rows` (no ar em 11/set, `54274a2`), as telas **Estatísticas › Atividades** e **Estatísticas › Performance** mostram o número certo, mas **baixam todas as interações do período** e contam no servidor Next. Medido em prod (V4 Amaral, 11/set/2026, como gestor, só leitura):

| | 30 dias | 90 dias | 365 dias |
|---|---:|---:|---:|
| Interações lidas (Performance: canal ≠ `system`) | 13.235 | 35.459 | 50.345 |
| Linhas agrupadas por SDR × canal × tipo × dia (+1 linha por SDR) | **533** | **1.356** | **2.220** |
| Tempo da consulta agrupada (com a RLS valendo) | 245 ms | 426 ms | 603 ms |

- A org só tem interações desde **26/mar/2026** e já soma ~24 mil/mês → o volume por período ainda vai crescer muito. Um período livre (`dateRange` não tem limite) acima de ~8 meses passa do teto de segurança do `fetchAllRows` (200 mil) e o número volta a ficar **parcial**, só com aviso no log.
- **Tudo o que as duas telas fazem com as interações é contar:** por SDR, canal, tipo e dia no fuso de Brasília, mais "leads diferentes por SDR" (Atividades) e "última atividade por SDR" (Performance). Isso cabe numa tabela de contagens 26× menor.
- A leitura de `leads` nas duas telas fica como está (limitada ao total de leads da org, ~6,3 mil).

## Story

**As a** gestor,
**I want** que Atividades e Performance abram rápido e com o número completo para qualquer período,
**so that** eu possa comparar trimestres e semestres sem número cortado nem espera.

## Regra atual (tem que continuar igual)

**Atividades** (`activity-analytics.service.ts`) — interações da org no período com `channel NOT IN ('system','calendar')`; filtro de SDR opcional por `performed_by`:
- KPIs: total; "hoje" (desde a meia-noite de Brasília); média por dia útil (seg–sex, até agora).
- Volume por canal; por tipo (com %); tendência por dia (dia de Brasília = `created_at − 3h`).
- Conclusão por canal: `type ∈ {sent, delivered, opened, clicked, replied, meeting_scheduled}` ÷ total do canal.
- Por SDR: total; concluídas (`sent`, `delivered`, `meeting_scheduled`); **leads diferentes tocados**; respostas (`replied`); ligações (`channel = phone`); concluídas/total por canal.
- ⚠️ Interações **sem autor** (`performed_by` nulo — 2.352 em 90 dias na V4) entram nos totais, canais, tipos e tendência, mas não na tabela por SDR.

**Performance** (`performance-analytics.service.ts`) — interações da org no período com `channel <> 'system'`, `performed_by ∈` (SDRs filtrados ou todos os membros ativos); filtro de cadência opcional (`cadence_id`):
- Total de atividades; por SDR: atividades e reuniões (`meeting_scheduled`).
- Tendência diária dos 5 SDRs com mais atividade (dia de Brasília).
- Controle diário por SDR: concluídas (`sent`, `delivered`, `meeting_scheduled`), pendentes (= total − concluídas), ligações (`phone`), e-mails (`email`), pesquisa (`channel = research` ou `type = research`), **última atividade** (maior `created_at`).

## Opções (decidido: **A**, pelo Vini em 11/set)

**A — Um RPC de contagens agrupadas, usado pelas duas telas. ✅ ESCOLHIDA**
Um RPC `get_interaction_counts` devolve contagens por (autor, canal, tipo, dia de Brasília) + 1 linha por SDR com `distinct_leads` (contrato exato no Scope). As funções de cálculo em TS continuam, lendo contagens em vez de linhas soltas. Um SQL só para manter; ~1,4 mil linhas em 90 dias.

**B — Dois RPCs, cada um devolvendo os números prontos da sua tela.**
Tráfego mínimo, mas a regra das duas telas passa para SQL e fica em dois lugares até os testes de TS serem reescritos. Mais SQL para manter.

**C — Não fazer RPC agora; limitar o período livre (ex.: 6 meses).**
Zero risco de número diferente, mas não resolve o peso (35 mil linhas em 90 dias) e muda o que o gestor pode filtrar.

## Scope

**IN:**
1. Migration com `public.get_interaction_counts(...)`: `SECURITY INVOKER`, `STABLE`, `SET search_path = ''`, org via `(SELECT public.user_org_id())` (lição da Conversão: não ligar a org linha a linha); `GRANT EXECUTE` a `authenticated`/`service_role`, `REVOKE` de `PUBLIC`/`anon`.
   - **Contrato:** `get_interaction_counts(p_start timestamptz, p_end timestamptz, p_exclude_channels public.channel_type[], p_user_ids uuid[] DEFAULT NULL, p_cadence_id uuid DEFAULT NULL)` → `row_kind text` (`'cell'` ou `'performer'`), `performed_by uuid` (pode ser nulo = sem autor), `channel public.channel_type`, `type public.interaction_type`, `day_brt date`, `n bigint`, `distinct_leads bigint`, `last_at timestamptz`.
     - `'cell'`: 1 linha por (autor, canal, tipo, dia de Brasília) com `n` e `last_at`; `distinct_leads` nulo.
     - `'performer'`: 1 linha por autor com `distinct_leads = count(DISTINCT lead_id)` e `last_at`; `channel/type/day_brt/n` nulos.
     - Filtro de canal: `channel <> ALL (p_exclude_channels)` (Atividades passa `{system,calendar}`; Performance passa `{system}`). `channel` é `NOT NULL` (conferido 11/set).
     - Ordem para paginar sem repetir/pular: `row_kind, performed_by NULLS FIRST, channel, type, day_brt` (chave única).
     - `last_at` volta no mesmo formato que o PostgREST já devolvia para `created_at` (timestamptz) → "última atividade" igual.
2. `activity-analytics.service.ts` e `performance-analytics.service.ts` leem as contagens pelo RPC (paginado por segurança, ordem determinística); as leituras de `leads` continuam como estão.
3. Dia de Brasília calculado **igual ao TS atual** (`created_at − 3h`, sem regra de horário de verão).
4. `pnpm gen:types` no mesmo PR.

**OUT:**
- Mudar qualquer regra das telas (os números têm que bater com os de hoje).
- Cadências (engajamento), E-mail, Passos, Ligações — ficam paginadas.
- Limitar o período livre.

## Acceptance Criteria
- [ ] AC1 — Para 7, 30 e 90 dias, com e sem filtro de SDR (e com filtro de cadência na Performance), as duas telas devolvem **exatamente** os mesmos números do código atual (commit `54274a2`): KPIs, canais, tipos, tendência diária, tabelas por SDR, controle diário (incluindo "última atividade"). Conferido em prod na V4 Amaral e numa org pequena.
- [ ] AC2 — Nenhuma das duas telas lê a tabela `interactions` diretamente.
- [ ] AC3 — Interações sem autor continuam nos totais de Atividades e fora das tabelas por SDR.
- [ ] AC4 — Função `SECURITY INVOKER`; `anon` sem `EXECUTE` (conferir com `has_function_privilege()`).
- [ ] AC5 — 90 dias como gestor da V4 Amaral < 1 s (hoje ~0,4 s medido); 1 ano sem aviso de truncamento.
- [ ] AC6 — `types.ts` regenerado no mesmo PR.

## Tasks
- [x] T1 — @data-engineer: Checkpoint 1 (pré-voo de migration) + desenho da SQL (grouping sets ou união das duas agregações).
- [x] T2 — Medir a função no formato final como gestor (função em `pg_temp` dentro de transação desfeita, `set local role authenticated` + `request.jwt.claims`).
- [x] T3 — Guardar a saída atual das duas telas (service role, prod) para o AC1, antes de mexer no código: **datas fixas no passado** + **um recorte que inclui hoje rodado no mesmo minuto dos dois lados** ("hoje" e média por dia útil dependem do relógio); `buildMemberInfoMap` mockado para `user_id → user_id` nos dois lados (os nomes vêm do Auth e não mudam o número, mas a tendência da Performance agrupa pelo nome).
- [x] T4 — Adaptar os dois services + testes (fake PostgREST com `.rpc()`, já existe em `tests/mocks/postgrest-table.ts`).
- [x] T5 — Comparação antes × depois (AC1); aplicar a migration em prod **só com autorização do Vini**; `pnpm gen:types`, typecheck, lint, testes, build.

## Complexity
**M** — 1 função só de leitura (sem tabela), 2 services, testes. Sem mudança de tela.

## Risks
- **Número diferente por detalhe de regra:** conjunto de canais diferente em cada tela (`system,calendar` × `system`); interações sem autor; "hoje" e média por dia útil dependem do relógio; dia de Brasília (−3h). Mitigação: AC1 com comparação automática em vários recortes e datas fixas.
- **Leads diferentes por SDR não saem da soma das contagens** (um lead aparece em vários grupos) → precisa da linha própria por SDR com `count(DISTINCT lead_id)`.
- **`DROP` + `CREATE` reconcede `EXECUTE`** — conferir ACL depois de aplicar.
- **Ordem de deploy:** a migration precisa estar em prod antes do deploy do app.
- **Paginação roda a função 2×** (a 2ª página, vazia, confirma o fim) — como na Conversão; ~2×0,4 s em 90d, dentro do AC5.

## Definição de Pronto
- AC1–AC6 com evidência no Dev Agent Record (comparação e medição coladas).
- Migration aplicada em prod via MCP (com autorização) e ACL conferida.
- typecheck, lint, testes e build verdes; quality gate do @architect/@qa.
- Tela conferida depois do deploy.
- Nada de push/PR sem pedido explícito do Vini.

## Business Value
Atividades e Performance confiáveis e rápidas para qualquer período, sem trafegar dezenas de milhares de linhas a cada abertura. Fecha a lista da avaliação "paginar × agregar": as telas pesadas passam a contar no banco.

## PO Validation (11/set/2026 — Pax)
| # | Item | Resultado |
|---|---|---|
| 1 | Título claro | ✅ |
| 2 | Descrição completa | ✅ medição de prod + regra atual das duas telas conferida no código |
| 3 | AC testáveis | ✅ |
| 4 | Escopo IN/OUT | ✅ |
| 5 | Dependências | ✅ |
| 6 | Complexidade | ✅ M |
| 7 | Valor de negócio | ✅ |
| 8 | Riscos | ✅ (sem autor, canais diferentes, relógio, leads distintos) |
| 9 | Definição de pronto | ✅ |
| 10 | Alinhamento | ⚠️ sem epic/PRD — continuação de `statistics-fetch-all-rows` / `conversion-analytics-rpc` |

**Decisão: GO** — nota 8,5/10, confiança Alta (mesmo molde da Conversão, que bateu 100%). Executor @dev + @data-engineer, gate @architect ✅. CodeRabbit: N/A (sem `coderabbit_integration` no core-config). Conferido no código: filtros de canal (`not in (system,calendar)` × `neq system`), tipos "concluídos" diferentes em cada bloco, top 5 da tendência, pesquisa = canal ou tipo `research`, última atividade = maior `created_at`.

## Dependencies
- `statistics-fetch-all-rows` (no ar, `54274a2`) — base de comparação do AC1.
- `conversion-analytics-rpc` (Done) — mesmo molde: função `SECURITY INVOKER`, teste como gestor em `pg_temp`, fake PostgREST com `.rpc()`.
- Índices existentes (conferidos em prod 10/set): `idx_interactions_org (org_id, created_at DESC)`, `idx_interactions_org_type_channel (org_id, type, channel, created_at)`, `idx_interactions_performed_by_org`.

## Dev Agent Record

### Agent Model Used
Claude Opus 5 (@dev Dex)

### Debug Log / Decisões
- **Checkpoint 1 (pré-voo):** `20260911095436_get_interaction_counts.sql` — 14 dígitos, sem colisão (último em prod: `20260911030704`); só `CREATE OR REPLACE FUNCTION` (sem tabela/enum/trigger); `BEGIN/COMMIT`; enums conferidos (`channel_type` inclui `calendar`/`system`); org via `(SELECT public.user_org_id())`; `REVOKE` de `PUBLIC`/`anon`. ⚠️ Renomear o arquivo para a versão que o MCP gravar.
- **Desvio do contrato (a registrar pelo @po):** coluna extra **`first_at`** (menor `created_at` do grupo) nas linhas `cell` e `performer`. Motivo: nas duas telas, quando canais/tipos/SDRs empatam, a ordem vinha da **primeira atividade** de cada um (as interações eram lidas por `created_at`). O TS ordena os grupos por `first_at` (em µs, `atMicros`) antes de somar → mesma ordem de desempate. Sem isso, gráficos com valores iguais poderiam trocar de ordem.
- **SQL:** uma CTE `base` (lida uma vez) + `UNION ALL` de dois `GROUP BY` (célula e autor). Filtro de canal `channel <> ALL(p_exclude_channels)`; `channel` é `NOT NULL`.
- **AC5 (como gestor da V4 Amaral, função no formato final em `pg_temp`, RLS valendo):** 7d 11–26 ms · 30d 44–48 ms · **90d 112–117 ms** (1.068–1.211 linhas, contra ~35 mil interações).
- **AC1 — paridade, 3 camadas:**
  1. **SQL = referência JS, em prod:** md5 das linhas agrupadas (ordem byte a byte) calculado pela função (`pg_temp`, como gestor) × calculado em Node a partir das interações brutas (service role) — **11/11 recortes idênticos** (Atividades V4 7/30/90d, 30d com 2 SDRs, Julio 30d; Performance os mesmos + 30d só Recovery).
  2. **Código novo = código antigo, dados sintéticos:** `interaction-counts.equivalence.test.ts` — retrato (`__snapshots__`) gerado pelo código **antigo** (1.500 interações com `system`/`calendar`, sem autor, ex-membro `u4`, horários 00–03h UTC, "hoje"); código novo + referência JS reproduz os 4 cenários. Fica no CI como trava.
  3. **Código novo = código antigo, dados reais:** saída das duas telas no código antigo guardada (service role, datas fixas, `now` fixo, nomes = user_id) × código novo com leads/membros/metas reais e contagens da referência JS — **JSON idêntico nos 6 recortes** (inclui "última atividade" e ordem de empates). Arquivos temporários apagados.
- Interações sem autor (2.352 em 90d na V4): continuam nos totais de Atividades e fora das tabelas por SDR (coberto pela camada 2 e 3).

### File List
- `supabase/migrations/20260911095436_get_interaction_counts.sql` (novo — **já aplicada em prod** 11/set)
- `src/lib/supabase/types.ts` — regenerado (`pnpm gen:types`): só `get_interaction_counts`
- `src/features/statistics/services/interaction-counts.ts` (novo) — `fetchInteractionCounts`, `sumCells`, `atMicros`
- `src/features/statistics/services/interaction-counts.test.ts` (novo, 2 testes)
- `src/features/statistics/services/interaction-counts.equivalence.test.ts` (novo, 4 testes) + `__snapshots__/interaction-counts.equivalence.test.ts.snap` (retrato do código antigo)
- `src/features/statistics/services/activity-analytics.service.ts` — contagens do RPC em vez de linhas
- `src/features/statistics/services/performance-analytics.service.ts` — idem
- `src/features/statistics/services/fetch-all-rows.statistics.test.ts` — testes de volume de Atividades/Performance no formato novo
- `tests/mocks/postgrest-table.ts` — `neq`/`is`/`not` filtram; `rpc` com handler por argumentos

### Evidência por AC
| AC | Resultado |
|---|---|
| AC1 — mesmos números | ✅ 3 camadas: md5 SQL = JS 11/11 (prod); snapshot do código antigo reproduzido (sintético, fica no CI); JSON idêntico nas duas telas em 6 recortes reais (V4 7/30/90d, 30d 2 SDRs, 30d Recovery, Julio 30d) |
| AC2 — sem `from('interactions')` | ✅ as duas telas só leem `leads`, metas, membros e o RPC |
| AC3 — sem autor | ✅ totais incluem `performed_by` nulo; tabela por SDR não (camadas 2 e 3) |
| AC4 — INVOKER, sem `anon` | ✅ `prosecdef=false`; `has_function_privilege` anon **false**; chamada real como anon → "permission denied" |
| AC5 — < 1 s em 90d | ✅ 112–158 ms como gestor; ~1,1 mil linhas em vez de ~35 mil |
| AC6 — tipos | ✅ `pnpm gen:types` |

### DoD (story-dod-checklist)
- ✅ Requisitos, ACs, padrões, sem segredo, lint/typecheck/testes/build, tarefas marcadas, decisões registradas, sem dependência nem env nova.
- ⚠️ **Tela no navegador:** conferir depois do deploy (Atividades e Performance, 30 dias).
- ⚠️ **CodeRabbit:** CLI sem login (`coderabbit auth login` pelo Vini).
- ℹ️ **Teste instável não relacionado:** `features/reports/components/StatisticsView.test.tsx` falhou 1× na suíte completa, passou 3/3 isolado e na suíte seguinte (nenhum arquivo de `reports` mudou).

### Notas para o deploy
- A função já está em prod e o app atual não a usa → deploy do app a qualquer momento.
- Depois do deploy: abrir Estatísticas › Atividades e › Performance (30 dias) — os números devem ser os mesmos de antes do deploy.

## QA Results

### Review Date: 2026-09-11

### Reviewed By: Quinn (Test Architect)

### Code Quality Assessment
Troca mecânica e bem delimitada: cada conta que fazia `interactions.filter(...).length` passou a `sumCells(cells, ...)`; "leads distintos" e "última atividade" vêm da linha por autor. Nenhuma regra de negócio mudou. Módulo `interaction-counts.ts` pequeno e testado; migration limpa (`SECURITY INVOKER`, `STABLE`, `search_path = ''`, sem SQL dinâmico, org via `(SELECT user_org_id())`).

### Verificação independente (feita nesta revisão)
- **Função real em prod, recorte que o dev não testou com ela** (Performance V4 90d, membros ativos): md5 das contagens = `3d7aaccaaa50fd63ba95ae7112962430` / 1.068 linhas — **igual** à referência JS calculada pelo dev a partir das interações brutas.
- **Sem drift:** md5 do corpo em prod = arquivo `20260911095436_get_interaction_counts.sql` (`5e63acc9…`); `prosecdef=false`; `anon` sem EXECUTE.
- **Quem chama:** só as páginas `statistics/activities`, `statistics/prospecting/activities` e `statistics/prospecting/performance`, via actions com `getManagerOrgId` + sessão do usuário → nenhum chamador com service role (que receberia vazio).
- **Fuso do retrato:** CI roda com `TZ=America/Sao_Paulo` (`.github/workflows/ci.yml`), igual à máquina que gerou o snapshot.
- **Fake PostgREST:** `neq`/`not in` descartam nulos como o SQL/PostgREST; `is(col, null)`; nenhum teste antigo passou a passar "no vazio" (suíte inteira verde).

### Rastreabilidade (AC → evidência)
| AC | Given / When / Then | Evidência |
|---|---|---|
| AC1 | Dado os mesmos dados, quando as telas usam as contagens, então os números e a ordem são iguais | `interaction-counts.equivalence.test.ts` (retrato do código antigo, 4 cenários) + md5 SQL=JS 11/11 + JSON idêntico 6 recortes reais + checagem independente acima |
| AC2 | Telas não leem `interactions` | Diff: só `leads`, metas, membros e RPC |
| AC3 | Sem autor nos totais, fora da tabela por SDR | Cenários do retrato (autor nulo + ex-membro `u4`) |
| AC4 | `anon` não executa | `has_function_privilege` + chamada real negada |
| AC5 | 90d < 1 s | 112–158 ms como gestor |
| AC6 | Tipos no mesmo PR | commit `782cdcfd` (só a função) |

### Compliance Check
- Coding Standards: ✓ · Project Structure: ✓ (migration = versão gravada; tipos em commit separado) · Testing Strategy: ✓ · All ACs Met: ✓

### Improvements Checklist
- [ ] TEST-001 (low) — a SQL não roda no CI; a referência JS do teste é a "especificação". Se alguém mudar a função sem mudar a referência, só a conferência manual pega. Sugestão: teste em `tests/integration/` com Supabase local (mesma dívida da Conversão).
- [ ] MNT-001 (info) — retrato com ~1,5 mil linhas: mudança intencional nas telas exige `vitest -u` consciente (revisar o diff do snapshot no PR).
- [ ] FLK-001 (info) — `features/reports/components/StatisticsView.test.tsx` instável sob carga (falhou 1×, passou isolado e na rodada seguinte); não relacionado a esta story.
- [ ] DOC-001 (low) — CodeRabbit não rodou (CLI sem login).
- [ ] REQ-001 (low) — conferir Atividades e Performance (30d) no navegador após o deploy.

### Security Review
PASS — sem `SECURITY DEFINER`, `anon` sem EXECUTE, parâmetros tipados (enum `channel_type[]`), sem exposição além da RLS existente (`interactions_org_read` já libera a org inteira a quem é da org).

### Performance Considerations
PASS — 90d: ~35 mil linhas → ~1,1 mil; ~0,1–0,16 s por execução (2 por abertura; Atividades com "comparar" = 4).

### Files Modified During Review
Nenhum arquivo de código. Só esta seção e `docs/qa/gates/activity-performance-analytics-rpc.yml`.

### Gate Status
Gate: PASS → docs/qa/gates/activity-performance-analytics-rpc.yml

### Recommended Status
✓ Ready for Done — depois do deploy e da conferência das telas (REQ-001). Decisão final do Vini.
