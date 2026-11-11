import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

export interface TranscriptMetricRow {
  org_id: string;
  created_at: string;
  status: string;
  error: string | null;
  audio_seconds: number | null;
  latency_ms: number | null;
  cost_usd: number | null;
  text_length: number;
}

export interface QualificationMetricRow {
  org_id: string;
  created_at: string;
  cost_usd: number | null;
  needs_review: boolean;
}

export interface DailyMetrics {
  day: string;
  attempted: number;
  completed: number;
  failed: number;
  skipped: number;
  failureRate: number;
  emptyTranscripts: number;
  durationMismatches: number;
  latencyP50: number | null;
  latencyP95: number | null;
  transcriptCostUsd: number;
  qualificationCostUsd: number;
  needsReview: number;
}

/** Dia no fuso de São Paulo (UTC-3, sem horário de verão desde 2019). */
export function brtDay(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Percentil por interpolação linear (igual ao percentile_cont do Postgres). */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return (s[lo] as number) + ((s[hi] as number) - (s[lo] as number)) * (idx - lo);
}

/** Agrega por dia. Mesma regra da view call_transcription_engine_daily. */
export function aggregateDaily(
  transcripts: TranscriptMetricRow[],
  qualifications: QualificationMetricRow[] = [],
): DailyMetrics[] {
  const days = new Map<string, { t: TranscriptMetricRow[]; q: QualificationMetricRow[] }>();
  const bucket = (d: string) => {
    let b = days.get(d);
    if (!b) days.set(d, (b = { t: [], q: [] }));
    return b;
  };
  for (const t of transcripts) bucket(brtDay(t.created_at)).t.push(t);
  for (const q of qualifications) bucket(brtDay(q.created_at)).q.push(q);

  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, { t, q }]) => {
      const lat = t.map((r) => r.latency_ms).filter((v): v is number => typeof v === 'number');
      const failed = t.filter((r) => r.status === 'failed').length;
      return {
        day,
        attempted: t.length,
        completed: t.filter((r) => r.status === 'completed').length,
        failed,
        skipped: t.filter((r) => r.status === 'skipped').length,
        failureRate: t.length ? Number((failed / t.length).toFixed(4)) : 0,
        emptyTranscripts: t.filter(
          (r) => r.status === 'completed' && r.text_length === 0 && (r.audio_seconds ?? 0) >= 30,
        ).length,
        durationMismatches: t.filter((r) => r.error?.startsWith('duration_mismatch')).length,
        latencyP50: percentile(lat, 0.5),
        latencyP95: percentile(lat, 0.95),
        transcriptCostUsd: t.reduce((s, r) => s + (r.cost_usd ?? 0), 0),
        qualificationCostUsd: q.reduce((s, r) => s + (r.cost_usd ?? 0), 0),
        needsReview: q.filter((r) => r.needs_review).length,
      };
    });
}

/** Lê a view agregada (service_role). Não expõe texto. */
export async function fetchDailyMetrics(db: SupabaseClient, orgId: string, days = 14) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const { data } = (await from(db, 'call_transcription_engine_daily')
    .select('*')
    .eq('org_id', orgId)
    .gte('day', since)
    .order('day', { ascending: false })) as { data: unknown[] | null };
  return data ?? [];
}
