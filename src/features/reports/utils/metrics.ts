import { safeRate } from '@/lib/utils/format';

import type {
  CadenceMetrics,
  FunnelStep,
  OverallMetrics,
  RawCadence,
  RawEnrollment,
  RawInteraction,
  RawLead,
  RawMember,
  SdrMetrics,
} from '../reports.contract';

export function calculateCadenceMetrics(
  cadences: RawCadence[],
  enrollments: RawEnrollment[],
  interactions: RawInteraction[],
): CadenceMetrics[] {
  return cadences.map((cadence) => {
    const cadenceInteractions = interactions.filter(
      (i) => i.cadence_id === cadence.id,
    );
    const cadenceEnrollments = enrollments.filter(
      (e) => e.cadence_id === cadence.id,
    );

    const sent = cadenceInteractions.filter((i) => i.type === 'sent').length;
    const opened = cadenceInteractions.filter((i) => i.type === 'opened').length;
    const replied = cadenceInteractions.filter((i) => i.type === 'replied').length;
    const bounced = cadenceInteractions.filter((i) => i.type === 'bounced').length;
    // Gmail doesn't emit delivery receipts, so the 'delivered' interaction
    // type is never actually written. Estimate it as sent - bounced (same
    // approach the email-analytics dashboard uses); without this the CSV
    // report always shipped a "Entregues" column of 0.
    const delivered = Math.max(0, sent - bounced);
    const meetings = cadenceInteractions.filter(
      (i) => i.type === 'meeting_scheduled',
    ).length;

    const repliedLeads = new Set(
      cadenceEnrollments
        .filter((e) => e.status === 'replied' || e.status === 'completed')
        .map((e) => e.lead_id),
    );

    // Rates are per unique prospect (distinct leads who acted ÷ distinct leads
    // emailed), matching the cadence list (#99). Opens repeat for the same lead,
    // so event-based rates distort; the count columns above stay raw volume.
    const sentLeads = new Set(
      cadenceInteractions.filter((i) => i.type === 'sent').map((i) => i.lead_id),
    ).size;
    const openedLeads = new Set(
      cadenceInteractions.filter((i) => i.type === 'opened').map((i) => i.lead_id),
    ).size;
    const repliedLeadCount = new Set(
      cadenceInteractions.filter((i) => i.type === 'replied').map((i) => i.lead_id),
    ).size;
    const bouncedLeads = new Set(
      cadenceInteractions.filter((i) => i.type === 'bounced').map((i) => i.lead_id),
    ).size;

    return {
      cadenceId: cadence.id,
      cadenceName: cadence.name,
      totalEnrollments: cadenceEnrollments.length,
      sent,
      delivered,
      opened,
      replied,
      bounced,
      meetings,
      openRate: safeRate(openedLeads, sentLeads),
      replyRate: safeRate(repliedLeadCount, sentLeads),
      bounceRate: safeRate(bouncedLeads, sentLeads),
      conversionRate: safeRate(repliedLeads.size, cadenceEnrollments.length),
    };
  });
}

export function calculateSdrMetrics(
  members: RawMember[],
  enrollments: RawEnrollment[],
  interactions: RawInteraction[],
): SdrMetrics[] {
  return members.map((member) => {
    const sdrEnrollments = enrollments.filter(
      (e) => e.enrolled_by === member.user_id,
    );
    const sdrLeadIds = new Set(sdrEnrollments.map((e) => e.lead_id));

    const sdrInteractions = interactions.filter(
      (i) => sdrLeadIds.has(i.lead_id),
    );

    const messagesSent = sdrInteractions.filter((i) => i.type === 'sent').length;
    const replies = sdrInteractions.filter((i) => i.type === 'replied').length;
    const meetings = sdrInteractions.filter(
      (i) => i.type === 'meeting_scheduled',
    ).length;

    const repliedOrCompleted = sdrEnrollments.filter(
      (e) => e.status === 'replied' || e.status === 'completed',
    ).length;

    return {
      userId: member.user_id,
      userName: member.user_email,
      leadsWorked: sdrLeadIds.size,
      messagesSent,
      replies,
      meetings,
      conversionRate: safeRate(repliedOrCompleted, sdrEnrollments.length),
    };
  });
}

export function calculateOverallMetrics(
  leads: RawLead[],
  interactions: RawInteraction[],
  enrollments: RawEnrollment[],
): OverallMetrics {
  // Base: unique leads touched in the period (enrolled or interacted)
  const workedLeadIds = new Set([
    ...enrollments.map((e) => e.lead_id),
    ...interactions.map((i) => i.lead_id),
  ]);
  const totalLeads = workedLeadIds.size;

  const contactedLeads = new Set(
    interactions.filter((i) => i.type === 'sent').map((i) => i.lead_id),
  );
  const repliedLeads = new Set(
    interactions.filter((i) => i.type === 'replied').map((i) => i.lead_id),
  );
  const meetingLeads = new Set(
    interactions
      .filter((i) => i.type === 'meeting_scheduled')
      .map((i) => i.lead_id),
  );
  // Only count qualified leads that were actually worked in the period.
  // 'won' is a downstream stage of 'qualified' — both count toward the funnel's
  // "Qualificados" bucket.
  const qualifiedLeads = leads.filter(
    (l) => (l.status === 'qualified' || l.status === 'won') && workedLeadIds.has(l.id),
  ).length;

  const contacted = contactedLeads.size;
  const replied = repliedLeads.size;
  const meetings = meetingLeads.size;

  const funnelSteps: FunnelStep[] = [
    {
      label: 'Leads Trabalhados',
      count: totalLeads,
      percentage: 100,
      color: 'bg-indigo-400',
    },
    {
      label: 'Contactados',
      count: contacted,
      percentage: safeRate(contacted, totalLeads),
      color: 'bg-indigo-500',
    },
    {
      label: 'Responderam',
      count: replied,
      percentage: safeRate(replied, totalLeads),
      color: 'bg-violet-500',
    },
    {
      label: 'Reuniões',
      count: meetings,
      percentage: safeRate(meetings, totalLeads),
      color: 'bg-purple-500',
    },
    {
      label: 'Qualificados',
      count: qualifiedLeads,
      percentage: safeRate(qualifiedLeads, totalLeads),
      color: 'bg-emerald-500',
    },
  ];

  return {
    totalLeads,
    contacted,
    replied,
    meetings,
    qualified: qualifiedLeads,
    funnelSteps,
  };
}
