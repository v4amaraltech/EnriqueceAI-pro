import Link from 'next/link';

import { Activity, ArrowRight, BarChart3, Phone, Users } from 'lucide-react';

import { fetchStatisticsData } from '@/features/reports/actions/fetch-statistics';
import { StatisticsView } from '@/features/reports/components/StatisticsView';
import { fetchOrgMembers } from '@/features/statistics/actions/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { parseDateRangeParams } from '@/shared/utils/date-range';

const statisticsPages = [
  {
    title: 'Ligação',
    description: 'Outcomes, duração, heatmap e análise por SDR.',
    href: '/statistics/calls',
    icon: Phone,
  },
  {
    title: 'Prospecção',
    description: 'Volume e performance de atividades por canal e tipo.',
    href: '/statistics/prospecting/activities',
    icon: Activity,
  },
  {
    title: 'Conversão',
    description: 'Funil de conversão e análise por cadência.',
    href: '/statistics/conversion',
    icon: BarChart3,
  },
  {
    title: 'Feedback de Oportunidade',
    description: 'Feedbacks dos closers sobre oportunidades enviadas.',
    href: '/statistics/feedback',
    icon: BarChart3,
  },
  {
    title: 'Equipe',
    description: 'Comparativo de performance e metas dos SDRs.',
    href: '/statistics/team',
    icon: Users,
  },
];

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; period?: string; user?: string; threshold?: string }>;
}

export default async function StatisticsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { from, to } = parseDateRangeParams(params);
  const dateRange = { from, to };
  const userFilter = params.user;
  const threshold = params.threshold ? parseInt(params.threshold, 10) : 60;

  const userIds = userFilter ? [userFilter] : undefined;

  const [result, members] = await Promise.all([
    fetchStatisticsData('30d', userIds, threshold, dateRange),
    fetchOrgMembers(),
  ]);

  return (
    <div className="space-y-6 p-6">
      {/* Navigation cards */}
      <div>
        <h1 className="text-2xl font-bold">Estatísticas</h1>
        <p className="mb-4 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Visão geral e acesso rápido às análises detalhadas.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statisticsPages.map((page) => (
            <Link key={page.href} href={page.href}>
              <Card className="transition-colors hover:border-[var(--primary)]">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">{page.title}</CardTitle>
                  <page.icon className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{page.description}</p>
                  <div className="mt-2 flex items-center text-xs font-medium text-[var(--primary)]">
                    Ver detalhes <ArrowRight className="ml-1 h-3 w-3" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Existing statistics (loss reasons, conversion, response time) */}
      {result.success && (
        <StatisticsView data={result.data} members={members} />
      )}

      {!result.success && (
        <p className="text-[var(--destructive)]">Erro: {result.error}</p>
      )}
    </div>
  );
}
