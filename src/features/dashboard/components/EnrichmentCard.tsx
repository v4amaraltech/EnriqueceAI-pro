'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Progress } from '@/shared/components/ui/progress';

import type { EnrichmentStats } from '../dashboard.contract';

interface EnrichmentCardProps {
  stats: EnrichmentStats;
}

export function EnrichmentCard({ stats }: EnrichmentCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Enriquecimento</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Success rate */}
        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Taxa de sucesso</span>
            <span className="font-medium">{stats.successRate}%</span>
          </div>
          <Progress value={stats.successRate} className="h-2" />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <StatItem label="Enriquecidos" value={stats.enriched} color="text-green-600 dark:text-green-400" />
          <StatItem label="Pendentes" value={stats.pending} color="text-yellow-600 dark:text-yellow-400" />
          <StatItem label="Falharam" value={stats.failed} color="text-red-600 dark:text-red-400" />
          <StatItem label="Não encontrados" value={stats.notFound} color="text-orange-600 dark:text-orange-400" />
        </div>
      </CardContent>
    </Card>
  );
}

function StatItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{label}</p>
    </div>
  );
}
