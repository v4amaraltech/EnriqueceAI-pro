# Handoff 22/09/2026 — Inscrição na "BDR IA — Arroz (contato)" bloqueada pela trava de responsável

## O que aconteceu
- Vini não conseguia inscrever os 25 leads do piloto BDR IA na cadência "BDR IA — Arroz (contato)" (`standard`, 4 ligações). Suspeita inicial: "1 cadência por lead". Não é: o índice único é por (cadência, lead) e prod já tem 32 leads com duas cadências abertas.
- Causa raiz: `enforce_enrollment_has_owner` (migration `20260806120000`) recusa lead sem `assigned_to` em cadência que não seja `auto_email`. Os 25 leads estavam sem responsável (no BDR IA quem liga é a Ana/n8n).
- Bloqueio secundário: "Iniciar novos leads" / "Leads para Abrir" usam `leads_no_active_enrollment`, que exclui lead com qualquer cadência aberta, inclusive e-mail auto.

## Feito em prod (contorno, opção 1)
- Backup `_bkp_bdr_arroz_assign_20260922` (3 linhas; não dropar antes de 22/10).
- 25 leads atribuídos ao Vini; 22 inscritos na "(contato)" pela tela de Leads.
- 3 leads sem telefone ficaram fora: Ninfa Alimentos, Coasul Cooperativa Agroindustrial, Sequoia Alimentos.

## Feito no repo (solução definitiva, opção 2) — NÃO commitado, NÃO aplicado
- Worktree `.claude/worktrees/bdr-guardrail`, branch `feat/bdr-guardrail-ai-executor` (a partir de `origin/main` `d11cf762`).
- `supabase/migrations/20260922110000_cadences_executor_bdr_ai_guardrail.sql` — `cadences.executor` ('sdr'|'bdr_ai'), trava libera `bdr_ai`, marca as cadências `BDR IA — %` da V4.
- `supabase/seed/bdr-arroz-cadencias.sql` — `executor = 'bdr_ai'`.
- `docs/stories/bdr-guardrail-ai-executor.story.md` (Draft).
- Ensaio em prod com ROLLBACK: sem dono + bdr_ai → passa; sem dono + sdr → recusa; executor inválido → CHECK recusa; ACL `authenticated` = false mantida.

## Próximos passos
1. Aplicar a migration em prod (MCP) e conferir `executor` das duas cadências.
2. `pnpm gen:types` no worktree, commit separado `chore(types): regenerate`.
3. Commit + PR (`@devops`), story → Ready/InProgress.
4. Follow-ups: fila/discador esconderem passos de cadência `bdr_ai`; decidir se `auto_email` conta em "Leads para Abrir".
