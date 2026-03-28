'use client';

import type { CloserFeedbackRow } from '../actions/fetch-closer-feedbacks';

interface CloserMetrics {
  name: string;
  email: string;
  total: number;
  responded: number;
  meetingDone: number;
  noShow: number;
  rescheduled: number;
  avgRating: number | null;
  responseRate: number;
}

function computeMetrics(feedbacks: CloserFeedbackRow[]): {
  global: { total: number; responded: number; responseRate: number; avgRating: number | null; meetingDoneRate: number };
  byCloser: CloserMetrics[];
} {
  const responded = feedbacks.filter((f) => f.responded_at);
  const ratings = responded.filter((f) => f.rating !== null).map((f) => f.rating!);
  const meetingDone = responded.filter((f) => f.result === 'meeting_done').length;

  const global = {
    total: feedbacks.length,
    responded: responded.length,
    responseRate: feedbacks.length > 0 ? (responded.length / feedbacks.length) * 100 : 0,
    avgRating: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    meetingDoneRate: responded.length > 0 ? (meetingDone / responded.length) * 100 : 0,
  };

  // Group by closer
  const closerMap = new Map<string, CloserFeedbackRow[]>();
  for (const fb of feedbacks) {
    const key = fb.closer_email;
    if (!closerMap.has(key)) closerMap.set(key, []);
    closerMap.get(key)!.push(fb);
  }

  const byCloser: CloserMetrics[] = [];
  for (const [email, fbs] of closerMap) {
    const resp = fbs.filter((f) => f.responded_at);
    const closerRatings = resp.filter((f) => f.rating !== null).map((f) => f.rating!);
    byCloser.push({
      name: fbs[0]?.closer_name ?? 'Closer',
      email,
      total: fbs.length,
      responded: resp.length,
      meetingDone: resp.filter((f) => f.result === 'meeting_done').length,
      noShow: resp.filter((f) => f.result === 'no_show').length,
      rescheduled: resp.filter((f) => f.result === 'rescheduled').length,
      avgRating: closerRatings.length > 0 ? closerRatings.reduce((a, b) => a + b, 0) / closerRatings.length : null,
      responseRate: fbs.length > 0 ? (resp.length / fbs.length) * 100 : 0,
    });
  }

  byCloser.sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0));

  return { global, byCloser };
}

function MetricCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-4">
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {subtitle && <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{subtitle}</p>}
    </div>
  );
}

export function CloserPerformanceCards({ feedbacks }: { feedbacks: CloserFeedbackRow[] }) {
  if (feedbacks.length === 0) return null;

  const { global, byCloser } = computeMetrics(feedbacks);

  return (
    <div className="space-y-6">
      {/* Global metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Total de feedbacks" value={String(global.total)} subtitle={`${global.responded} respondidos`} />
        <MetricCard label="Taxa de resposta" value={`${global.responseRate.toFixed(0)}%`} />
        <MetricCard label="Nota média" value={global.avgRating !== null ? `${global.avgRating.toFixed(1)}/5` : '—'} subtitle={global.avgRating !== null ? '★'.repeat(Math.round(global.avgRating)) : undefined} />
        <MetricCard label="Reuniões realizadas" value={`${global.meetingDoneRate.toFixed(0)}%`} subtitle="dos respondidos" />
      </div>

      {/* Per-closer breakdown */}
      {byCloser.length > 1 && (
        <div>
          <h3 className="text-sm font-semibold mb-3">Performance por closer</h3>
          <div className="rounded-lg border border-[var(--border)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-[var(--muted)]/50">
                  <th className="p-3 text-left font-medium">Closer</th>
                  <th className="p-3 text-center font-medium">Feedbacks</th>
                  <th className="p-3 text-center font-medium">Realizadas</th>
                  <th className="p-3 text-center font-medium">No-show</th>
                  <th className="p-3 text-center font-medium">Remarcou</th>
                  <th className="p-3 text-center font-medium">Nota média</th>
                  <th className="p-3 text-center font-medium">Resposta</th>
                </tr>
              </thead>
              <tbody>
                {byCloser.map((c) => (
                  <tr key={c.email} className="border-b last:border-0">
                    <td className="p-3">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-[var(--muted-foreground)]">{c.email}</div>
                    </td>
                    <td className="p-3 text-center">{c.total}</td>
                    <td className="p-3 text-center text-green-600 dark:text-green-400">{c.meetingDone}</td>
                    <td className="p-3 text-center text-red-600 dark:text-red-400">{c.noShow}</td>
                    <td className="p-3 text-center text-yellow-600 dark:text-yellow-400">{c.rescheduled}</td>
                    <td className="p-3 text-center">
                      {c.avgRating !== null ? (
                        <span className="text-[#E53935]">{'★'.repeat(Math.round(c.avgRating))}{'☆'.repeat(5 - Math.round(c.avgRating))}</span>
                      ) : '—'}
                    </td>
                    <td className="p-3 text-center">{c.responseRate.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
