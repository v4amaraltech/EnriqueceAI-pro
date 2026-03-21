'use client';

import { useState } from 'react';

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Button } from '@/shared/components/ui/button';

import type { RankingMetric, SdrRankingEntry } from '../types/team-analytics.types';

interface SdrRankingSectionProps {
  rankings: Record<RankingMetric, SdrRankingEntry[]>;
}

const TABS: { key: RankingMetric; label: string }[] = [
  { key: 'leads', label: 'Leads' },
  { key: 'activities', label: 'Atividades' },
  { key: 'calls', label: 'Ligações' },
  { key: 'conversion', label: 'Conversão' },
];

export function SdrRankingSection({ rankings }: SdrRankingSectionProps) {
  const [activeTab, setActiveTab] = useState<RankingMetric>('activities');
  const data = rankings[activeTab];

  return (
    <div>
      {/* Tabs */}
      <div className="mb-4 flex gap-1">
        {TABS.map((tab) => (
          <Button
            key={tab.key}
            variant={activeTab === tab.key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Chart */}
      {data.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Sem dados para este ranking.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(200, data.length * 45)}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 5, right: 40, bottom: 5, left: 0 }}
          >
            <XAxis type="number" tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
            <YAxis
              type="category"
              dataKey="userName"
              width={120}
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--popover)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              formatter={((value: number, _name: string, props: { payload: SdrRankingEntry }) =>
                [props.payload.label, 'Ranking']
              ) as never}
            />
            <Bar dataKey="value" fill="var(--primary)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
