'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';

interface DistributionCardProps {
  title: string;
  data: Record<string, number>;
  maxItems?: number;
}

export function DistributionCard({ title, data, maxItems = 8 }: DistributionCardProps) {
  const entries = Object.entries(data)
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxItems);

  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Sem dados disponíveis</p>
        </CardContent>
      </Card>
    );
  }

  // Color palette for bars
  const colors = [
    'bg-red-400',
    'bg-green-500',
    'bg-yellow-500',
    'bg-red-600',
    'bg-pink-500',
    'bg-red-300',
    'bg-orange-500',
    'bg-teal-500',
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {entries.map(([label, count], i) => {
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <div key={label} className="text-sm">
                <div className="mb-0.5 flex items-center justify-between">
                  <span>{label}</span>
                  <span className="text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                    {count} ({pct}%)
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-[var(--muted)]">
                  <div
                    className={`h-2 rounded-full ${colors[i % colors.length]}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
