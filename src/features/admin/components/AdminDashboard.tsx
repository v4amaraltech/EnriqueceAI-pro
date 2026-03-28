import { Building2, Contact, FlaskConical, Users } from 'lucide-react';

import { MetricCard } from '@/features/dashboard/components/MetricCard';
import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';

import { formatDate } from '@/lib/utils/format';

import type { AdminDashboardData } from '../types';

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  active: { label: 'Ativo', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  trialing: { label: 'Trial', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  past_due: { label: 'Inadimplente', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  canceled: { label: 'Cancelado', className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
};

function StatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return <Badge variant="outline" className="text-muted-foreground">Sem plano</Badge>;
  }
  const style = STATUS_STYLES[status];
  if (!style) {
    return <Badge variant="outline">{status}</Badge>;
  }
  return <Badge className={style.className}>{style.label}</Badge>;
}

export function AdminDashboard({ data }: { data: AdminDashboardData }) {
  const { metrics, organizations } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard Admin</h1>
        <p className="text-sm text-muted-foreground">
          Visão geral de todas as organizações do EnriqueceAI.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Organizações" value={metrics.totalOrgs} icon={Building2} />
        <MetricCard title="Membros Ativos" value={metrics.totalMembers} icon={Users} />
        <MetricCard title="Leads" value={metrics.totalLeads} icon={Contact} />
        <MetricCard title="Trials Ativos" value={metrics.activeTrials} icon={FlaskConical} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organizações</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Membros</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead>Criada em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Nenhuma organização encontrada.
                  </TableCell>
                </TableRow>
              ) : (
                organizations.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">{org.name}</TableCell>
                    <TableCell>{org.plan_name ?? '—'}</TableCell>
                    <TableCell>
                      <StatusBadge status={org.subscription_status} />
                    </TableCell>
                    <TableCell className="text-right">{org.members_count}</TableCell>
                    <TableCell className="text-right">{org.leads_count}</TableCell>
                    <TableCell>{formatDate(org.created_at)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
