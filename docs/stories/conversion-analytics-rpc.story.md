# Story: Conversão calculada no banco (RPC) em vez de ler todas as interações

## Status
Draft

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
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

## Opções

**A — RPC devolve os números prontos (um JSON com funil, velocidade, cadências e origem).**
Menos dados trafegados (poucos KB). Mas a regra inteira muda para SQL e passa a existir em dois lugares enquanto os testes de TS não forem reescritos.

**B — RPC devolve 1 linha por lead do universo, com marcadores (recomendada).**
`lead_id, status, created_by, won_at, has_sent, has_meeting_scheduled, has_replied` + as inscrições que o cálculo usa. O banco faz só o trabalho pesado: juntar 58 mil interações em "sim/não" por lead. Continua limitado ao total de leads da org (hoje ≤ 6,3 mil linhas, qualquer período), e as funções `calculateFunnel`, `calculateVelocity`, `calculateCadenceConversion` e `calculateConversionByOrigin` ficam **como estão**, com os testes atuais.

## Scope

**IN (opção B):**
1. Migration com a função `public.get_conversion_universe(p_start timestamptz, p_end timestamptz, p_user_ids uuid[] DEFAULT NULL, p_cadence_id uuid DEFAULT NULL)`:
   - `SECURITY INVOKER`, `STABLE`, org via `public.user_org_id()` (sem parâmetro de org) — a RLS de `leads`/`interactions` continua valendo e não entra na lista de funções `SECURITY DEFINER`.
   - `GRANT EXECUTE` só para `authenticated` e `service_role`; `REVOKE` de `anon`/`PUBLIC`.
   - Devolve 1 linha por lead do universo com os marcadores acima.
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
- [ ] T1 — @data-engineer: Checkpoint 1 (pré-voo de migration) + desenho da SQL; decidir 1 ou 2 funções.
- [ ] T2 — Migration + `EXPLAIN ANALYZE` (índices existentes: `idx_interactions_org (org_id, created_at DESC)`, `idx_interactions_type (org_id, type, created_at DESC)`, `idx_interactions_lead`).
- [ ] T3 — `conversion-analytics.service.ts` chama o RPC; testes com o fake de `tests/mocks/postgrest-table.ts` (ganhar suporte a `.rpc()`) + os atuais de velocidade.
- [ ] T4 — Script de comparação antes × depois em prod (só leitura) para o AC1.
- [ ] T5 — `pnpm gen:types`, typecheck, lint, testes, build.

## Complexity
**M** — 1 migration nova (função só leitura, sem tabela), 1 service, testes. Sem mudança de tela.

## Risks
- **Número divergente por detalhe de regra** (ex.: interação de lead excluído, filtro de cadência só nas interações, `created_by` no filtro de SDR). Mitigação: AC1 com comparação automática em vários recortes antes do merge.
- **RLS lenta dentro da função** (`SECURITY INVOKER` roda as políticas por linha). Mitigação: AC5; lembrar do padrão `(SELECT fn())` nas políticas.
- **`DROP` + `CREATE` de função reconcede `EXECUTE`** a `authenticated`/`PUBLIC` — conferir ACL depois de aplicar (lição de set/2026).

## Business Value
Tela de Conversão confiável para qualquer período (trimestre/ano), abrindo em menos tempo e sem gastar ~7 MB por abertura. Serve de molde para tirar o mesmo peso de Atividades e Performance.

## Dependencies
- `statistics-fetch-all-rows` (commit `64de0d57`) — é a base de comparação do AC1.
