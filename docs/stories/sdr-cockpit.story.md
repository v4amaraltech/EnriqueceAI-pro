# Story: Cockpit do SDR — 5 abas (Tarefas do dia, Meus Leads, Dashboard, Histórico de Metas, Closers)

**Status:** InProgress
**Tipo:** Feature / UI / SDR
**Origem:** Vini (06/11/2026) — telas de referência do novo menu "Cockpit".
**Relacionada:** `whatsapp-evolution-paced-sending` — o Cockpit do WhatsApp automático (critérios 12–14 daquela story) vira um **card na aba Tarefas do dia** desta story.
**Estimativa:** L (6 a 8 dias úteis). Cinco PRs, um por fase.

## Problema
O SDR hoje pula entre `/atividades`, `/leads`, `/dashboard` e configurações para saber o que fazer, como está a carteira e como está a meta. O gestor não tem uma tela única para ver um SDR específico. Não existe controle de quais closers aparecem na hora de agendar reunião.

## Valor
- Uma tela só ("casa do SDR") com o dia, a carteira, a meta e os closers.
- Gestor escolhe um SDR e vê exatamente o que ele vê.
- Gestor controla quais closers recebem agendamento.

## Decisões do Vini (06/11/2026)
1. Construir as 5 abas com dados reais.
2. O painel do WhatsApp automático vira um card na aba Tarefas, ao lado de "Meu progresso"; as abas de canal funcionam como filtro.
3. Gestor escolhe o SDR (seletor no topo). SDR vê só os próprios dados.
4. Abas de canal só com os canais que existem: Todas, Ligação, WhatsApp, E-mail, LinkedIn, Pesquisa. Reunião online, Instagram e Visita ficam fora.
5. Etapa do lead é **calculada** a partir dos campos existentes (sem coluna nova).
6. Tier e Temperatura calculados dos dados.
7. Closers: nova coluna `closers.scheduling_enabled` com toggle (só gestor muda); só habilitados aparecem no agendamento.

## Escopo
**IN**
- `/cockpit` com abas por `?tab=` e seletor de SDR (`?sdr=`) só para gestor.
- **Tarefas do dia:** card Meu progresso, card WhatsApp automático, abas de canal com contagem, busca, tabela (Horário, Tarefa, Cadência "Dia N · Tarefa X", Lead, Origem, Ações), paginação, Nova tarefa (retorno agendado).
- **Meus Leads:** cards de carteira por etapa + tabela (Lead, Etapa, Tipo, Origem, Tier, Segmento, Temperatura, Última atualização, Ver).
- **Dashboard:** métricas do SDR escolhido, reaproveitando o `/dashboard`.
- **Histórico de Metas:** meta do mês de reuniões realizadas, progresso, cronômetro até o fim do mês, realizadas/agendadas/no-show, lista de reuniões realizadas com busca, navegação por mês.
- **Closers:** faixa "X de Y habilitados", tabela por closer no mês (reuniões, agendadas, no-show, realizadas, canceladas com %), toggle de habilitação.

**OUT**
- Canais novos (Reunião online, Instagram, Visita).
- Coluna de etapa persistida no lead.
- Tarefa avulsa sem lead.

## Regras de cálculo
- **Etapa** (prioridade de cima para baixo):
  1. Reunião realizada (SAL): `meeting_held_at` ou `won_at`
  2. No Show: `meeting_no_show_at`
  3. Reunião agendada (SQL): `meeting_scheduled_at`
  4. Desqualificado: `status` em `unqualified`/`archived` ou `lost_at`
  5. Conexão estabelecida: ligação conectada ou resposta registrada
  6. Tentativa de conexão: `status = contacted`
  7. Entrada: `status = new`
- **Temperatura:** Quente = resposta ou reunião nos últimos 7 dias; Morno = interação nos últimos 21 dias; Frio = o resto.
- **Tier:** mesma regra das funções SQL `calculate_tier_from_faturamento` / `calculate_tier_from_faixa`.

## Critérios de aceite
1. **Dado** um SDR logado, **quando** abre `/cockpit`, **então** vê só os próprios dados em todas as abas, mesmo passando `?sdr=` de outro SDR.
2. **Dado** um gestor, **quando** escolhe um SDR no seletor, **então** todas as abas mostram os dados desse SDR.
3. **Dado** a aba Tarefas, **então** a contagem de cada aba de canal bate com a fila de `/atividades` filtrada pelo mesmo SDR, e clicar numa aba filtra a tabela.
4. **Dado** a aba Tarefas, **quando** o SDR clica em executar, **então** abre o mesmo painel de execução de `/atividades`.
5. **Dado** a aba Tarefas, **então** o card do WhatsApp automático mostra o número do SDR (conectado, limite, fila, pausado) com Pausar/Retomar.
6. **Dado** a aba Meus Leads, **então** a soma dos cards de carteira é igual ao total de leads do SDR, e a etapa de cada linha segue as regras acima.
7. **Dado** a aba Histórico de Metas, **então** realizadas e agendadas batem com a seção "SDR selecionado" do `/dashboard` para o mesmo mês.
8. **Dado** um gestor na aba Closers, **quando** desliga um closer, **então** ele deixa de aparecer no modal de agendar reunião; um SDR não consegue mudar o toggle.
9. `pnpm typecheck`, `pnpm lint`, `pnpm test:run` e `pnpm build` passam.

## Riscos
- Contagem por etapa em 1.400+ leads: feita no banco (RPC), não no navegador.
- Regras de Temperatura/Tier são novas: podem precisar de ajuste depois do uso.

## Tasks
- [x] Fase 1 — esqueleto `/cockpit` (abas, seletor de SDR, escopo seguro) + aba Tarefas do dia.
- [x] Fase 2 — aba Meus Leads (etapa, tier, temperatura, RPC de contagem). Migration `20261107032423` aplicada em prod 07/11.
- [x] Fase 3 — aba Dashboard.
- [x] Fase 4 — aba Histórico de Metas.
- [x] Fase 5 — aba Closers + migration `scheduling_enabled` + filtro no agendamento. Migration `20261107032426` aplicada em prod 07/11 + `pnpm gen:types`.
- [x] Aplicar as 2 migrations em prod (OK do Vini 07/11), `pnpm gen:types`, conferir cards de etapa no preview (soma = 1.561 leads do Matheus).
- [ ] Testar o liga/desliga de um closer na tela (não testado: escrita em produção bloqueada na sessão) e conferir que some do modal de agendar reunião.
- [ ] Depois do merge do PR #514: rebase em `origin/main`, checagens completas, abrir PR(s) a partir de `feat/sdr-cockpit`.

## Dev Notes
- Plano: `/Users/mercante/.claude/plans/referencias-de-telas-do-cryptic-shamir.md`.
- Branch: `feat/sdr-cockpit` (worktree `EnriqueceAI_Pro-wa-paced`), criada a partir de `feat/whatsapp-cockpit` (PR #514). Não commitar na branch do #514.
- A regra de quem pausa o WhatsApp automático não mudou (`setAutoSendPaused`, `fetchCockpit`, `cockpit-summary` só reutilizados).

### Decisões do dev
- Etapa calculada **só no banco** (`cockpit_lead_stages` / `count_cockpit_lead_stages`, SECURITY INVOKER): uma regra só para cards e linhas, em vez de função TS + SQL.
- "Conexão estabelecida" usa a mesma regra de `features/calls/connection.ts` (não-voicemail, `answered_at`, >= 50s) ou resposta registrada.
- Tier: lê o campo `tier_output` gravado pelo trigger; sem ele, calcula do `faturamento_estimado` com a cópia fiel de `calculate_tier_from_faturamento`.
- Aba Tarefas: o botão verde "concluir" da referência ficou de fora; executar abre o mesmo painel de `/atividades` (é onde se registra o resultado e o "Enviado manualmente"). Menu ⋮: pular passo, trocar cadência, ignorar, perdido.
- `fetchPendingActivities` aceita `{ assignedTo }` para o gestor: o teto de 1500/100 vale para o SDR escolhido, não para a org.
- Aba Dashboard: só a seção "SDR selecionado" (meta individual). Os cards de KPI do /dashboard mostram meta do time e confundiam.
- Closers: reuniões do mês = leads com `meeting_starts_at` no mês por `closer_id` (realizada / no-show / ainda agendada) + eventos `meeting_cancelled` do mês. Só o modal de agendar reunião filtra `scheduling_enabled`; os outros usos de `listClosers` veem todos. Sem a migration a aba mostra todos habilitados com o toggle desligado.
- `/dashboard` continua deixando um SDR ver outro por `?sdr=` (fora do escopo); no Cockpit o SDR sempre vê só ele (`pickCockpitTarget`).

## File List
- `src/app/(app)/cockpit/page.tsx`
- `src/features/cockpit/` — `types.ts`; `components/` (CockpitShell, TasksTab, NewTaskDialog, LeadsTab, DashboardTab, GoalsHistoryTab, ClosersTab, MonthNav); `services/` (resolve-cockpit-viewer, cockpit-leads, cockpit-goals, cockpit-closers); `utils/` (cockpit-target, task-filters, lead-insights, month, closer-stats + testes)
- `src/features/activities/utils/step-day.ts` (+ teste), `actions/fetch-pending-activities.ts`, `types/index.ts`
- `src/features/whatsapp-auto-send/components/WhatsAppAutoSendCard.tsx` (substitui `CockpitView.tsx`)
- `src/features/dashboard/components/SdrPaceSection.tsx` (`hideSelector`)
- `src/features/leads/schemas/lead.schemas.ts` (ordenar por `updated_at`)
- `src/features/settings-prospecting/actions/closers-crud.ts` (`onlySchedulable`, `setCloserSchedulingEnabled`)
- `src/features/integrations/components/ScheduleMeetingModal.tsx`
- `src/lib/supabase/types.ts` (gen:types)
- `supabase/migrations/20261107032423_cockpit_lead_stages.sql`, `supabase/migrations/20261107032426_closers_scheduling_enabled.sql`

## Change Log
- 06/11/2026 — Story criada (Draft) a partir das telas de referência e das 7 decisões do Vini.
- 06/11/2026 — Plano aprovado pelo Vini (vale como GO). @dev: 5 fases implementadas na branch `feat/sdr-cockpit` (Draft → InProgress). typecheck, lint, test:run (355 arquivos) e build passando. Migrations escritas, não aplicadas.
- 07/11/2026 — Migrations aplicadas em prod (versões 20261107032423 e 20261107032426, arquivos renomeados para bater) e tipos regenerados.
