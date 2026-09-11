# Story: "Leads para Abrir" conta lead sem cadência agora (igual à tela de Leads)

## Status
Done

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-09-11 | @dev (Dex) | Ready for Review → **Done** (pedido do Vini: "pode marcar a story como concluída"). **PR #380 mergeado** 03:14 UTC (squash `56f35778`), **no ar** 03:17 UTC (`/api/version` = `56f3577`). Conferido no banco após o deploy: Sales Hub (RPC v2) = tela de Leads por SDR — Matheus 349, Giovanni 262, Guilherme 258, João 156, Ismael 108 (total 1.133); o card lê a mesma view. Pendente fora da story: atualizar o corpo da RPC na migration de hardening `20260909210100` antes de aplicá-la (ver Risks). |
| 2026-09-10 | @dev (Dex) | **Migration aplicada em prod** 23:35 UTC (autorizado pelo Vini: "commita, abre o PR e aplica no banco"), versão `20260910233502`. Conferido: RPC devolve 349/262/258/156/108 (= tela de Leads), ACL igual ao anterior, corpo usa a view. Sales Hub já mostra a regra nova; o card do app muda no merge. |
| 2026-09-10 | @dev (Dex) | Implementado: card lê a view `leads_no_active_enrollment` (contagem exata por SDR); clique abre `/leads` com "Novo" + "Sem cadência"; RPC `get_sdr_leads_para_abrir_v2` usa a mesma view (Sales Hub). Migration testada em transação com ROLLBACK (números iguais aos da tela, ACL preservado). typecheck ✅ lint ✅ testes ✅ (+2). Commit + PR autorizados pelo Vini. |
| 2026-09-10 | Vini + Claude | Story criada. Opção 1 aprovada pelo Vini: "vai na 1, ajusta o Sales Hub junto". |

## Executor Assignment
executor: "@dev"
quality_gate: "@architect"
quality_gate_tools: ["vitest", "typecheck", "lint"]

## Origem

Em 10/set/2026 o card "Leads para Abrir" mostrava 307 (Matheus 147), e a tela de Leads com "Novo" + "Sem cadência" mostrava ~1.100 (Matheus ~350). As duas contas estavam certas, só que contavam coisas diferentes:

- **card e Sales Hub** (`get_sdr_leads_para_abrir_v2`, definição de 19/06/2026): lead "Novo" que **nunca** teve cadência;
- **tela de Leads** (view `leads_no_active_enrollment`): lead "Novo" **sem cadência ativa ou pausada agora**.

A diferença (~770 leads) são leads que já passaram por cadência (Prospecção Fria 267, Recovery 174, Recomendação 104, Prospect Educação 85…) e voltaram para "Novo". O SDR precisa abri-los de novo, mas o card não mostrava. Além disso, o clique no SDR abria `/leads?status=new` sem o filtro de cadência, o que mostrava um terceiro número.

## Story

**As a** gestor,
**I want** que o card "Leads para Abrir", o Sales Hub e a tela de Leads mostrem o mesmo número,
**so that** eu enxergue a fila real de cada SDR, sem precisar conciliar três números.

## Acceptance Criteria
1. O card conta, por SDR ativo/convidado, os leads `status='new'`, não deletados, **sem enrollment `active`/`paused`**, na mesma fonte do filtro "Sem cadência" (`leads_no_active_enrollment`).
2. Clicar no SDR no card abre `/leads?assigned_to=X&status=new&cadence_id=__none__`, que mostra o mesmo total.
3. `get_sdr_leads_para_abrir_v2(p_org_id)` devolve os mesmos números (Sales Hub), sem mudar assinatura nem ACL.
4. O tooltip do card explica a regra.

## Scope
**IN:** `fetchLeadsToOpenRanking`, clique e tooltip do card, RPC v2.
**OUT:** código do Sales Hub (só lê `na_fila`, não muda nada); RPC v1 `get_sdr_leads_para_abrir()` (sem uso).

## Complexity
**XS**. 1 serviço, 1 componente, 1 migration `CREATE OR REPLACE`.

## Risks
- **Migration pendente do hardening do Sales Hub** (`20260909210100_harden_sdr_public_rpcs.sql`, branch `claude/relaxed-noyce-21b9e0`, não aplicada) recria `get_sdr_leads_para_abrir_v2` com o corpo ANTIGO (`NOT EXISTS cadence_enrollments`). Antes de aplicá-la, trocar o `FROM leads l ... NOT EXISTS` por `FROM leads_no_active_enrollment l`, senão a regra volta a ser a antiga.
- O número do card sobe de ~300 para ~1.100 de uma vez. É esperado (avisar o time).

## Tasks
- [x] Card lê a view com `count: 'exact', head: true` por SDR (sem baixar linhas, sem teto do PostgREST)
- [x] Clique leva para "Novo" + "Sem cadência"
- [x] Tooltip atualizado
- [x] Migration `20260910233502_leads_para_abrir_no_active_cadence.sql` (CREATE OR REPLACE, mesma assinatura)
- [x] Testes (+2 em `ranking-metrics.service.test.ts`)
- [x] Aplicar migration em prod (10/set 23:35 UTC, `20260910233502`)
- [x] Conferir após o deploy: card = Sales Hub = tela de Leads (11/set 03:17 UTC; card via mesma view, sem login para ver a tela)

## Dev Notes
- `types.ts` não muda: assinatura e retorno da RPC são os mesmos.
- A view é `security_invoker`; dentro da RPC SECURITY DEFINER roda como dono (igual ao corpo anterior, que lia `leads` direto).

## File List
- `src/features/dashboard/services/ranking-metrics.service.ts`
- `src/features/dashboard/services/ranking-metrics.service.test.ts`
- `src/features/dashboard/components/DashboardView.tsx`
- `supabase/migrations/20260910233502_leads_para_abrir_no_active_cadence.sql`
- `docs/stories/leads-to-open-no-active-cadence.story.md`
