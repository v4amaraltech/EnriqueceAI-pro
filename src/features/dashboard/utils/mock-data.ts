import type {
  DashboardData,
  DailyDataPoint,
  InsightsData,
  RankingData,
} from '../types';

// ── DEMO FLAG ────────────────────────────────────────────────────────────────
// Set to false (or delete this file) when real data is available
export const USE_MOCK_DATA = true;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getDaysInMonth(month: string): number {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return new Date(year, mon, 0).getDate();
}

function generateDailyData(month: string): DailyDataPoint[] {
  const days = getDaysInMonth(month);
  const currentDay = new Date().getDate();
  const target = 50; // monthly target
  const points: DailyDataPoint[] = [];

  let cumulative = 0;
  // Realistic daily new opportunities (varies between 0-4 per day)
  const dailyValues = [
    2, 1, 3, 0, 2, 1, 2, 3, 1, 0,
    2, 3, 1, 2, 4, 1, 0, 2, 3, 1,
    2, 1, 3, 2, 0, 3, 1, 2, 1, 2, 1,
  ];

  for (let day = 1; day <= days; day++) {
    const dailyTarget = Math.round((target / days) * day);
    if (day <= currentDay) {
      cumulative += dailyValues[(day - 1) % dailyValues.length]!;
    }
    points.push({
      date: `${month}-${String(day).padStart(2, '0')}`,
      day,
      actual: cumulative,
      target: dailyTarget,
    });
  }

  return points;
}

// ── Mock Data Generators ─────────────────────────────────────────────────────

export function getMockDashboardData(): DashboardData {
  const month = getCurrentMonth();
  const dailyData = generateDailyData(month);
  const currentDay = new Date().getDate();
  const daysInMonth = getDaysInMonth(month);
  const totalOpportunities = dailyData.find((d) => d.day === currentDay)?.actual ?? 0;
  const expectedByNow = Math.round((50 / daysInMonth) * currentDay);
  const percentOfTarget = expectedByNow > 0
    ? Math.round(((totalOpportunities - expectedByNow) / expectedByNow) * 100)
    : 0;

  return {
    kpi: {
      totalOpportunities,
      monthTarget: 50,
      conversionTarget: 25,
      percentOfTarget,
      currentDay,
      daysInMonth,
      dailyData,
    },
    availableCadences: [
      { id: 'cad-1', name: 'Prospecção Fria - SaaS' },
      { id: 'cad-2', name: 'Follow-up Inbound' },
      { id: 'cad-3', name: 'Reativação Clientes Q4' },
      { id: 'cad-4', name: 'ABM Enterprise' },
    ],
  };
}

export function getMockRankingData(): RankingData {
  return {
    leadsFinished: {
      total: 87,
      monthTarget: 100,
      percentOfTarget: 12,
      averagePerSdr: 22,
      sdrBreakdown: [
        { userId: 'u-1', userName: 'Rafael Mendes', value: 32, secondaryValue: 15 },
        { userId: 'u-2', userName: 'Carolina Lima', value: 28, secondaryValue: 12 },
        { userId: 'u-3', userName: 'Thiago Santos', value: 18, secondaryValue: 8 },
        { userId: 'u-4', userName: 'Juliana Costa', value: 9, secondaryValue: 22 },
      ],
    },
    activitiesDone: {
      total: 342,
      monthTarget: 400,
      percentOfTarget: 8,
      averagePerSdr: 86,
      sdrBreakdown: [
        { userId: 'u-1', userName: 'Rafael Mendes', value: 124 },
        { userId: 'u-2', userName: 'Carolina Lima', value: 98 },
        { userId: 'u-3', userName: 'Thiago Santos', value: 72 },
        { userId: 'u-4', userName: 'Juliana Costa', value: 48 },
      ],
    },
    conversionRate: {
      total: 18,
      monthTarget: 25,
      percentOfTarget: -15,
      averagePerSdr: 18,
      sdrBreakdown: [
        { userId: 'u-1', userName: 'Rafael Mendes', value: 24 },
        { userId: 'u-2', userName: 'Carolina Lima', value: 21 },
        { userId: 'u-3', userName: 'Thiago Santos', value: 14 },
        { userId: 'u-4', userName: 'Juliana Costa', value: 11 },
      ],
    },
  };
}

export function getMockInsightsData(): InsightsData {
  return {
    lossReasons: [
      { reason: 'Sem interesse', count: 23, percent: 29 },
      { reason: 'Sem budget', count: 18, percent: 23 },
      { reason: 'Sem resposta', count: 15, percent: 19 },
      { reason: 'Timing ruim', count: 11, percent: 14 },
      { reason: 'Concorrente escolhido', count: 8, percent: 10 },
      { reason: 'Outros', count: 4, percent: 5 },
    ],
    conversionByOrigin: [
      { origin: 'Outbound', converted: 18, lost: 42 },
      { origin: 'Inbound Marketing', converted: 12, lost: 8 },
      { origin: 'LinkedIn', converted: 7, lost: 5 },
      { origin: 'Indicação', converted: 5, lost: 1 },
      { origin: 'Site', converted: 3, lost: 2 },
    ],
  };
}
