import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ logLeadEvent: vi.fn(), markLost: vi.fn() }));
vi.mock('@/features/leads/actions/log-lead-event', () => ({ logLeadEvent: mocks.logLeadEvent }));
vi.mock('./cadence-end-loss.service', () => ({ markLeadLostOnCadenceEnd: mocks.markLost }));

import {
  completeEnrollmentWithoutStep,
  shouldSkipEmailStepForNoLeadEmail,
  skipEmailStepForLeadWithoutEmail,
} from './enrollment-skip.service';

const ENR = { id: 'enr-1', cadence_id: 'cad-1', lead_id: 'lead-1', org_id: 'org-1', current_step: 1 };

function fakeDb(error: { message: string } | null = null, rows = 1) {
  const updates: Array<{ table: string; patch: unknown; filters: Array<[string, unknown]> }> = [];
  const client = {
    from(table: string) {
      const rec = { table, patch: undefined as unknown, filters: [] as Array<[string, unknown]> };
      updates.push(rec);
      const b: Record<string, unknown> = {};
      b.update = (patch: unknown) => {
        rec.patch = patch;
        return b;
      };
      b.eq = (col: string, val: unknown) => {
        rec.filters.push([col, val]);
        return b;
      };
      b.insert = vi.fn(() => {
        throw new Error('nunca deve inserir interação');
      });
      b.select = () => b;
      b.then = (res: (v: unknown) => void) =>
        res({ error, data: error ? null : Array.from({ length: rows }, (_, i) => ({ id: `r${i}` })) });
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient, updates };
}

const steps = (...channels: string[]) => channels.map((channel, i) => ({ step_order: i + 1, channel }));

beforeEach(() => {
  mocks.logLeadEvent.mockReset();
  mocks.markLost.mockReset();
});

describe('shouldSkipEmailStepForNoLeadEmail (escopo da D1)', () => {
  const scope = { kind: 'orgs' as const, orgIds: ['org-1'] };
  const base = { stepChannel: 'email', leadEmail: null, cadence: { type: 'standard', executor: 'human' }, scope, orgId: 'org-1' };
  it('mista + e-mail + lead sem e-mail + org na flag: pula', () => {
    expect(shouldSkipEmailStepForNoLeadEmail(base)).toBe(true);
  });
  it('auto_email e bdr_ai: não (seguem pausando)', () => {
    expect(shouldSkipEmailStepForNoLeadEmail({ ...base, cadence: { type: 'auto_email' } })).toBe(false);
    expect(shouldSkipEmailStepForNoLeadEmail({ ...base, cadence: { type: 'standard', executor: 'bdr_ai' } })).toBe(false);
  });
  it('org fora da flag, lead com e-mail, passo de ligação/WhatsApp: não', () => {
    expect(shouldSkipEmailStepForNoLeadEmail({ ...base, orgId: 'org-x' })).toBe(false);
    expect(shouldSkipEmailStepForNoLeadEmail({ ...base, leadEmail: 'a@b.com' })).toBe(false);
    expect(shouldSkipEmailStepForNoLeadEmail({ ...base, stepChannel: 'phone' })).toBe(false);
    expect(shouldSkipEmailStepForNoLeadEmail({ ...base, stepChannel: 'whatsapp' })).toBe(false);
  });
});

describe('skipEmailStepForLeadWithoutEmail (D1)', () => {
  it('avança para o próximo passo que não é e-mail, sem pausar nem gravar interação', async () => {
    const db = fakeDb();
    const r = await skipEmailStepForLeadWithoutEmail(db.client, ENR, steps('email', 'email', 'phone'));
    expect(r).toBe('advanced');
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]?.patch).toEqual({ current_step: 3 }); // pulou também o 2º e-mail
    expect(db.updates[0]?.filters).toContainEqual(['current_step', 1]);
    expect(db.updates[0]?.filters).toContainEqual(['status', 'active']);
    expect(mocks.logLeadEvent).toHaveBeenCalledWith(
      db.client,
      expect.objectContaining({ event: 'step_skipped_email_no_lead_email', userId: null, metadata: expect.objectContaining({ reason: 'no_lead_email', from_step: 1, to_step: 3 }) }),
    );
    expect(mocks.markLost).not.toHaveBeenCalled();
  });

  it('último passo (só restam e-mails): fim normal de cadência com a regra de Perdido', async () => {
    const db = fakeDb();
    const r = await skipEmailStepForLeadWithoutEmail(db.client, { ...ENR, current_step: 2 }, steps('phone', 'email'));
    expect(r).toBe('ended');
    expect((db.updates[0]?.patch as { status: string }).status).toBe('completed');
    expect(mocks.logLeadEvent).toHaveBeenCalledWith(db.client, expect.objectContaining({ event: 'cadence_completed' }));
    expect(mocks.markLost).toHaveBeenCalledWith({ orgId: 'org-1', leadId: 'lead-1', cadenceId: 'cad-1', enrollmentId: 'enr-1' });
  });

  it('passo atual que não é e-mail: nada a fazer', async () => {
    const db = fakeDb();
    expect(await skipEmailStepForLeadWithoutEmail(db.client, ENR, steps('phone', 'email'))).toBe('none');
    expect(db.updates).toHaveLength(0);
  });

  it('UPDATE sem linha atingida (avanço): nenhum evento, nenhuma perda', async () => {
    const db = fakeDb(null, 0);
    expect(await skipEmailStepForLeadWithoutEmail(db.client, ENR, steps('email', 'phone'))).toBe('skipped');
    expect(mocks.logLeadEvent).not.toHaveBeenCalled();
    expect(mocks.markLost).not.toHaveBeenCalled();
  });

  it('UPDATE sem linha atingida (cauda): nenhum evento, nenhuma perda', async () => {
    const db = fakeDb(null, 0);
    expect(await skipEmailStepForLeadWithoutEmail(db.client, { ...ENR, current_step: 2 }, steps('phone', 'email'))).toBe('skipped');
    expect(mocks.logLeadEvent).not.toHaveBeenCalled();
    expect(mocks.markLost).not.toHaveBeenCalled();
  });

  it('erro ao avançar: não registra evento', async () => {
    const db = fakeDb({ message: 'x' });
    expect(await skipEmailStepForLeadWithoutEmail(db.client, ENR, steps('email', 'phone'))).toBe('error');
    expect(mocks.logLeadEvent).not.toHaveBeenCalled();
  });
});

describe('completeEnrollmentWithoutStep (D2)', () => {
  it('sem passo (passos carregados): completed + evento + marca Perdido com as guardas da regra', async () => {
    const db = fakeDb();
    const r = await completeEnrollmentWithoutStep(db.client, { ...ENR, current_step: 10 }, [1, 2, 3, 4, 5, 6, 7]);
    expect(r).toBe('completed');
    expect((db.updates[0]?.patch as { status: string }).status).toBe('completed');
    expect(mocks.logLeadEvent).toHaveBeenCalledWith(db.client, expect.objectContaining({ event: 'cadence_completed', metadata: expect.objectContaining({ reason: 'no_step' }) }));
    expect(mocks.markLost).toHaveBeenCalledTimes(1);
    expect(mocks.markLost).toHaveBeenCalledWith({ orgId: 'org-1', leadId: 'lead-1', cadenceId: 'cad-1', enrollmentId: 'enr-1' });
  });

  it('leitura suspeita (0 passos carregados): não conclui, não marca Perdido', async () => {
    const db = fakeDb();
    expect(await completeEnrollmentWithoutStep(db.client, ENR, [])).toBe('skipped_unloaded');
    expect(db.updates).toHaveLength(0);
    expect(mocks.markLost).not.toHaveBeenCalled();
  });

  it('buraco no meio (current_step <= max e ausente): não conclui e não perde', async () => {
    const db = fakeDb();
    expect(await completeEnrollmentWithoutStep(db.client, { ...ENR, current_step: 3 }, [1, 2, 4, 5])).toBe('step_gap');
    expect(db.updates).toHaveLength(0);
    expect(mocks.logLeadEvent).not.toHaveBeenCalled();
    expect(mocks.markLost).not.toHaveBeenCalled();
  });

  it('UPDATE sem linha atingida: nenhum evento, nenhuma perda', async () => {
    const db = fakeDb(null, 0);
    expect(await completeEnrollmentWithoutStep(db.client, { ...ENR, current_step: 10 }, [1, 2, 3])).toBe('skipped');
    expect(mocks.logLeadEvent).not.toHaveBeenCalled();
    expect(mocks.markLost).not.toHaveBeenCalled();
  });

  it('falha ao concluir: não marca Perdido', async () => {
    const db = fakeDb({ message: 'x' });
    expect(await completeEnrollmentWithoutStep(db.client, { ...ENR, current_step: 10 }, [1, 2, 3])).toBe('error');
    expect(mocks.markLost).not.toHaveBeenCalled();
  });
});
