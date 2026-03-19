import { describe, expect, it } from 'vitest';

import type {
  RawCadence,
  RawEnrollment,
  RawInteraction,
  RawLead,
  RawMember,
} from '../reports.contract';
import {
  calculateCadenceMetrics,
  calculateOverallMetrics,
  calculateSdrMetrics,
} from './metrics';

describe('calculateCadenceMetrics', () => {
  const cadences: RawCadence[] = [
    { id: 'c1', name: 'Outbound Q1' },
    { id: 'c2', name: 'Follow-up' },
  ];

  const enrollments: RawEnrollment[] = [
    { cadence_id: 'c1', lead_id: 'l1', status: 'replied', enrolled_by: 'u1' },
    { cadence_id: 'c1', lead_id: 'l2', status: 'active', enrolled_by: 'u1' },
    { cadence_id: 'c1', lead_id: 'l3', status: 'completed', enrolled_by: 'u1' },
    { cadence_id: 'c2', lead_id: 'l4', status: 'active', enrolled_by: 'u2' },
  ];

  const interactions: RawInteraction[] = [
    { type: 'sent', cadence_id: 'c1', lead_id: 'l1', created_at: '2026-02-19T10:00:00Z' },
    { type: 'sent', cadence_id: 'c1', lead_id: 'l2', created_at: '2026-02-19T10:00:00Z' },
    { type: 'sent', cadence_id: 'c1', lead_id: 'l3', created_at: '2026-02-19T10:00:00Z' },
    { type: 'opened', cadence_id: 'c1', lead_id: 'l1', created_at: '2026-02-19T11:00:00Z' },
    { type: 'opened', cadence_id: 'c1', lead_id: 'l3', created_at: '2026-02-19T11:00:00Z' },
    { type: 'replied', cadence_id: 'c1', lead_id: 'l1', created_at: '2026-02-19T12:00:00Z' },
    { type: 'bounced', cadence_id: 'c1', lead_id: 'l2', created_at: '2026-02-19T10:05:00Z' },
    { type: 'sent', cadence_id: 'c2', lead_id: 'l4', created_at: '2026-02-19T10:00:00Z' },
    { type: 'meeting_scheduled', cadence_id: 'c1', lead_id: 'l1', created_at: '2026-02-19T14:00:00Z' },
  ];

  it('should calculate metrics for each cadence', () => {
    const result = calculateCadenceMetrics(cadences, enrollments, interactions);
    expect(result).toHaveLength(2);
  });

  it('should calculate correct counts for cadence c1', () => {
    const result = calculateCadenceMetrics(cadences, enrollments, interactions);
    const c1 = result.find((m) => m.cadenceId === 'c1')!;

    expect(c1.cadenceName).toBe('Outbound Q1');
    expect(c1.totalEnrollments).toBe(3);
    expect(c1.sent).toBe(3);
    expect(c1.opened).toBe(2);
    expect(c1.replied).toBe(1);
    expect(c1.bounced).toBe(1);
    expect(c1.meetings).toBe(1);
  });

  it('should calculate correct rates for cadence c1', () => {
    const result = calculateCadenceMetrics(cadences, enrollments, interactions);
    const c1 = result.find((m) => m.cadenceId === 'c1')!;

    // openRate = 2/3 = 66.7%
    expect(c1.openRate).toBe(66.7);
    // replyRate = 1/3 = 33.3%
    expect(c1.replyRate).toBe(33.3);
    // bounceRate = 1/3 = 33.3%
    expect(c1.bounceRate).toBe(33.3);
    // conversionRate: 2 replied/completed leads out of 3 = 66.7%
    expect(c1.conversionRate).toBe(66.7);
  });

  it('should handle cadence with no interactions', () => {
    const result = calculateCadenceMetrics(
      [{ id: 'empty', name: 'Empty' }],
      [],
      [],
    );
    expect(result[0]!.sent).toBe(0);
    expect(result[0]!.openRate).toBe(0);
    expect(result[0]!.conversionRate).toBe(0);
  });
});

describe('calculateSdrMetrics', () => {
  const members: RawMember[] = [
    { user_id: 'u1', user_email: 'sdr1@enriqueceai.com' },
    { user_id: 'u2', user_email: 'sdr2@enriqueceai.com' },
  ];

  const enrollments: RawEnrollment[] = [
    { cadence_id: 'c1', lead_id: 'l1', status: 'replied', enrolled_by: 'u1' },
    { cadence_id: 'c1', lead_id: 'l2', status: 'active', enrolled_by: 'u1' },
    { cadence_id: 'c2', lead_id: 'l3', status: 'completed', enrolled_by: 'u2' },
  ];

  const interactions: RawInteraction[] = [
    { type: 'sent', cadence_id: 'c1', lead_id: 'l1', created_at: '2026-02-19T10:00:00Z' },
    { type: 'sent', cadence_id: 'c1', lead_id: 'l2', created_at: '2026-02-19T10:00:00Z' },
    { type: 'replied', cadence_id: 'c1', lead_id: 'l1', created_at: '2026-02-19T12:00:00Z' },
    { type: 'meeting_scheduled', cadence_id: 'c1', lead_id: 'l1', created_at: '2026-02-19T14:00:00Z' },
    { type: 'sent', cadence_id: 'c2', lead_id: 'l3', created_at: '2026-02-19T10:00:00Z' },
  ];

  it('should calculate metrics per SDR', () => {
    const result = calculateSdrMetrics(members, enrollments, interactions);
    expect(result).toHaveLength(2);
  });

  it('should calculate correct metrics for SDR u1', () => {
    const result = calculateSdrMetrics(members, enrollments, interactions);
    const sdr1 = result.find((m) => m.userId === 'u1')!;

    expect(sdr1.userName).toBe('sdr1@enriqueceai.com');
    expect(sdr1.leadsWorked).toBe(2);
    expect(sdr1.messagesSent).toBe(2);
    expect(sdr1.replies).toBe(1);
    expect(sdr1.meetings).toBe(1);
    // 1 replied out of 2 enrollments = 50%
    expect(sdr1.conversionRate).toBe(50);
  });

  it('should handle SDR with no enrollments', () => {
    const result = calculateSdrMetrics(
      [{ user_id: 'u99', user_email: 'new@enriqueceai.com' }],
      [],
      [],
    );
    expect(result[0]!.leadsWorked).toBe(0);
    expect(result[0]!.conversionRate).toBe(0);
  });
});

describe('calculateOverallMetrics', () => {
  const leads: RawLead[] = [
    { id: 'l1', status: 'qualified' },
    { id: 'l2', status: 'contacted' },
    { id: 'l3', status: 'new' },
    { id: 'l4', status: 'qualified' },
    { id: 'l5', status: 'new' },
  ];

  const enrollments: RawEnrollment[] = [
    { cadence_id: 'c1', lead_id: 'l1', status: 'replied', enrolled_by: 'u1' },
    { cadence_id: 'c1', lead_id: 'l2', status: 'active', enrolled_by: 'u1' },
    { cadence_id: 'c1', lead_id: 'l4', status: 'active', enrolled_by: 'u1' },
  ];

  const interactions: RawInteraction[] = [
    { type: 'sent', cadence_id: 'c1', lead_id: 'l1', created_at: '2026-02-19T10:00:00Z' },
    { type: 'sent', cadence_id: 'c1', lead_id: 'l2', created_at: '2026-02-19T10:00:00Z' },
    { type: 'sent', cadence_id: 'c1', lead_id: 'l4', created_at: '2026-02-19T10:00:00Z' },
    { type: 'replied', cadence_id: 'c1', lead_id: 'l1', created_at: '2026-02-19T12:00:00Z' },
    { type: 'replied', cadence_id: 'c1', lead_id: 'l4', created_at: '2026-02-19T12:00:00Z' },
    { type: 'meeting_scheduled', cadence_id: 'c1', lead_id: 'l1', created_at: '2026-02-19T14:00:00Z' },
  ];

  it('should use worked leads (enrolled + interacted) as base', () => {
    const result = calculateOverallMetrics(leads, interactions, enrollments);

    // l1, l2, l4 from enrollments/interactions (l3, l5 not touched)
    expect(result.totalLeads).toBe(3);
    expect(result.contacted).toBe(3);
    expect(result.replied).toBe(2);
    expect(result.meetings).toBe(1);
  });

  it('should only count qualified leads that were worked in period', () => {
    // l1 and l4 are qualified, both were worked — so 2
    // l3 is 'new' and not worked, doesn't count
    const result = calculateOverallMetrics(leads, interactions, enrollments);

    expect(result.qualified).toBe(2);
  });

  it('should generate correct funnel steps with period-scoped base', () => {
    const result = calculateOverallMetrics(leads, interactions, enrollments);

    expect(result.funnelSteps).toHaveLength(5);
    expect(result.funnelSteps[0]!.label).toBe('Leads Trabalhados');
    expect(result.funnelSteps[0]!.count).toBe(3);
    expect(result.funnelSteps[0]!.percentage).toBe(100);

    expect(result.funnelSteps[1]!.label).toBe('Contactados');
    expect(result.funnelSteps[1]!.count).toBe(3);
    expect(result.funnelSteps[1]!.percentage).toBe(100);

    expect(result.funnelSteps[4]!.label).toBe('Qualificados');
    expect(result.funnelSteps[4]!.count).toBe(2);
    expect(result.funnelSteps[4]!.percentage).toBe(66.7);
  });

  it('should handle empty data', () => {
    const result = calculateOverallMetrics([], [], []);

    expect(result.totalLeads).toBe(0);
    expect(result.contacted).toBe(0);
    expect(result.funnelSteps[0]!.percentage).toBe(100);
    expect(result.funnelSteps[1]!.percentage).toBe(0);
  });
});
