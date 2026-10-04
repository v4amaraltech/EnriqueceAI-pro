# Story: BDR — Trava de responsável libera cadências executadas pela IA (`cadences.executor`)

## Status
Draft

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-22 | Vini + Claude | Story criada. Causa raiz encontrada (guard-rail de 06/08 exige `assigned_to` em cadência manual). Migração e seed escritos; contorno aplicado em prod (leads atribuídos ao Vini). |

## Origem
Em 22/09 não dava para inscrever os 25 leads do piloto "BDR IA — Arroz" na cadência **"BDR IA — Arroz (contato)"** (type `standard`, 4 ligações). Os leads já estavam na "BDR IA — Arroz (e-mail auto)" e a cadência de contato tinha **0 inscrições**.

Causa: a trava `enforce_enrollment_has_owner` (migration `20260806120000`) recusa inscrever lead **sem `leads.assigned_to`** em qualquer cadência que não seja `auto_email`. Os 25 leads estavam sem responsável, porque no BDR IA quem liga é a Ana (n8n via `claim_due_steps`), não um SDR. O e-mail auto passou pela exceção de `auto_email`; a de contato bateu na trava com "Lead sem responsável não pode ser inscrito em cadência manual".

Não é limitação de "1 cadência por lead": o índice único é por (cadência, lead) e em prod já existem 32 leads com duas cadências abertas (Inbound 2.0 + E-mail auto).

## Contorno aplicado em prod (22/09)
- Backup `_bkp_bdr_arroz_assign_20260922` (lead_id, assigned_to anterior) — 3 linhas; **não dropar antes de 22/10**.
- 25 leads do e-mail auto atribuídos a `vinicius.mercante@v4company.com`; 22 inscritos na "(contato)" pela tela de Leads.
- 3 leads **sem nenhum telefone** ficaram de fora da cadência de ligação: Ninfa Alimentos, Coasul Cooperativa Agroindustrial, Sequoia Alimentos.
- Efeito colateral do contorno: os passos `phone` dessas inscrições aparecem na fila de atividades do responsável até o n8n reservá-los (`lease_until`). A fila hoje não esconde passo reservado pela IA (ver Pendente).

## Regras
- Nova coluna `cadences.executor` TEXT NOT NULL DEFAULT `'sdr'`, CHECK em (`'sdr'`, `'bdr_ai'`).
- `enforce_enrollment_has_owner()` libera a inscrição quando `type = 'auto_email'` **ou** `executor = 'bdr_ai'`. Cadência de SDR continua exigindo responsável (guard-rail original preservado).
- `CREATE OR REPLACE` na função SECURITY DEFINER (não `DROP` + `CREATE`), para não reconceder EXECUTE a `authenticated`.
- A migração marca as cadências `BDR IA — %` da V4 Amaral como `bdr_ai` (idempotente); o seed `bdr-arroz-cadencias.sql` já cria as duas com `executor = 'bdr_ai'`.

## Entregue
- [x] `supabase/migrations/20260922110000_cadences_executor_bdr_ai_guardrail.sql` — coluna + CHECK + trava atualizada + marcação das cadências do piloto
- [x] `supabase/seed/bdr-arroz-cadencias.sql` — `executor = 'bdr_ai'` nas duas cadências

## Pendente
- [ ] Aplicar a migração em prod (MCP) e conferir: `select name, executor from cadences where name like 'BDR IA%'` → `bdr_ai`; `has_function_privilege('authenticated','public.enforce_enrollment_has_owner()','execute')` igual ao de antes.
- [ ] `pnpm gen:types` no mesmo PR (coluna nova) + commit separado `chore(types): regenerate`.
- [ ] Teste manual: inscrever lead **sem responsável** na "(contato)" pela tela de Leads → deve entrar; inscrever lead sem responsável numa cadência de SDR → deve continuar recusando.
- [ ] Follow-up (story própria): fila de atividades e discador **esconderem** passos de cadência `executor = 'bdr_ai'` (hoje aparecem para o responsável como tarefa manual).
- [ ] Follow-up (decisão de produto): "Iniciar novos leads" / "Leads para Abrir" usam `leads_no_active_enrollment`, que exclui lead com **qualquer** cadência aberta, inclusive `auto_email`. Decidir se e-mail auto deve contar.
- [ ] Reverter o contorno quando a migração estiver no ar? Não é necessário: os 25 leads podem seguir com o Vini como responsável. Se quiser desfazer, `_bkp_bdr_arroz_assign_20260922` tem o valor anterior (NULL) dos 3 que eu atribuí; os outros 22 foram atribuídos pela tela.

## Testes de aceite
- Lead sem `assigned_to` + cadência `standard` com `executor = 'bdr_ai'` → INSERT em `cadence_enrollments` passa.
- Lead sem `assigned_to` + cadência `standard` com `executor = 'sdr'` → INSERT recusado com `check_violation` ("Lead sem responsável…").
- Lead sem `assigned_to` + cadência `auto_email` → passa (comportamento anterior mantido).
- `UPDATE cadences SET executor = 'x'` → recusado pelo CHECK.

## File List
- `supabase/migrations/20260922110000_cadences_executor_bdr_ai_guardrail.sql`
- `supabase/seed/bdr-arroz-cadencias.sql`
- `docs/stories/bdr-guardrail-ai-executor.story.md`
