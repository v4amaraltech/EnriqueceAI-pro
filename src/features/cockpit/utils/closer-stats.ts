export interface CloserMeetingLead {
  closer_id: string | null;
  meeting_held_at: string | null;
  meeting_no_show_at: string | null;
}

export interface CloserMonthStats {
  closerId: string;
  /** Reuniões do mês = agendadas + no-show + realizadas + canceladas. */
  total: number;
  scheduled: number;
  noShow: number;
  held: number;
  cancelled: number;
}

/**
 * Reuniões do mês por closer. Base = leads com reunião (início) no mês:
 * realizada se tem `meeting_held_at`, no-show se tem `meeting_no_show_at`,
 * senão ainda agendada. Canceladas vêm dos eventos `meeting_cancelled` do mês
 * (o cancelamento apaga a reunião do lead, então não está na base).
 */
export function buildCloserMonthStats(
  closerIds: string[],
  leads: CloserMeetingLead[],
  cancelledByCloser: Map<string, number>,
): Map<string, CloserMonthStats> {
  const stats = new Map<string, CloserMonthStats>(
    closerIds.map((id) => [id, { closerId: id, total: 0, scheduled: 0, noShow: 0, held: 0, cancelled: 0 }]),
  );
  for (const l of leads) {
    const s = l.closer_id ? stats.get(l.closer_id) : undefined;
    if (!s) continue;
    if (l.meeting_held_at) s.held += 1;
    else if (l.meeting_no_show_at) s.noShow += 1;
    else s.scheduled += 1;
    s.total += 1;
  }
  for (const [id, n] of cancelledByCloser) {
    const s = stats.get(id);
    if (!s) continue;
    s.cancelled += n;
    s.total += n;
  }
  return stats;
}

export function pctOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
