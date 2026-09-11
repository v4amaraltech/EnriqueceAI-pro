# Story: Conversão calculada no banco (RPC) em vez de ler todas as interações

## Status
Ready for Review

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-11 | @dev (Dex) | InProgress → **Ready for Review**. Migration aplicada em prod com autorização do Vini (versão `20260911030704`, arquivo renomeado); ACL conferida; função real conferida como gestor (30d = 3456/3381/106/81, 91 ms; 90d 233 ms); `pnpm gen:types`; typecheck ✅ lint ✅ 1.983 testes ✅ build ✅. CodeRabbit não rodou (CLI sem login). Nada commitado. |
| 2026-09-11 | @dev (Dex) | Ready → **InProgress**. T1–T4 feitas (SQL validada em prod, só leitura). typecheck ✅ lint ✅ 1.982 testes ✅. **Parado antes de aplicar a migration em prod** — aguarda autorização do Vini; depois: `pnpm gen:types`, build, AC4/AC6. |
| 2026-09-10 | @po (Pax) | `*validate-story-draft`: **GO condicional → Ready** (nota 8,5/10). Vini escolheu a **opção B**. Correções aplicadas: decisão registrada; "funções ficam como estão" corrigido (a entrada muda, precisa de adaptador); risco de RLS por linha detalhado com regra de decisão; contrato de retorno e Definição de Pronto adicionados. |
| 2026-09-10 | Vini + Claude | Story criada a partir da avaliação "paginar × agregar" da story `statistics-fetch-all-rows` (commit `64de0d57`). Aguarda @po validar e o Vini escolher a opção (A ou B). |

## Executor Assignment
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["vitest", "typecheck", "lint"]
db_executor: "@data-engineer"

## Origem

Depois de `statistics-fetch-all-rows`, a tela Estatísticas › Conversão mostra o número certo, mas para isso **baixa todas as interações do período** e calcula no servidor Next:

| V4 Amaral (medido 10/set/2026) | 30 dias | 90 dias |
|---|---:|---:|
| Interações lidas | 24.205 | 58.218 |
| Páginas de 5.000 | 5 | 12 |
| JSON trafegado (~120 B/linha) | ~3 MB | ~7 MB |
| Tempo das páginas (medido da máquina do Vini) | — | ~1,3 s |

- As interações crescem ~24 mil/mês. Um período livre (`dateRange` não tem limite) de ~8 meses passa do teto de segurança de `fetchAllRows` (200 mil) e o número volta a ser **parcial**, só com aviso no log.
- **O que a tela usa de verdade das interações é pouco:** só "este lead teve `sent` / `meeting_scheduled` / `replied` no período". E o universo de leads é pequeno: a org inteira tem **6.307 leads** não excluídos (7.319 inscrições em cadência, todas as épocas).

## Story

**As a** gestor,
**I want** que a tela de Conversão abra rápido e com o número completo para qualquer período,
**so that** eu possa olhar trimestre, semestre ou ano sem número cortado.

## Regra atual (tem que continuar igual — `conversion-analytics.service.ts`)

- **Universo** = leads da org, não excluídos (`deleted_at IS NULL`), com `created_by ∈ SDRs` se houver filtro de SDR, que:
  - foram criados no período, **ou**
  - tiveram interação no período (qualquer canal; se houver filtro de cadência, só as dessa cadência), **ou**
  - têm `won_at`, `lost_at` ou `meeting_held_at` no período.
- **Funil:** Total = universo · Contactados = leads do universo com `sent` no período · Qualificados = com `meeting_scheduled` no período · SAL = com `won_at` no período.
- **Velocidade:** inscrições com `enrolled_at` no período (filtro de SDR por `enrolled_by`, filtro de cadência) de leads do universo com status `qualified`/`won` → dias entre `enrolled_at` e `updated_at` (média e mediana, 1 casa).
- **Conversão por cadência:** para cada cadência não excluída (qualquer status) e leads do universo inscritos nela **em qualquer época**: inscritos, em contato (`contacted`/`qualified`/`won`), qualificados, ganhos, com `replied` no período, com `meeting_scheduled` no período.
- **Por origem:** `created_by` nulo = "Import", senão "SDR"; qualificados = status `qualified`/`won`.

## Opções (decidido: **B**, pelo Vini em 10/set)

**A — RPC devolve os números prontos (um JSON com funil, velocidade, cadências e origem).**
Menos dados trafegados (poucos KB). Mas a regra inteira muda para SQL e passa a existir em dois lugares enquanto os testes de TS não forem reescritos.

**B — RPC devolve 1 linha por lead do universo, com marcadores. ✅ ESCOLHIDA**
`lead_id, status, created_by, won_at, has_sent, has_meeting_scheduled, has_replied` + as inscrições que o cálculo usa. O banco faz só o trabalho pesado: juntar 58 mil interações em "sim/não" por lead. Continua limitado ao total de leads da org (hoje ≤ 6,3 mil linhas, qualquer período). A **regra** de `calculateFunnel`, `calculateVelocity`, `calculateCadenceConversion` e `calculateConversionByOrigin` fica igual, mas `calculateFunnel` e `calculateCadenceConversion` hoje recebem a **lista de interações** — vão passar a receber os marcadores (trocar a assinatura ou um adaptador fino; os testes atuais continuam valendo).

## Scope

**IN (opção B):**
1. Migration com a função `public.get_conversion_universe(p_start timestamptz, p_end timestamptz, p_user_ids uuid[] DEFAULT NULL, p_cadence_id uuid DEFAULT NULL)`:
   - `SECURITY INVOKER`, `STABLE`, org via `public.user_org_id()` (sem parâmetro de org) — a RLS de `leads`/`interactions` continua valendo e não entra na lista de funções `SECURITY DEFINER`.
   - `GRANT EXECUTE` só para `authenticated` e `service_role`; `REVOKE` de `anon`/`PUBLIC`.
   - Devolve 1 linha por lead do universo com os marcadores acima.
   - **Contrato mínimo** (o que o TS usa hoje): universo → `lead_id uuid, status lead_status, created_by uuid, won_at timestamptz, has_sent bool, has_meeting_scheduled bool, has_replied bool`; inscrições → velocidade (`lead_id, enrolled_at, updated_at`, recorte do período + filtros) e vínculo lead↔cadência de **qualquer época** (`cadence_id, lead_id`, só leads do universo e cadências não excluídas ou a filtrada).
2. Leitura das inscrições (velocidade + vínculo lead↔cadência) pelo mesmo RPC ou por uma 2ª função irmã — decidir no Checkpoint 1. `cadence_enrollments` **tem** `org_id` (o comentário "has no org_id column" no service está desatualizado) (conferido em prod: 0 linhas com `org_id` nulo) → dá para filtrar direto, sem os lotes de 300 ids de hoje.
3. `conversion-analytics.service.ts` passa a chamar o RPC (paginado com `fetchAllRows` por segurança, ordem `lead_id`) em vez de ler `leads` + `interactions` + `cadence_enrollments`.
4. `pnpm gen:types` no mesmo PR (regra do projeto).

**OUT:**
- RPC de Atividades, Performance e Engajamento de Cadências (próximas stories, mesmo molde, se esta der certo).
- Mudar qualquer regra de negócio da tela. Os números têm que bater com os de hoje.
- Limitar o tamanho do período livre.

## Acceptance Criteria
- [ ] AC1 — Para 7, 30 e 90 dias, com e sem filtro de SDR e com filtro de uma cadência, a tela devolve **exatamente** os mesmos números do código atual (paginado, commit `64de0d57`). Conferido em prod na V4 Amaral e numa org pequena.
- [ ] AC2 — A tela não lê mais a tabela `interactions` diretamente (nenhum `from('interactions')` em `conversion-analytics.service.ts`).
- [ ] AC3 — Com um período de 1 ano, a tela abre sem aviso de truncamento e o RPC devolve no máximo o total de leads da org.
- [ ] AC4 — A função é `SECURITY INVOKER`; `anon` não tem `EXECUTE` (conferir com `has_function_privilege()`, não com `proacl`).
- [ ] AC5 — `EXPLAIN ANALYZE` como gestor da V4 Amaral para 90 dias < 1 s; documentado na story.
- [ ] AC6 — `types.ts` regenerado no mesmo PR.

## Tasks
- [x] T1 — @data-engineer: Checkpoint 1 (pré-voo de migration) + desenho da SQL; decidir 1 ou 2 funções. → **1 função**; inscrições vêm numa coluna `jsonb` por lead.
- [x] T2 — Migration + `EXPLAIN ANALYZE` (aplicada em prod 11/set, versão `20260911030704`) (índices existentes: `idx_interactions_org (org_id, created_at DESC)`, `idx_interactions_type (org_id, type, created_at DESC)`, `idx_interactions_lead`).
- [x] T3 — `conversion-analytics.service.ts` chama o RPC; testes com o fake de `tests/mocks/postgrest-table.ts` (ganhar suporte a `.rpc()`) + os atuais de velocidade.
- [x] T4 — Script de comparação antes × depois em prod (só leitura) para o AC1.
- [x] T5 — `pnpm gen:types`, typecheck, lint, testes, build.

## Complexity
**M** — 1 migration nova (função só leitura, sem tabela), 1 service, testes. Sem mudança de tela.

## Risks
- **Número divergente por detalhe de regra** (ex.: interação de lead excluído, filtro de cadência só nas interações, `created_by` no filtro de SDR). Mitigação: AC1 com comparação automática em vários recortes antes do merge.
- **RLS lenta dentro da função** — conferido em prod (10/set): `interactions_org_read` e `enrollments_org_read` usam `org_id = user_org_id()` **sem** `(SELECT …)`, então a função pode ser chamada linha a linha nas ~58 mil interações (`leads_org_read` já usa o padrão bom). Regra de decisão no Checkpoint 1, medindo com `EXPLAIN ANALYZE` como gestor: se AC5 passar, segue; se não, **parar e mostrar ao Vini** as saídas — (1) migration separada trocando essas 2 políticas para `(SELECT user_org_id())` (melhora o app todo, mas mexe em RLS) ou (2) `SECURITY DEFINER` com checagem explícita de gestor + org, entrando na allowlist de funções DEFINER. Não escolher sozinho.
- **`DROP` + `CREATE` de função reconcede `EXECUTE`** a `authenticated`/`PUBLIC` — conferir ACL depois de aplicar (lição de set/2026).

## Definição de Pronto
- AC1–AC6 marcados, com o resultado da comparação (AC1) e do `EXPLAIN ANALYZE` (AC5) colados no Dev Agent Record.
- Migration aplicada em prod via MCP e ACL conferida depois de aplicar.
- typecheck, lint, testes e build verdes; quality gate do @architect.
- Nada de push/PR sem pedido explícito do Vini.

## Business Value
Tela de Conversão confiável para qualquer período (trimestre/ano), abrindo em menos tempo e sem gastar ~7 MB por abertura. Serve de molde para tirar o mesmo peso de Atividades e Performance.

## Dependencies
- `statistics-fetch-all-rows` (commit `64de0d57`) — é a base de comparação do AC1. Precisa estar **no ar** antes, senão a comparação é contra o código antigo (cortado).
- Índices usados (conferidos em prod 10/set): `idx_interactions_org`, `idx_interactions_type`, `idx_interactions_org_type_channel`, `idx_interactions_lead`, `idx_cadence_enrollments_org_id`, `idx_enrollments_lead`.
- A tela é só de gestor (`getManagerOrgId`) e usa a sessão do usuário → `SECURITY INVOKER` enxerga todos os leads da org (`leads_org_read` libera gestor).

## PO Validation (10/set/2026 — Pax)
| # | Item | Resultado |
|---|---|---|
| 1 | Título claro | ✅ |
| 2 | Descrição completa | ✅ medição de prod + regra atual |
| 3 | AC testáveis | ✅ (AC1 com comparação automática) |
| 4 | Escopo IN/OUT | ✅ |
| 5 | Dependências | ✅ (após ajuste) |
| 6 | Complexidade | ✅ M |
| 7 | Valor de negócio | ✅ |
| 8 | Riscos | ✅ (RLS concretizado) |
| 9 | Definição de pronto | ✅ (adicionada) |
| 10 | Alinhamento | ⚠️ sem epic/PRD — é continuação da `statistics-fetch-all-rows` |

**Decisão: GO** — nota 8,5/10, confiança Média-Alta (a incerteza é o desempenho da RLS, tratado no Checkpoint 1). Executor @dev + @data-engineer (migration), gate @architect ✅ (diferentes). CodeRabbit: N/A (sem `coderabbit_integration` no core-config).

## Dev Agent Record

### Agent Model Used
Claude Opus 5 (@dev Dex)

### Debug Log / Decisões
- **Checkpoint 1 (pré-voo):** migration `20260911030704_get_conversion_universe.sql` — 14 dígitos, sem colisão com prod (último aplicado: `20260910233502`); só `CREATE OR REPLACE FUNCTION`, sem tabela/enum/trigger; org via `public.user_org_id()`; `BEGIN/COMMIT`; `REVOKE` de `PUBLIC`/`anon`, `GRANT` a `authenticated`/`service_role`. ⚠️ O timestamp final do arquivo deve ser o que o MCP gravar ao aplicar (renomear se diferente).
- **1 função, não 2:** as inscrições (vínculo lead↔cadência + velocidade) vêm numa coluna `enrollments jsonb` por lead, com `for_velocity` calculado no banco. Assim o universo é calculado uma vez só.
- **RLS por linha — falso alarme:** 1º desenho levou 2,1 s (90d) como gestor. Medido isolado: a agregação das interações leva ~50 ms **com** RLS (política `org_id = user_org_id()` não pesa aqui); o custo vinha de (a) a org vir de uma CTE ligada linha a linha e (b) as inscrições buscadas lead a lead. Reescrito (org `(SELECT id FROM org)`, inscrições num `GROUP BY` só). **Nada de RLS precisou mudar.**
- **AC5 (tempo real, como gestor da V4 Amaral, função no formato final):** 7d 78 ms · 30d 93 ms · **90d 149 ms** · 365d 704 ms. Volume devolvido 90d ≈ 1,5 MB (antes ~7 MB de interações).
- **Paginação:** o RPC roda inteiro a cada página → `fetchAllRows` com páginas de 20.000 (teto do servidor). Hoje: 2 execuções (a 2ª volta vazia).
- **AC1 (comparação, só leitura):** saída do service no commit `64de0d57` (service role, prod) × a função com o corpo exato da migration (criada em `pg_temp` dentro de transação desfeita, como o gestor de cada org), 6 recortes com datas fixas: V4 Amaral 7/30/90 dias, 30d com 2 SDRs, 30d só cadência Recovery, org Julio Cesar 30d. **Funil, velocidade e origem: 6/6 iguais. Tabela por cadência: 39/39 linhas iguais.** Ex.: V4 30d = Total 3.456 · Contactados 3.381 · Qualificados 106 · SAL 81 · velocidade 2,6/0,7 dias (127).
- **Ordem de deploy:** a migration precisa estar em prod **antes** do deploy do app (o app novo chama a função).

### File List
- `supabase/migrations/20260911030704_get_conversion_universe.sql` (novo — **já aplicada em prod**)
- `src/lib/supabase/types.ts` — regenerado (`pnpm gen:types`): função nova + 4 tabelas `_bkp_*` criadas em prod por outras sessões (09–10/set)
- `src/features/statistics/services/conversion-analytics.service.ts` — chama o RPC; parte pura `buildConversionAnalytics`; `calculateFunnel`/`calculateCadenceConversion` recebem marcadores em vez de interações; `calculateVelocity`/`calculateConversionByOrigin` com tipos mais estreitos (mesma regra)
- `src/features/statistics/services/conversion-analytics.service.test.ts` (novo, 5 testes)
- `src/features/statistics/services/read-all-rows.ts` — aceita `pageSize`
- `src/features/statistics/services/fetch-all-rows.statistics.test.ts` — teste da Conversão agora pelo RPC
- `tests/mocks/postgrest-table.ts` — `.rpc()` no PostgREST de mentira

### Evidência por AC
| AC | Resultado |
|---|---|
| AC1 — mesmos números | ✅ 6 recortes (V4 7/30/90d, 30d com 2 SDRs, 30d só Recovery, Julio 30d): funil, velocidade e origem 6/6; tabela por cadência 39/39 linhas. Refeito com a função **real** em prod: V4 30d = 3456/3381/106/81. |
| AC2 — sem `from('interactions')` na Conversão | ✅ o service só lê `cadences` + o RPC |
| AC3 — 1 ano sem truncar | ✅ 365d em 704 ms; o RPC devolve ≤ nº de leads da org (hoje ~6,3 mil), páginas de 20 mil |
| AC4 — INVOKER, sem `anon` | ✅ `prosecdef=false`; `has_function_privilege`: anon **false**, authenticated/service_role true; chamada como `anon` → "permission denied" |
| AC5 — < 1 s em 90d | ✅ 149–233 ms como gestor (RLS valendo) |
| AC6 — tipos no mesmo PR | ✅ `pnpm gen:types` |

### DoD (story-dod-checklist)
- ✅ Requisitos e ACs; padrões do projeto; sem segredo no código; lint/typecheck/testes/build; tarefas marcadas; decisões registradas; sem dependência nova; sem env nova.
- ⚠️ **Verificação na tela:** não dá para logar como gestor localmente — conferido direto no banco como o gestor. Conferir a tela Estatísticas › Conversão depois do deploy.
- ⚠️ **CodeRabbit:** CLI instalada (`/opt/homebrew/bin/coderabbit`) mas sem login — `coderabbit auth login` precisa ser feito pelo Vini numa sessão interativa. Revisão manual feita no lugar.

### Notas para o deploy
- A função já está em prod e o app atual não a usa → o deploy do app pode ir a qualquer momento.
- Depois do deploy: abrir Estatísticas › Conversão (30 e 90 dias) e comparar com os números acima.
- Próximas candidatas no mesmo molde: Atividades e Performance (story nova).
