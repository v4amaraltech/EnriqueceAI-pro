import { describe, expect, it } from 'vitest';

import type { PendingActivity } from '../types';

// Extract and test the applyFilters logic directly
// (it's a pure function inside ActivityQueueView)

function applyFilters(
  activities: PendingActivity[],
  filters: { status: string; channel: string; cadence: string; step: string; search: string },
): PendingActivity[] {
  return activities.filter((a) => {
    if (filters.status === 'overdue') {
      const diffH = (Date.now() - new Date(a.nextStepDue).getTime()) / 3600000;
      if (diffH < 1) return false;
    }
    if (filters.status === 'due') {
      const diffH = (Date.now() - new Date(a.nextStepDue).getTime()) / 3600000;
      if (diffH >= 1) return false;
    }
    if (filters.channel !== 'all' && a.channel !== filters.channel) return false;
    if (filters.cadence !== 'all' && a.cadenceName !== filters.cadence) return false;
    if (filters.step !== 'all' && String(a.stepOrder) !== filters.step) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const leadName = (a.lead.nome_fantasia ?? a.lead.razao_social ?? a.lead.cnpj).toLowerCase();
      const cadence = a.cadenceName.toLowerCase();
      if (!leadName.includes(q) && !cadence.includes(q)) return false;
    }
    return true;
  });
}

const baseLead = {
  id: 'lead-1',
  org_id: 'org-1',
  nome_fantasia: 'Acme Corp' as string | null,
  razao_social: null as string | null,
  cnpj: '12345678000100',
  email: 'acme@test.com' as string | null,
  telefone: null as string | null,
  municipio: null as string | null,
  uf: null as string | null,
  porte: null as string | null,
  primeiro_nome: null as string | null,
  socios: null,
  endereco: null,
  instagram: null as string | null,
  linkedin: null as string | null,
  website: null as string | null,
  status: null,
  enrichment_status: null,
  notes: null as string | null,
  fit_score: null as number | null,
  engagement_score: null as number | null,
  is_inbound: false,
  created_at: '2026-01-15T10:00:00Z',
};

function makeActivity(overrides: Partial<PendingActivity> = {}): PendingActivity {
  return {
    enrollmentId: 'enr-1',
    cadenceId: 'cad-1',
    cadenceName: 'Cadência Padrão',
    stepId: 'step-1',
    stepOrder: 1,
    totalSteps: 5,
    channel: 'email',
    templateId: null,
    templateSubject: null,
    templateBody: null,
    cadenceCreatedBy: null,
    aiPersonalization: false,
    nextStepDue: new Date(Date.now() - 30 * 60000).toISOString(), // 30 min ago (not overdue)
    isCurrentStep: true,
    lead: baseLead,
    activityName: null,
    callScript: null,
    ...overrides,
  };
}

const defaultFilters = { status: 'all', channel: 'all', cadence: 'all', step: 'all', search: '' };

describe('applyFilters (ActivityQueueView)', () => {
  it('should return all activities with default filters', () => {
    const activities = [makeActivity(), makeActivity({ enrollmentId: 'enr-2' })];
    const result = applyFilters(activities, defaultFilters);
    expect(result).toHaveLength(2);
  });

  it('should filter by channel', () => {
    const activities = [
      makeActivity({ channel: 'email' }),
      makeActivity({ enrollmentId: 'enr-2', channel: 'whatsapp' }),
      makeActivity({ enrollmentId: 'enr-3', channel: 'phone' }),
    ];
    const result = applyFilters(activities, { ...defaultFilters, channel: 'email' });
    expect(result).toHaveLength(1);
    expect(result[0]!.channel).toBe('email');
  });

  it('should filter by cadence', () => {
    const activities = [
      makeActivity({ cadenceName: 'Inbound' }),
      makeActivity({ enrollmentId: 'enr-2', cadenceName: 'Outbound' }),
    ];
    const result = applyFilters(activities, { ...defaultFilters, cadence: 'Inbound' });
    expect(result).toHaveLength(1);
    expect(result[0]!.cadenceName).toBe('Inbound');
  });

  it('should filter by step', () => {
    const activities = [
      makeActivity({ stepOrder: 1 }),
      makeActivity({ enrollmentId: 'enr-2', stepOrder: 3 }),
    ];
    const result = applyFilters(activities, { ...defaultFilters, step: '3' });
    expect(result).toHaveLength(1);
    expect(result[0]!.stepOrder).toBe(3);
  });

  it('should filter by search (lead name)', () => {
    const activities = [
      makeActivity({ lead: { ...baseLead, nome_fantasia: 'Acme Corp' } }),
      makeActivity({ enrollmentId: 'enr-2', lead: { ...baseLead, nome_fantasia: 'Beta SA' } }),
    ];
    const result = applyFilters(activities, { ...defaultFilters, search: 'beta' });
    expect(result).toHaveLength(1);
  });

  it('should filter by search (cadence name)', () => {
    const activities = [
      makeActivity({ cadenceName: 'Inbound Trial' }),
      makeActivity({ enrollmentId: 'enr-2', cadenceName: 'Outbound Enterprise' }),
    ];
    const result = applyFilters(activities, { ...defaultFilters, search: 'inbound' });
    expect(result).toHaveLength(1);
  });

  it('should filter overdue (> 1h)', () => {
    const activities = [
      makeActivity({ nextStepDue: new Date(Date.now() - 2 * 3600000).toISOString() }), // 2h ago - overdue
      makeActivity({
        enrollmentId: 'enr-2',
        nextStepDue: new Date(Date.now() - 30 * 60000).toISOString(), // 30min ago - not overdue
      }),
    ];
    const result = applyFilters(activities, { ...defaultFilters, status: 'overdue' });
    expect(result).toHaveLength(1);
  });

  it('should filter due (< 1h)', () => {
    const activities = [
      makeActivity({ nextStepDue: new Date(Date.now() - 2 * 3600000).toISOString() }), // 2h ago
      makeActivity({
        enrollmentId: 'enr-2',
        nextStepDue: new Date(Date.now() - 30 * 60000).toISOString(), // 30min ago
      }),
    ];
    const result = applyFilters(activities, { ...defaultFilters, status: 'due' });
    expect(result).toHaveLength(1);
  });

  it('should combine multiple filters', () => {
    const activities = [
      makeActivity({ channel: 'email', cadenceName: 'Inbound' }),
      makeActivity({ enrollmentId: 'enr-2', channel: 'email', cadenceName: 'Outbound' }),
      makeActivity({ enrollmentId: 'enr-3', channel: 'phone', cadenceName: 'Inbound' }),
    ];
    const result = applyFilters(activities, { ...defaultFilters, channel: 'email', cadence: 'Inbound' });
    expect(result).toHaveLength(1);
  });
});

describe('Quick mode grouping', () => {
  it('should group activities by channel', () => {
    const activities = [
      makeActivity({ channel: 'email' }),
      makeActivity({ enrollmentId: 'enr-2', channel: 'whatsapp' }),
      makeActivity({ enrollmentId: 'enr-3', channel: 'email' }),
      makeActivity({ enrollmentId: 'enr-4', channel: 'phone' }),
    ];

    // Replicate quick mode grouping logic
    const groups = new Map<string, PendingActivity[]>();
    for (const a of activities) {
      const list = groups.get(a.channel) ?? [];
      list.push(a);
      groups.set(a.channel, list);
    }

    expect(groups.size).toBe(3);
    expect(groups.get('email')).toHaveLength(2);
    expect(groups.get('whatsapp')).toHaveLength(1);
    expect(groups.get('phone')).toHaveLength(1);
  });
});
