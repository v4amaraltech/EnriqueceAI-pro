# Plano técnico: ordem do lead frio no Cockpit

Autor: Atlas (Planejador) | Data: 15/11/2026 | Status: Proposta para o Orquestrador
Base: `docs/plans/cockpit-lead-frio/spec.md` (FR-1..8, NFR-1..5, DP-1..6) + handoff `.aios/handoffs/handoff-analyst-to-pm-20261115-cockpit-lead-frio.yaml`.
Banco: só SELECT/EXPLAIN em `dhkmonctyoaenejemkrt`, org V4 `c2727473-1df8-4faa-9264-a9fc1759fe3b`. Nenhum código, migration ou escrita feitos.

---

## 0. Achados que mudam o plano (ler primeiro)

| # | Achado | Prova | Impacto |
|---|--------|-------|---------|
| A1 | **A flag já está ligada para a V4.** `app_flags.call_priority_v2` = `enabled=false`, `allow_org_ids=[V4]`, `allow_user_ids=[]`. | SELECT em `app_flags` (15/11) | DP-6 resolvido. Mas: **o merge publica a mudança para a V4 na hora**, sem passo extra. |
| A2 | **Desligar a flag também muda a Execução.** `fetch-dialer-queue.ts:11,88` lê `isCallPriorityV2Enabled` para ligar a fila priorizada do Power Dialer. | Grep | O rollback "pela flag" não é isolado do menu Execução. Ver DP-8. |
| A3 | **Pelo score v2, a maioria dos leads NÃO é frio (score 0).** O score soma "esforço de envio" (e-mail enviado vale peso 2 → esforço ≥ 1). Na carteira, leads com envio em 90 dias: 342/533, 332/499, 219/329, 145/283, 238/239. | SELECT (15/11) | Os "~96% sem sinal" do handoff são pela regra v1 (7 dias). Com FR-1 ao pé da letra, o problema continua: esses leads seguem ordenados por esforço e `updated_at`. Ver DP-7. |
| A4 | **88% dos leads não têm cadência ativa.** Sem cadência ativa: 472/533, 456/499, 226/329, 217/283, 175/239. Com passo vencido agora: 40, 7, 46, 2, 15. | SELECT (15/11) | O critério 1 (`next_step_due`) só ordena uma parte pequena; onde fica o lead **sem cadência** decide quase toda a fila. Ver DP-3. |
| A5 | Leads com interesse real (resposta/reunião em 90 d ou ligação com desfecho positivo): 156, 37, 32, 16, 36. Com mais de 6 ligações em 30 d: 39, 27, 26, 19, 19. | SELECT (15/11) | Para o maior SDR, o Cockpit mostrará 156 quentes antes de qualquer frio. |

### Quem importa o quê (prova por Grep, `src/` e `supabase/functions/`)

| Símbolo | Importado por | Pode mudar? |
|---------|---------------|-------------|
| `rankLeadsByPriority`, `computeCallPriority` (`contact-engine/services/call-priority.ts`) | só `cockpit/services/next-call-card.service.ts` (+ testes próprios) | Sim, mas o plano **não precisa** mudar a lógica. |
| `loadPrioritySignals`, `recordPrioritySuggestion` (`call-priority.service.ts`) | só `next-call-card.service.ts` (+ testes) | Não muda a lógica; só 2 `export` aditivos de constantes. |
| `isCallPriorityV2Enabled` (`call-priority.service.ts`) | `next-call-card.service.ts`, **`activities/actions/fetch-dialer-queue.ts`**, `recordHumanCorrection` | **Não mexer.** |
| `leadSignalScore`, `NextLeadInteraction` (`cockpit/utils/next-lead.ts`) | `next-call-card.service.ts`, **`activities/utils/rank-dialer-queue.ts`**, **`activities/actions/fetch-dialer-queue.ts`** | **Não mexer** (é da Execução também, mesmo estando em `cockpit/`). |

Lista proibida no diff: `src/features/activities/**`, `rank-dialer-queue.ts`, `fetch-dialer-queue.ts`, **`src/features/cockpit/utils/next-lead.ts`**, `flag-scope.service.ts`.

---

## (a) Consulta única que ordena a carteira no banco

### Alternativa 1 — Função SQL (RPC) `public.cockpit_next_call_candidates` ✅ recomendada

Chamada por `client.rpc(...)` (POST com corpo JSON). A lista de excluídos da sessão (`excludeLeadIds`, que cresce durante o dia) vai no corpo, **não na URL** → some o limite do `.in()` grande do PostgREST.

Parâmetros (todos com padrão = premissas pendentes, ajustáveis sem nova migration):

| Parâmetro | Tipo | Padrão | Origem |
|-----------|------|--------|--------|
| `p_org_id` | uuid | — | viewer (servidor) |
| `p_target_user_id` | uuid | — | `viewer.targetUserId` |
| `p_exclude_lead_ids` | uuid[] | `{}` | FR-5 |
| `p_now` | timestamptz | `now()` | NFR-3 (sem relógio implícito no TS) |
| `p_signal_window_days` | int | 90 | `SIGNAL_WINDOW_DAYS` do score v2 |
| `p_interest_dispositions` | text[] | — | derivado de `CALL_DISPOSITION_POINTS > 0` no TS |
| `p_bant_field_names` | text[] | — | `BANT_CORE_FIELDS` do TS |
| `p_recent_days` | int | 7 | DP-1 (janela de "tentativas recentes") |
| `p_attempts_window_days` | int | 30 | DP-2 |
| `p_max_attempts` | int | 6 | DP-2 (acima disso desce) |
| `p_daily_cap` | int | 2 | DP-1 (teto/dia; `0` = sem teto) |
| `p_cold_limit` | int | 20 | quantos frios devolver |

Saída (uma linha por lead): `lead_id, updated_at, maybe_hot, next_step_due, attempts_recent, attempts_window, calls_today, last_call_at, over_attempts, cold_rank`.
Devolve **todos** os `maybe_hot = true` (pré-filtro de possível quente) **+** os `p_cold_limit` primeiros por `cold_rank`.

Corpo (esboço validado com EXPLAIN — o Forge escreve a versão final):

```sql
with cart as (                       -- FR-5: mesmos filtros de hoje
  select l.id, l.updated_at, l.custom_field_values
  from public.leads l
  where l.org_id = p_org_id and l.deleted_at is null
    and l.status not in ('unqualified','archived')
    and l.telefone is not null and btrim(l.telefone) <> ''
    and (l.assigned_to = p_target_user_id or l.closer_id = p_target_user_id)
    and not (l.id = any(p_exclude_lead_ids))
    and not exists (select 1 from public.contact_holds h
                    where h.lead_id = l.id and h.org_id = p_org_id and h.tipo = 'total')
)
-- lateral 1: min(next_step_due) das inscrições ativas (cadence_enrollments, org_id filtrado)
-- lateral 2: calls dos últimos p_attempts_window_days → attempts_recent, attempts_window,
--            calls_today (dia BRT: date_trunc('day', p_now at time zone 'America/Sao_Paulo')),
--            last_call_at = max(coalesce(started_at, created_at))
-- maybe_hot = reply/meeting_scheduled em interactions (janela de sinal)
--          OR call com sdr_disposition / metadata->'ai_outcome'->>'disposition' em p_interest_dispositions
--          OR campo BANT preenchido (custom_fields por nome) OR decision_events 'human_correction'
-- cold_rank = row_number() over (order by
--     over_attempts asc,                 -- DP-2: >6 em 30d desce para o fim (não sai)
--     next_step_due asc nulls last,      -- FR-3.1 (vencido < futuro < sem cadência; ver DP-3)
--     attempts_recent asc,               -- FR-3.2
--     last_call_at asc nulls first,      -- FR-3.3 (nunca ligado = mais tempo)
--     updated_at desc,                   -- FR-3.4
--     id asc)                            -- FR-3.5 determinístico
--   apenas para leads com calls_today < p_daily_cap (DP-1; cap=0 desliga)
```

`cold_rank` é calculado sobre **todos** os leads (inclusive `maybe_hot`): se o TS confirmar que um "possível quente" tem interesse 0 (ex.: correção humana para 0), ele mantém sua posição de frio e não some da fila.

Vantagens: 1 ida ao banco, parâmetros por chamada, ordenação inteira no banco (NFR-2), `p_now` explícito (NFR-3), corpo POST (sem limite de URL).

### Alternativa 2 — View (`security_invoker`) com agregados por lead

- View não recebe parâmetro: `now`, dia BRT, teto e janelas ficariam fixos no SQL; mudar premissa = nova migration.
- O filtro de excluídos voltaria para a URL (`.not('lead_id','in',(...))`) → mesmo limite do PostgREST quando a sessão cresce.
- Agregados de `calls`/`cadence_enrollments` tendem a ser calculados para a org inteira antes do filtro por SDR.
- Ordenação por colunas calculadas via PostgREST fica frágil (`order=` em várias colunas, nulls).

**Recomendação: Alternativa 1 (RPC).** View só ganharia se precisasse de leitura em vários lugares — não é o caso (só o Cockpit).

---

## (b) Como combinar com o score v2 sem duplicar regra

Regra única para cada coisa:

| Regra | Dono único | Como o outro lado usa |
|-------|-----------|-----------------------|
| Pontuação de quente (score v2) | `computeCallPriority` (TS) | SQL só faz **pré-filtro largo** (`maybe_hot`); as listas vêm do TS como parâmetro (`p_interest_dispositions`, `p_bant_field_names`, `p_signal_window_days`). Nenhum peso de score no SQL. |
| Ordem do frio | `ORDER BY` da RPC | TS só lê `cold_rank`. Não reordena. |
| Quente antes de frio + rótulo | função pura nova `pickCockpitLead` (TS) | — |

Fluxo com a flag ligada:

1. RPC devolve possíveis quentes (até ~156 no maior SDR) + top 20 frios.
2. TS carrega sinais **só dos possíveis quentes** com `loadPrioritySignals` em blocos de até 100 ids (merge dos `Map`) — sem mudar o serviço.
3. `rankLeadsByPriority` (sem mudança) ordena os quentes confirmados.
4. `pickCockpitLead`: existe quente confirmado → ele (sem rótulo; ordem atual de quem tem sinal preservada). Senão → menor `cold_rank` (rótulo de frio, FR-7).
5. Para a trilha (FR-8), o frio escolhido tem seus sinais carregados (1 id) → `computeCallPriority` → `recordPrioritySuggestion` como hoje.

"Quente confirmado" depende do **DP-7** (achado A3): padrão proposto `interest > 0`; alternativa `score > 0` (FR-1 literal), aí o pré-filtro precisa incluir envios (parâmetro `p_include_send_effort`).

---

## (c) Índices — validado com EXPLAIN ANALYZE

Consulta-esboço acima (com laterais e pré-filtro) na carteira do maior SDR (533 leads com telefone), 15/11:

- **Execução: 46,6 ms; planejamento: 16,8 ms**; top-N heapsort 33 kB; ~7,2 mil buffers (quase todos em cache).
- Índices usados (todos já existem): `idx_leads_assigned_to` + `idx_leads_closer_id` (BitmapOr), `uq_contact_holds_lead_tipo`, `idx_enrollments_lead`, `idx_calls_lead`, `idx_interactions_type`, `idx_decision_events_type`.

**Decisão: nenhum índice novo agora.** Gatilho para rever: p95 da RPC > 300 ms no log. Candidato se precisar: `calls (lead_id, created_at desc) where lead_id is not null` (troca o filtro de data feito linha a linha por busca no índice).

Orçamento de tempo (DP-5 = 1 s): RPC ~50–70 ms + sinais dos quentes (2 blocos × 5 consultas em paralelo) + `fetchCallContext` (já existe). Medir com log `[next-call-card] v2 ms=` em cada etapa.

---

## (d) Mudanças arquivo por arquivo

| # | Arquivo | Mudança | Quem |
|---|---------|---------|------|
| 1 | `supabase/migrations/YYYYMMDDHHMMSS_cockpit_next_call_candidates.sql` (14 dígitos únicos; conferir com `ls supabase/migrations`) | `BEGIN;` `CREATE OR REPLACE FUNCTION public.cockpit_next_call_candidates(...) RETURNS TABLE(...) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''` (tabelas com `public.`), depois `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` `COMMIT;` | Forge |
| 2 | `src/lib/supabase/types.ts` | `pnpm gen:types` após a migration aplicada (commit separado `chore(types): regenerate`) | Forge (candidato **Haiku 5.5**) |
| 3 | `src/features/contact-engine/services/call-priority.ts` | **Aditivo:** `export const INTEREST_DISPOSITIONS = Object.keys(CALL_DISPOSITION_POINTS).filter(k => CALL_DISPOSITION_POINTS[k] > 0)`. Lógica sem mudança. | Forge |
| 4 | `src/features/contact-engine/services/call-priority.service.ts` | **Aditivo:** `export` em `SIGNAL_WINDOW_DAYS` e `BANT_CORE_FIELDS`. Nada mais. | Forge |
| 5 | `src/features/cockpit/utils/cold-lead-order.ts` (novo) | Parâmetros com padrão (`COLD_ORDER_DEFAULTS`: cap 2, recentes 7 d, janela 30 d, máx 6, limite 20), `COLD_LEAD_LABEL = 'Sem leads quentes, mostrando frio'` (DP-4) e `buildCandidatesRpcArgs(viewer, now, exclude)` (pura). | Forge (candidato **Haiku 5.5**) |
| 6 | `src/features/cockpit/utils/next-call-pick.ts` (novo) | Função pura `pickCockpitLead({ hot: RankedLead[], cold: ColdCandidate[] }) → { leadId, tier: 'hot' \| 'cold' } \| null`. | Forge |
| 7 | `src/features/cockpit/services/cockpit-candidates.service.ts` (novo) | `fetchCockpitCandidates(client, args)` → chama a RPC; `null` em qualquer erro (FR-6). Normaliza tipos. | Forge |
| 8 | `src/features/cockpit/services/next-call-card.service.ts` | Ver detalhe abaixo. | Forge |
| 9 | `src/features/cockpit/types.ts` | `CallPriorityView` ganha `tier?: 'hot' \| 'cold'` e `tierLabel?: string \| null` (opcionais → nada quebra). | Prisma |
| 10 | `src/features/cockpit/components/NextCallCard.tsx` | Se `priority?.tier === 'cold'`: selo com `priority.tierLabel` (`data-testid="priority-cold-label"`) perto da linha `priority-source` (linha ~157). Quente: nada novo. | Prisma |

Detalhe do item 8 (`next-call-card.service.ts`):
- Flag **desligada**: caminho atual intacto, byte a byte no comportamento (consulta de 15, `pickNextLead`, `suggestApproach`).
- Flag **ligada**: a consulta v1 de 15 continua (dá `v1LeadId` para `v1PickSame` e para o fallback). Hoje, se os 15 vierem vazios, a função retorna `empty` **antes** do v2 — com a flag ligada isso passa a acontecer só se v1 **e** v2 vierem vazios (senão a carteira inteira nunca seria vista).
- `rankWithPriorityV2` passa a: RPC (service role, `org_id` explícito) → sinais dos `maybe_hot` em blocos ≤ 100 → `rankLeadsByPriority` → `pickCockpitLead` → trilha. Qualquer falha → `null` → escolha v1 (FR-6).
- `toPriorityView` recebe `tier` e preenche `tierLabel = COLD_LEAD_LABEL` só para frio.
- Constante `CANDIDATES_LIMIT = 15` fica (é do v1).

Como o rótulo chega ao cartão: `pickCockpitLead.tier` → `toPriorityView` (`priority.tier`, `priority.tierLabel`) → `NextCallCardResult.data.priority` → `NextCallCard.tsx`. `suggestApproachV2` não muda (frio não tem `sourceLabel`, então não ganha linha extra).

---

## (e) Plano de testes

| Teste | Arquivo | O que prova |
|-------|---------|-------------|
| Ordem pura (merge + rótulo) | `cockpit/utils/next-call-pick.test.ts` (novo) | Quente vence 100 frios (FR-2); sem quente → menor `cold_rank` com `tier='cold'` (FR-7); possível quente com interesse 0 volta para a posição de frio; listas vazias → `null`; mesma entrada → mesma saída (NFR-3). |
| Parâmetros | `cockpit/utils/cold-lead-order.test.ts` (novo) | Padrões, `now` explícito, excluídos vão para o argumento, `INTEREST_DISPOSITIONS` = só desfechos com ponto > 0. |
| Serviço com flag | `cockpit/services/next-call-card-priority.test.ts` (ampliar) | Ligada sem quente → frio da RPC + rótulo; com quente → quente sem rótulo; RPC com erro → escolha v1; sinais com erro → v1; falha de bloqueios → erro (FR-5); trilha gravada para frio e falha da trilha não muda o lead (FR-8); excluídos chegam à RPC; v1 vazio mas carteira com lead → sugere. |
| Flag desligada | `cockpit/services/next-call-card.service.test.ts` (**sem edição**) + 1 caso novo no arquivo de prioridade: desligada → `rpc` nunca chamada | FR-6 |
| Cartão | `cockpit/components/NextCallCard.test.tsx` (ampliar) | Selo aparece só em frio; quente e sem prioridade iguais a hoje. |
| SQL de verdade | `tests/integration/cockpit-next-call-candidates.test.ts` (novo; pula sem Supabase local, igual `rls-policies.test.ts`) | Cada chave da ordem 1→5; vencido < futuro < sem cadência; >6 em 30 d desce; teto do dia; `contact_holds` total some; excluídos somem; outra org nunca aparece; `anon`/`authenticated` sem EXECUTE. |
| Execução intacta | `pnpm exec vitest run src/features/activities` **sem editar nenhum teste** + portão do diff | NFR-1 |

Portão do diff (tem que sair vazio):
```bash
git diff --name-only main...HEAD | grep -E '^src/features/activities/|rank-dialer-queue|fetch-dialer-queue|cockpit/utils/next-lead\.ts|flag-scope\.service\.ts'
```
Final: `pnpm typecheck && pnpm lint && pnpm test:run && pnpm build`.

---

## (f) Segurança

- `SECURITY INVOKER` (não DEFINER) + `SET search_path = ''`. Chamada só pelo cliente service role no servidor (mesmo padrão de `rankWithPriorityV2` hoje).
- `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` — o Supabase dá EXECUTE a `anon`/`authenticated` por padrão em função nova, por isso o REVOKE explícito. Depois de aplicar, conferir com `select proacl from pg_proc where proname='cockpit_next_call_candidates'` (só `service_role` e dono).
- `org_id` filtrado em **toda** tabela dentro da função (`leads`, `contact_holds`, `cadence_enrollments`, `calls`, `interactions`, `custom_fields`, `decision_events`), porque service role ignora RLS.
- `p_org_id` e `p_target_user_id` vêm só do `CockpitViewer` resolvido no servidor (`resolve-cockpit-viewer.ts`: SDR só mira a si mesmo; gestor escolhe SDR da org). Nunca do navegador.
- Defesa extra: o lead escolhido passa por `fetchCallContext`, que reaplica a permissão do viewer.
- Sem tabela nova, sem backup, nada legível por `anon`. Função só lê (`STABLE`).
- `CREATE OR REPLACE` em mudanças futuras (lição: `DROP`+`CREATE` regrava permissões).

---

## (g) Etapas, responsáveis e rollback

| Etapa | Objetivo | Arquivos | Quem | Aceite | Como testar |
|-------|----------|----------|------|--------|-------------|
| E0 | Usuário decide DP-1/2/3/4/5 e **DP-7, DP-8** | — | Orquestrador → usuário | Respostas registradas na spec | — |
| E1 | Migration da RPC + teste de integração | #1, teste SQL | Forge | Checkpoint 1 (preflight) ok; teste local verde | `npx supabase start` + `pnpm exec vitest run tests/integration/cockpit-next-call-candidates.test.ts` |
| E2 | Revisão de segurança da migration | #1 | Sentinela | `proacl` correto, `org_id` em todas as tabelas, `search_path` vazio | Leitura + EXPLAIN em homologação/prod (só SELECT) |
| E3 | Aplicar migration em prod **antes do merge** (CON-5) + `pnpm gen:types` | #1, #2 | @devops com aprovação do usuário; gen:types = Forge (**Haiku 5.5**) | Função existe; `proacl` conferido; types no PR | `select proacl ...`; EXPLAIN ANALYZE da RPC na carteira de 533 |
| E4 | Constantes e funções puras | #3, #4, #5, #6 + testes | Forge (#5 e testes de #5: **Haiku 5.5**) | Testes puros verdes | `pnpm exec vitest run src/features/cockpit/utils` |
| E5 | Serviço RPC + integração no cartão | #7, #8 + testes | Forge | Todos os casos de (e) verdes | `pnpm exec vitest run src/features/cockpit` |
| E6 | Selo do frio na tela | #9, #10 + teste | Prisma (**Haiku 5.5**: mudança pequena e repetitiva) | Selo só em frio | `NextCallCard.test.tsx` + olhar no preview |
| E7 | Portões | — | Forge | typecheck, lint, test:run, build verdes; portão do diff vazio; testes de `activities` sem edição | comandos de (e) |
| E8 | Revisão final / QA gate | diff inteiro | Sentinela | PASS | Leitura + rodar portões |
| E9 | Publicação | — | @devops, só com pedido explícito do usuário | Deploy ok (`/api/version`) | Ver 1º cartão frio de um SDR da V4; log de tempo < 1 s |

Rollback:
1. **Pela flag** (como pede a spec): tirar a V4 de `allow_org_ids` de `call_priority_v2` → Cockpit volta ao v1 na hora, sem deploy. **Efeito colateral (A2):** a fila priorizada do Power Dialer e a correção humana também desligam para a V4. Ver DP-8.
2. Pelo código: reverter o PR; a função SQL pode ficar (só leitura, só service role) ou sair numa migration nova (forward-only).
3. Falha em produção da RPC já volta sozinha para o v1 (FR-6), sem ação.

---

## (h) Riscos e dúvidas

### Novas decisões pendentes (não estavam na spec)

**DP-7 — O que é "frio"?** (achado A3)
1. Frio = **interesse 0** (envio de e-mail não esquenta lead). ✅ Recomendo: é o que o handoff mediu como "sem sinal" e resolve o problema.
2. Frio = **score 0** (FR-1 literal). Então 64–99% dos leads seguem "quentes" por esforço de envio e continuam ordenados por `updated_at`.
3. Frio = score 0, mas esforço só desempata entre quentes (= opção 1 na prática).
Parametrizado em `cold-lead-order.ts` (`COLD_DEFINITION`), mas a opção 2 exige o parâmetro `p_include_send_effort` na RPC.

**DP-8 — Rollback isolado do Cockpit?** (achado A2)
1. Aceitar: desligar `call_priority_v2` para a V4 também desliga a prioridade do Power Dialer.
2. Criar flag própria `cockpit_cold_order` (mesmo esquema `allow_org_ids`) só para a ordem nova. ✅ Recomendo: rollback sem tocar na Execução e permite publicar com a ordem nova ainda desligada (A1). Precisa aprovação, pois a spec fixa `call_priority_v2`.
3. Usar `allow_user_ids` da `call_priority_v2` para testar com 1 SDR (também afeta o Power Dialer desse SDR).

### Premissas a confirmar (já parametrizadas)
- DP-1: teto 2/dia — vale **só para frio** (proposta, para não mexer na ordem de quem tem sinal) ou também para quente? Janela de "tentativas recentes": 7 dias (proposta) ou 24 h?
- DP-2: >6 em 30 d desce (implementado como 1ª chave entre frios).
- DP-3: com 88% sem cadência ativa, a ordem proposta é vencido → futuro → **sem cadência**. Alternativa forte: sem cadência antes de futuro (lead futuro a cadência já vai tratar). Decisão do usuário.
- DP-4: texto do selo `"Sem leads quentes, mostrando frio"`.
- DP-5: 1 s (medido: RPC 46 ms).

### Riscos
| # | Risco | Mitigação |
|---|-------|-----------|
| R1 | Merge publica direto para a V4 (A1) | DP-8 opção 2, ou merge combinado com o usuário em horário de pouco uso |
| R2 | Rollback pela flag derruba prioridade do Power Dialer (A2) | DP-8 |
| R3 | Pré-filtro `maybe_hot` (SQL) ficar menor que as fontes de interesse do score (TS) → quente tratado como frio | Listas vêm do TS por parâmetro; teste de integração com 1 lead por fonte (resposta, reunião, desfecho SDR, desfecho IA, BANT, correção) |
| R4 | Carga de sinais de ~156 quentes ficar lenta | Blocos de 100 em paralelo; log de tempo; se passar de 1 s, limitar aos 50 quentes mais recentes (decisão do usuário) |
| R5 | Fuso do "hoje" do teto (servidor UTC × BRT) | `date_trunc` em `America/Sao_Paulo` dentro da RPC; teste com `p_now` às 23h BRT |
| R6 | Cockpit e Power Dialer ligarem o mesmo lead | Teto conta **todas** as ligações do lead (qualquer origem) no dia BRT |
| R7 | Types não regenerados | E3 obrigatório no mesmo PR |
| R8 | Migration esquecida antes do merge | E3 antes de E9 (CON-5) |
