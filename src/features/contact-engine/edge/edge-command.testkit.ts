import { vi } from 'vitest';

import type { SendDecision } from '../types';

import type { EdgePorts, StoredEvent, Target } from './edge-command.service';

export const ORG_A = '11111111-1111-4111-8111-111111111111';
export const ORG_B = '22222222-2222-4222-8222-222222222222';
export const LEAD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const LEAD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const EXEC_A = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const USER_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

export const ALLOWED: SendDecision = {
  allowed: true, provider: 'meta_cloud', senderInstanceId: null, requiresTemplate: false,
  templateId: null, ownershipVersion: 1, consentEvidenceId: null, decidedAt: '2026-11-08T12:00:00.000Z',
};
export const DENIED: SendDecision = {
  allowed: false, reasons: ['hold_total'], retryable: false, decidedAt: '2026-11-08T12:00:00.000Z',
};
export const DENIED_RETRYABLE: SendDecision = {
  allowed: false, reasons: ['context_unavailable'], retryable: true, decidedAt: '2026-11-08T12:00:00.000Z',
};

/** Portas em memoria. Cada org enxerga so os proprios alvos e eventos. */
export function makeFakePorts(opts: { enabledOrgs?: string[] } = {}) {
  const enabled = new Set(opts.enabledOrgs ?? [ORG_A]);
  const events = new Map<string, StoredEvent>();
  const targets = new Map<string, Target>();
  const evKey = (org: string, key: string) => `${org}|${key}`;

  targets.set(`${ORG_A}|${EXEC_A}`, {
    leadId: LEAD_A, enrollmentId: 'e1', stepId: 's1', executionId: EXEC_A, contact: '5511999990000', assignedTo: USER_A,
  });
  targets.set(`${ORG_A}|${LEAD_A}`, {
    leadId: LEAD_A, enrollmentId: null, stepId: null, executionId: null, contact: 'a@x.com', assignedTo: USER_A,
  });
  targets.set(`${ORG_B}|${LEAD_B}`, {
    leadId: LEAD_B, enrollmentId: null, stepId: null, executionId: null, contact: 'b@x.com', assignedTo: null,
  });

  const ports = {
    isEnabled: vi.fn(async (org: string) => enabled.has(org)),
    resolveTarget: vi.fn(async (org: string, ref: { executionId?: string; leadId?: string }) => {
      const t = targets.get(`${org}|${ref.executionId ?? ref.leadId}`);
      return t ? { ok: true as const, target: t } : { ok: false as const, reason: 'not_found' as const };
    }),
    evaluate: vi.fn(async () => ALLOWED as SendDecision),
    readEvent: vi.fn(async (org: string, key: string): Promise<StoredEvent | null | 'error'> => events.get(evKey(org, key)) ?? null),
    recordEvent: vi.fn(async (i: { orgId: string; key: string; disposition: string; reasons?: string[] }): Promise<'recorded' | 'duplicate' | 'error'> => {
      const k = evKey(i.orgId, i.key);
      if (events.has(k)) return 'duplicate';
      events.set(k, { disposition: i.disposition, reasons: i.reasons ?? [] });
      return 'recorded';
    }),
    skipStep: vi.fn(async () => true),
    delegate: vi.fn(async (): Promise<{ status: number; body: unknown }> => ({ status: 200, body: { success: true, data: { aplicado: true } } })),
    findLeadsByPhone: vi.fn(async () => [] as string[]),
    access: vi.fn(async () => ({
      success: true as const,
      data: {
        allowed: true, reasons: [] as never[], lastConsent: 'opt_in' as const, owner: null,
        holds: { bloqueado_total: false, bloqueado_prospeccao: false, bloqueado_conversa: false },
      },
    })),
  };
  return { ports: ports as unknown as EdgePorts & typeof ports, events, enabled };
}
