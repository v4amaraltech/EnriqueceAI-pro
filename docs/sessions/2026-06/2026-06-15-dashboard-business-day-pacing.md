# Handoff — 2026-06-15: Pacing por dias úteis (dashboard + estatísticas)

## Contexto
Sessão na V4 Company Amaral (org `c2727473-1df8-4faa-9264-a9fc1759fe3b`).
O gestor perguntou se o número **"Esperado Hoje"** do card "Leads abertos"
(Visão geral) contava dias úteis ou também sábado/domingo. A correção depois se
estendeu pras estatísticas e pra um card de meta diária.

> **Status final: resolvido e em produção, em 3 PRs.**
> - **PR #32** (`71a39e0`) — pacing de **todos** os cards de meta do **dashboard**
>   migrado de dias corridos → dias úteis (seg–sex, BRT). Verificado em produção.
> - **PR #34** (`3515d7a`) — média diária de atividades das **estatísticas**
>   (`avgPerDay`/`goalAchievement`) blindada pra dias úteis.
> - **PR #35** (`58d8614`) — card **"Meta de Atividades Hoje"** (antes órfão)
>   conectado na tela de Atividades, com tratamento de fim de semana.
>
> Tudo na `main`, auto-deploy Coolify.

## Diagnóstico

O "esperado até hoje", a linha tracejada **Meta** e o **"% acima/abaixo do
ritmo"** dividiam a meta mensal por **dias corridos** (incluindo fim de semana):

```
esperado = meta_mensal / dias_do_mês × dia_atual
```

Como os SDRs não abrem leads/marcam reunião no fim de semana, a régua subia
todo sáb/dom sem ninguém trabalhando — inflando o gap e fazendo o time parecer
atrasado quando não estava. Ex. junho/2026: dia 15 mostrava esperado 750 de
1500 (`1500/30×15`), com 4 dos 15 dias decorridos sendo fim de semana.

O codebase **já tinha** um helper de dias úteis (`businessDays` no
`DashboardView.tsx` e `effectiveDueDate`/`hoursOverdue` em
`activities/utils/overdue.ts`), mas só era usado pra média de atividades e
overdue — **não** pro pacing das metas.

## Decisão (do gestor)
Aplicar o pacing por dias úteis a **todos os cards de meta**, não só ao "Leads
abertos". Motivo: os trechos de cálculo são **compartilhados** entre os cards
(Leads abertos, Reuniões marcadas, Reuniões realizadas, % dos rankings) — fazer
só um geraria inconsistência visual entre cards irmãos e daria mais trabalho
(isolar) do que corrigir todos (helper único).

## Correção (PR #32)

Novo helper puro compartilhado `src/features/dashboard/utils/pacing.ts`:
- `businessDaysThrough(year, month1, throughDay)` — conta seg–sex de 1..throughDay.
- `businessDaysInMonth(year, month1)` — total de dias úteis do mês.
- `expectedByBusinessDay(target, year, month1, throughDay)` —
  `target × diasÚteisDecorridos / diasÚteisDoMês`. Retorna 0 se target ≤ 0;
  mês já encerrado devolve o target cheio (mantém comportamento anterior).
- Pure TS, sem deps server-only → seguro pra client component **e** server.
- BRT é fixo UTC-3 (sem DST desde 2019), então o dia-da-semana sai do calendário
  UTC direto, sem lib de timezone.

Plugado nos **três** pontos de pacing pra "esperado" e linha Meta nunca
discordarem:
- `services/ranking-metrics.service.ts` — `computePercentOfTarget` (% do ritmo,
  compartilhado por todos os rankings) + linha Meta diária de **Leads abertos**
  (`fetchLeadsOpenedDaily`) e **Reuniões marcadas** (`fetchMeetingsScheduledRanking`).
- `services/dashboard-metrics.service.ts` — `computeDailyData` + `expectedByToday`
  de **Reuniões realizadas** (`fetchOpportunityKpi`).
- `components/OpportunityKpiCard.tsx` — texto `expectedByNow` ("esperado até hoje"),
  derivando ano/mês do prop `month`.

Cards baseados em **taxa** (Conversão, Hit Rate) não usam pacing por dia e não
foram tocados. Efeito visual: a linha Meta agora fica **plana no fim de semana**.

## Verificação em produção (dashboard, dia 15)
- Tooltip do gráfico **Dia 14 → Meta 682** = `1500 × 10/22` (10 dias úteis até o
  dia 14). No cálculo antigo daria 700 (`1500/30×14`) → confirma código novo no ar.
- "esperado até hoje: 750" (dia 15) = `1500 × 11/22` — **coincide** com o antigo
  (`1500/30×15`) só nesse dia; diverge nos demais.
- "22% abaixo do ritmo" = `(588 − 750)/750` ✓.

## Testes
- `src/features/dashboard/utils/pacing.test.ts` (novo, 7 testes) — cobre o helper
  (junho/2026: 22 dias úteis; fev/2026: 20; flat no fim de semana; mês cheio = target).
- `dashboard-metrics.service.test.ts` — asserções de `target` diário atualizadas
  pro pace por dias úteis (fev/2026, 1º = domingo → target 0/1/3 nos dias 1/2/3).
- CI `Lint·Typecheck·Test·Build` ✅ (3m36s). `pnpm typecheck/lint/build` locais ✅.

## Extensão — estatísticas (PR #34, `3515d7a`)
O gestor pediu pra aplicar o pacing nas estatísticas também. **Achado
importante:** as estatísticas **não têm** régua de "esperado/ritmo/Meta" visível
como o dashboard. O único cálculo por dia corrido que é pacing é a **média
diária de atividades** (`avgPerDay`/`goalAchievement`) em
`activity-analytics.service.ts` (`calculateKpis`), que dividia o total por dias
corridos — achatando a média contra uma meta que é por dia útil.

- Novo helper compartilhado `businessDaysBetween(start, end)` em
  `dashboard/utils/pacing.ts` — conta seg–sex (BRT) num **intervalo arbitrário**
  (não só mês), clamp ≥ 1 pra ser divisor seguro. (`businessDaysThrough` é
  month-scoped; estatísticas usam range, daí a função nova.)
- `calculateKpis` passou a receber `periodEnd` e dividir por dias úteis
  decorridos, com janela limitada a "agora".
- Import cross-feature `@/features/dashboard/utils/pacing` (segue precedente:
  `ranking-metrics` importa de `activities/utils/overdue`).
- **Decisão do gestor:** "blindar o cálculo existente". Esses campos **não eram
  exibidos** (o `GoalAchievementCard` estava órfão) → correção sem efeito visível
  na hora; o PR #35 abaixo passou a exibir.
- **Não tocados** (não são pacing): idade de lead por quartil (bucketing,
  `activity-analytics:312`) e dias-até-qualificação (velocidade retrospectiva,
  `conversion-analytics:217`).

## Extensão — card de meta diária (PR #35, `58d8614`)
O gestor pediu pra **exibir** a meta. O `GoalAchievementCard`
("Meta de Atividades Hoje") já existia mas estava desconectado — foi conectado
na `ActivityAnalyticsView` (aparece em `/statistics/activities` e no embed da
prospecção), alimentado pelo `data.goal` (atividades de **hoje** vs meta diária).

- O card é **de hoje** (snapshot do dia), independente do filtro de período da
  página — por isso o título diz "Hoje".
- **Fim de semana:** `GoalData` ganhou flag `isWeekend` (BRT). Sáb/dom o card
  mostra a contagem feita **sem** o vermelho "0% da meta" ("Sem meta hoje — fim
  de semana") — coerente com o pacing por dias úteis. SDR não tem meta no fim de
  semana.
- Possível evolução (não pedida): fazer o card acompanhar o período filtrado em
  vez de só "hoje".

## Arquivos
**Dashboard (PR #32):**
- `src/features/dashboard/utils/pacing.ts` — helper novo (`expectedByBusinessDay`,
  `businessDaysThrough`, `businessDaysInMonth`; `businessDaysBetween` add no #34).
- `src/features/dashboard/utils/pacing.test.ts` — testes.
- `src/features/dashboard/services/ranking-metrics.service.ts` — pacing dias úteis.
- `src/features/dashboard/services/dashboard-metrics.service.ts` — pacing dias úteis.
- `src/features/dashboard/components/OpportunityKpiCard.tsx` — `expectedByNow`.
- `src/features/dashboard/services/dashboard-metrics.service.test.ts` — asserções.

**Estatísticas (PR #34):**
- `src/features/dashboard/utils/pacing.ts` (+ `.test.ts`) — `businessDaysBetween`.
- `src/features/statistics/services/activity-analytics.service.ts` — `calculateKpis`
  por dias úteis (+ `periodEnd`).

**Card de meta (PR #35):**
- `src/features/statistics/types/activity-analytics.types.ts` — `GoalData.isWeekend`.
- `src/features/statistics/services/activity-analytics.service.ts` — `calculateGoal`
  seta `isWeekend`.
- `src/features/statistics/components/GoalAchievementCard.tsx` — branch de fim de semana.
- `src/features/statistics/components/ActivityAnalyticsView.tsx` — render do card.

## Processo / infra (relembrar)
- Repo `Mercantes/EnriqueceAI-pro` é **redirect** pra `v4amaraltech/EnriqueceAI-pro`.
  Usar `--repo v4amaraltech/EnriqueceAI-pro` no `gh`.
- **Coolify auto-deploy**: merge na `main` dispara build/deploy sozinho
  (mudança só de código, sem env var). Conferir na aba **Deployments** (~1-2 min).
  Mudança de **env var** NÃO dispara auto-deploy → exige **Redeploy** manual.

## Pendências (fora desta sessão)
- **Rotação do `CRON_SECRET`** segue PENDENTE (não trocar no Coolify antes de
  mergear/deployar o verificador multivalor `feat/cron-secret-multivalue`).
