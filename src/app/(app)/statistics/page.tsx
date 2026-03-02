import Link from 'next/link';

import { Activity, ArrowRight, BarChart3, Phone, Users } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { fetchStatisticsData } from '@/features/reports/actions/fetch-statistics';
import { StatisticsView } from '@/features/reports/components/StatisticsView';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';

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
    title: 'Feedback de Oportunidade',
    description: 'Funil de conversão e análise por cadência.',
    href: '/statistics/conversion',
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
  searchParams: Promise<{ period?: string; user?: string; threshold?: string }>;
}

export default async function StatisticsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const period = params.period ?? '30d';
  const userFilter = params.user;
  const threshold = params.threshold ? parseInt(params.threshold, 10) : 60;

  const userIds = userFilter ? [userFilter] : undefined;

  const [result, members] = await Promise.all([
    fetchStatisticsData(period, userIds, threshold),
    fetchOrgMembers(),
  ]);

  return (
    <div className="space-y-6 p-6">
      {/* Navigation cards */}
      <div>
        <h1 className="text-2xl font-bold">Estatísticas</h1>
        <p className="mb-4 text-sm text-[var(--muted-foreground)]">
          Visão geral e acesso rápido às análises detalhadas.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statisticsPages.map((page) => (
            <Link key={page.href} href={page.href}>
              <Card className="transition-colors hover:border-[var(--primary)]">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">{page.title}</CardTitle>
                  <page.icon className="h-4 w-4 text-[var(--muted-foreground)]" />
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-[var(--muted-foreground)]">{page.description}</p>
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

async function fetchOrgMembers(): Promise<{ userId: string; email: string }[]> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) return [];

  const { data: members } = (await supabase
    .from('organization_members')
    .select('user_id, user_email')
    .eq('org_id', member.org_id)
    .eq('status', 'active')) as { data: { user_id: string; user_email: string }[] | null };

  return (members ?? []).map((m) => ({ userId: m.user_id, email: m.user_email }));
}
