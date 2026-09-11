# 18/08/2026 — Fila atrasada dos SDRs: ajuste estrutural das cadências + fix "Perdido" p/ SDR

## Pergunta inicial
"Meus SDRs sempre têm tarefas atrasadas — é a cadência sobrecarregando ou falha deles?"

## Diagnóstico (dados de produção)
- 433–493 tarefas atrasadas (90% ligação). Esforço não era o problema (~100 ligações/dia por SDR); a carga estrutural era: cadências geravam ~150 tarefas manuais/dia p/ o time, capacidade real ~30/dia por SDR.
- **Recovery** (619 ativos, 20 passos/132d): ZERO leads jamais completaram os 20 passos; desfechos reais acontecem no passo 3–6. Passos 9–20 só geravam fila fantasma.
- **Auto-loss 21d quase nunca disparava** (2 leads na história): critério é inatividade desde a última interaction — SDR ligando zera o relógio.
- **Ismael**: caso à parte — 100% do Inbound (149 leads) concentrado nele.

## Ações aplicadas (via MCP Supabase, sem PR — config de dados)
1. **Recovery `auto_loss_after_days` 21→14** (motivo "Deixou de responder"; cron `expire-inactive-leads` diário 4h BRT).
2. **Recovery encurtada 20→8 passos** — passos 9–20 apagados (zero interações neles); 60 enrollments além do p8 capados em 8/8 com `next_step_due=NULL` (decisão: não dar perdido em massa; auto-loss 14d decide). Backups: `_bkp_recovery_cut_steps_20260818`, `_bkp_recovery_cut_enrollments_20260818`. `total_steps=8`.
3. **Inbound espaçada nos passos 4–8**: delays 2,2,4,4,5 → 3,3,6,6,7 (19→27d; passos 1–3 intactos — speed-to-lead; Inbound converte ~23%, NÃO cortar passos).
4. **Inbound 2.0 pausada**; 25 leads (passo 1, nunca trabalhados) migrados p/ Inbound normal, escalonados ~5/dia. Backup: `_bkp_inbound20_migration_20260818`.
   (Sessão paralela do mesmo dia já havia encerrado 73 enrollments antigos do Inbound → E-mail auto.)

## Resultado (fila projetada, tarefas/dia)
Giovanni 46→22,4 · Guilherme 43,9→23,5 · Matheus 37,8→15,8 · João 19,5→11,4 · Ismael 31,8→22,1. Todos abaixo da capacidade (~30/dia).

## Fix "Perdido" p/ SDR (PR #338 — NO AR `f214abd3`)
- Bug reportado pelo Ismael: lista de leads → ⋯ → Perdido dava "só gestor"; tela do lead funcionava.
- Causa: auditoria #334 travou `bulkMarkLeadsLost` p/ manager, mas o menu de linha usa essa action com 1 id.
- Fix: trava só se `leadIds.length > 1`. CI verde, squash-merge, deploy confirmado via `/api/version`, Ismael avisado por e-mail.

## Follow-ups
- **Remedição agendada**: tarefa `remedir-atrasadas-sdrs-25ago` (25/08 9h) — compara atrasadas com a linha de base (~493).
- Alinhar uso da fila com Guilherme/Giovanni (ligação avulsa não baixa tarefa: ~100 ligações/dia vs 5–14 passos concluídos).
- Se Inbound crescer, redistribuir entrada de leads (hoje 100% no Ismael).
- Reverter espaçamento do Inbound se conversão cair: delays antigos s4=2, s5=2, s6=4, s7=4, s8=5.
