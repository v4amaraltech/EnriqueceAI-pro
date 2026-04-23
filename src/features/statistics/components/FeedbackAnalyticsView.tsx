'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Clock, MessageSquare, Star, Send, Users, ThumbsUp } from 'lucide-react';
import Link from 'next/link';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { DateRangePicker } from '@/shared/components/DateRangePicker';

import type { FeedbackAnalyticsData } from '../types/feedback-analytics.types';

interface FeedbackAnalyticsViewProps {
  data: FeedbackAnalyticsData;
  filters: {
    closer?: string;
    dateRange: { from: string; to: string };
  };
}

const ALL_VALUE = '__all__';

function KpiCard({ label, value, icon: Icon, subtitle }: { label: string; value: string; icon: React.ElementType; subtitle?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-[var(--muted-foreground)]">{label}</p>
        <Icon className="h-4 w-4 text-[var(--muted-foreground)]" />
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {subtitle && <p className="text-xs text-[var(--muted-foreground)] mt-1">{subtitle}</p>}
    </div>
  );
}

function RatingStars({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-xs text-[var(--muted-foreground)]">—</span>;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i <= rating ? 'fill-amber-400 text-amber-400' : 'text-[var(--muted-foreground)] opacity-30'}`}
        />
      ))}
      <span className="ml-1 text-xs text-[var(--muted-foreground)]">{rating}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: 'responded' | 'pending' | 'expired' }) {
  const styles = {
    responded: 'bg-emerald-500/10 text-emerald-600',
    pending: 'bg-amber-500/10 text-amber-600',
    expired: 'bg-red-500/10 text-red-500',
  };
  const labels = { responded: 'Respondido', pending: 'Pendente', expired: 'Expirado' };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

export function FeedbackAnalyticsView({ data, filters }: FeedbackAnalyticsViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { kpis, feedbacks, closerRanking } = data;

  const statusFilter = searchParams.get('status') ?? '';

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== ALL_VALUE) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`/statistics/feedback?${params.toString()}`);
    },
    [router, searchParams],
  );

  const filteredFeedbacks = statusFilter
    ? feedbacks.filter((f) => f.status === statusFilter)
    : feedbacks;

  const recentComments = feedbacks
    .filter((f) => f.comment?.trim())
    .slice(0, 10);

  const closerOptions = [...new Map(feedbacks.map((f) => [f.closerId, f.closerName])).entries()];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-[var(--muted-foreground)]">Estatísticas &gt; Feedback de Oportunidade</p>
          <h1 className="text-2xl font-bold">Feedback de Oportunidade</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Análise dos feedbacks dos closers sobre oportunidades enviadas.</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker
            from={filters.dateRange.from}
            to={filters.dateRange.to}
            onChange={(from, to) => {
              const params = new URLSearchParams(searchParams.toString());
              params.set('from', from);
              params.set('to', to);
              router.push(`/statistics/feedback?${params.toString()}`);
            }}
          />
          {closerOptions.length > 1 && (
            <Select
              value={filters.closer ?? ALL_VALUE}
              onValueChange={(v) => updateFilter('closer', v)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Closer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Todos os closers</SelectItem>
                {closerOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select
            value={statusFilter || ALL_VALUE}
            onValueChange={(v) => updateFilter('status', v)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todos status</SelectItem>
              <SelectItem value="responded">Respondido</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="expired">Expirado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Enviados" value={String(kpis.totalSent)} icon={Send} />
        <KpiCard
          label="Taxa de Resposta"
          value={`${kpis.responseRate}%`}
          icon={ThumbsUp}
          subtitle={`${kpis.totalResponded} respondidos · ${kpis.pendingCount} pendentes`}
        />
        <KpiCard
          label="Rating Médio"
          value={kpis.averageRating != null ? `${kpis.averageRating}/5` : '—'}
          icon={Star}
        />
        <KpiCard
          label="Tempo Médio Resposta"
          value={kpis.averageResponseTimeHours != null ? `${kpis.averageResponseTimeHours}h` : '—'}
          icon={Clock}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Closer Ranking */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-4 w-4 text-[var(--muted-foreground)]" />
            <h2 className="font-semibold">Ranking Closers</h2>
          </div>
          {closerRanking.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">Sem dados no período.</p>
          ) : (
            <div className="space-y-3">
              {closerRanking.map((c) => (
                <div key={c.closerId} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{c.closerName}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {c.totalReceived} recebidos · {c.responseRate}% respondidos
                    </p>
                  </div>
                  <RatingStars rating={c.averageRating} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Comments */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare className="h-4 w-4 text-[var(--muted-foreground)]" />
            <h2 className="font-semibold">Comentários Recentes</h2>
          </div>
          {recentComments.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">Nenhum comentário no período.</p>
          ) : (
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {recentComments.map((f) => (
                <div key={f.id} className="border-b border-[var(--border)] pb-3 last:border-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{f.closerName}</span>
                      <span className="text-xs text-[var(--muted-foreground)]">→</span>
                      <Link href={`/leads/${f.leadId}`} className="text-sm text-[var(--primary)] hover:underline">
                        {f.leadName}
                      </Link>
                    </div>
                    <RatingStars rating={f.rating} />
                  </div>
                  <p className="text-sm text-[var(--muted-foreground)]">{f.comment}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Feedback Table */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <div className="p-5 border-b border-[var(--border)]">
          <h2 className="font-semibold">Todos os Feedbacks ({filteredFeedbacks.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <th className="px-5 py-3">Lead</th>
                <th className="px-5 py-3">Closer</th>
                <th className="px-5 py-3">Rating</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Enviado</th>
                <th className="px-5 py-3">Respondido</th>
              </tr>
            </thead>
            <tbody>
              {filteredFeedbacks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-[var(--muted-foreground)]">
                    Nenhum feedback encontrado no período.
                  </td>
                </tr>
              ) : (
                filteredFeedbacks.map((f) => (
                  <tr key={f.id} className="border-b border-[var(--border)] hover:bg-[var(--muted)]/50">
                    <td className="px-5 py-3">
                      <Link href={`/leads/${f.leadId}`} className="text-[var(--primary)] hover:underline">
                        {f.leadName}
                      </Link>
                    </td>
                    <td className="px-5 py-3">{f.closerName}</td>
                    <td className="px-5 py-3"><RatingStars rating={f.rating} /></td>
                    <td className="px-5 py-3"><StatusBadge status={f.status} /></td>
                    <td className="px-5 py-3 text-[var(--muted-foreground)]">
                      {new Date(f.sentAt).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-5 py-3 text-[var(--muted-foreground)]">
                      {f.respondedAt ? new Date(f.respondedAt).toLocaleDateString('pt-BR') : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
