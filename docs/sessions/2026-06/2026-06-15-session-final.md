# Handoff final — Sessão 2026-06-15 (V4 Amaral)

Org `c2727473-1df8-4faa-9264-a9fc1759fe3b`. Agente: @devops (Gage).
Resumo consolidado do dia, com ponteiros pros handoffs detalhados por tema.

## Resumo executivo
Dois temas principais: **(1)** pacing por dias úteis nas metas (manhã) e
**(2)** investigação + correção das **Atividades Atrasadas fantasma** (tarde),
incluindo a correção da raiz no `executeActivity`. Encerrado com verificações de
produção (deploy, dados) e ajuste de UX (tooltip de Leads abertos).

## Temas e PRs

### Tema A — Pacing por dias úteis (detalhe: `2026-06-15-dashboard-business-day-pacing.md`)
| PR | O quê |
|----|-------|
| #32 | Dashboard: todos os cards de meta migrados de dias corridos → dias úteis |
| #34 | Estatísticas: média diária (`avgPerDay`) blindada pra dias úteis |
| #35 | Card "Meta de Atividades Hoje" conectado na tela de Atividades (com fim de semana) |
| #33, #36 | Handoffs do tema |

### Tema B — Atividades Atrasadas fantasma (detalhe: `2026-06-15-overdue-activities-ghost-enrollments.md`)
| PR | O quê |
|----|-------|
| #37 | RPC `list_overdue_enrollments_brt` alinhado à fila (exclui auto_email, WhatsApp inválido, step já executado) + reconciliação dos 99 enrollments presos |
| #38 | **Raiz:** avanço de enrollment atômico/idempotente via RPC `advance_enrollment_after_step`; guard de idempotência reconcilia em vez de dar erro |
| #40 | Tooltip do card "Leads abertos" reescrito (mais didático) |
| #39, #41 | Handoff do tema + verificação pós-deploy |

## Causa-raiz (Tema B, resumo)
Dashboard contava o **estado do enrollment** (`next_step_due` vencido); a fila do
SDR esconde steps com interaction não-`failed` (`get_executed_steps`). Divergem
quando uma interaction é gravada **sem o enrollment avançar**. O `executeActivity`
avançava em ~5 round-trips JS após gravar a interaction; falha parcial deixava o
enrollment preso (77 steps de Pesquisa + 22 WhatsApp travados, quase todos do
Giovanni, cuja fila estava vazia). #37 tratou o sintoma + limpou os presos; #38
eliminou a origem (avanço atômico).

## Estado em produção (verificado)
- **Deploy Coolify confirmado**: Sentry release do build = `4ee3f19` (= merge do
  #41, HEAD da `main`); commit do tooltip (`86ae033`, #40) é ancestral → produção
  está no HEAD e inclui tudo (#37→#41).
- **Atividades Atrasadas pós-correção**: 0 fantasmas em todos os SDRs; Giovanni
  98→10 (os 10 são reais); total ~141, flutuando em tempo real.
- **Leads abertos = 616** confirmado batendo com o RPC `count_leads_opened_by_sdr`
  (1º contato humano por lead, uma vez, no mês, creditado ao SDR dono).
- RPCs aplicados em produção via MCP (migrations não sobem pelo Coolify — só código).

## Definição "Leads abertos" (apurada no RPC, pra referência)
Lead conta no mês do seu **1º contato humano** (`type IN ('sent','delivered')`,
`channel IN ('phone','whatsapp','email','linkedin','research')`), uma vez por lead,
creditado ao `assigned_to` atual. **Não conta:** notas importadas (`is_note=true`),
arquivados, sem responsável, canais `crm`/`system`, e não-contatos (abertura/clique/
resposta). Pesquisa **conta**. ≠ avanço de cadência (é interaction-based).

## Limpezas feitas
- Tabela de backup `public._overdue_reconcile_backup_20260615` **dropada** após
  rechecar saúde dos 99 reconciliados (99/99 avançados, 0 regrediram).

## Pendências (fora desta sessão)
- **Rotação do `CRON_SECRET`** — PENDENTE. Não trocar no Coolify antes do
  verificador multivalor `feat/cron-secret-multivalue` estar mergeado/no ar
  (senão 401 em todos os ~21 crons).

## Processo / infra (relembrar)
- Repo `Mercantes/EnriqueceAI-pro` é **redirect** pra `v4amaraltech/EnriqueceAI-pro`
  (público). Usar `--repo v4amaraltech/EnriqueceAI-pro` no `gh`. Nunca commitar segredos.
- **Coolify auto-deploy**: merge na `main` dispara build/deploy do código sozinho.
  Migrations Supabase **não** sobem por aí — aplicar via MCP/CLI à parte.
- CI obrigatório: `Lint · Typecheck · Test · Build` (~3m30s–4m), roda em todo PR.
