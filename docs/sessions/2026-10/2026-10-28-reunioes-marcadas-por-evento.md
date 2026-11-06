# 2026-10-28 — Card "Reuniões Marcadas" passa a contar cada marcação

**Pergunta:** João Fogaça tinha 10 reuniões marcadas no card e 11 na conta dele.

**Causa:** o card lia `leads.meeting_scheduled_at` (1 por lead, última marcação). A
VALENTE PLASTIC foi marcada em 09/10 (no-show em 15/10) e marcada de novo em 19/10
(realizada em 20/10): a segunda marcação sobrescreveu a primeira.

**Decisão (Vinicius):** contar cada marcação registrada na timeline
(`interactions.type = 'meeting_scheduled'`), 1 por lead por dia BRT, lead não
arquivado/deletado, atribuída ao responsável atual do lead (SDR ativo/convidado).

**Mudanças (branch `feat/meetings-scheduled-count-events`):**
- `src/features/dashboard/services/ranking-metrics.service.ts` — `fetchScheduledLeadsForRanking`
  lê eventos + leads (`chunkedIn`); helper `meetingStartFromEvent`.
- `src/features/dashboard/services/sdr-pace.service.ts` — seção "SDR selecionado" usa a mesma fonte.
- `src/features/dashboard/components/DashboardView.tsx`, `SdrPaceSection.tsx` — tooltips.
- `docs/guides/dashboard-cards.md` — definição do card.
- Testes: `ranking-metrics.service.test.ts`, `sdr-pace.service.test.ts`.

**Verificação:** typecheck, lint e 2709 testes OK. Rodando o código novo contra
produção (só leitura): outubro/2026 total 81 → 82; João 10 → 11; demais SDRs iguais.

**Fora do escopo:** Sales Hub segue contando 1 por lead (`leads_pv.data_reuniao_agendada`).

**Pendente:** commit, PR e deploy (a critério do Vinicius).
