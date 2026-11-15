import { describe, expect, it } from 'vitest';

import {
  MIXED_AUTO_EMAIL_FLAG,
  isMixedAutoEmailCadence,
  mailboxAtDailyCap,
  mailboxDailyCap,
  mixedAutoEmailScopeFromFlag,
  orgAllowsMixedAutoEmail,
  pickDueMixedEmailEnrollments,
  startOfBrtDay,
} from './mixed-auto-email.service';

const V4 = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
const OTHER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('mixedAutoEmailScopeFromFlag', () => {
  it('sem linha ou desligada e lista vazia: ninguém', () => {
    expect(mixedAutoEmailScopeFromFlag(null)).toEqual({ kind: 'none' });
    expect(mixedAutoEmailScopeFromFlag({ enabled: false, allow_org_ids: [], allow_user_ids: [] })).toEqual({
      kind: 'none',
    });
  });

  it('enabled=false e org na lista: só essa org', () => {
    expect(
      mixedAutoEmailScopeFromFlag({ enabled: false, allow_org_ids: [V4], allow_user_ids: [] }),
    ).toEqual({ kind: 'orgs', orgIds: [V4] });
  });

  it('enabled=true liga todas as orgs', () => {
    expect(
      mixedAutoEmailScopeFromFlag({ enabled: true, allow_org_ids: [], allow_user_ids: [] }),
    ).toEqual({ kind: 'all' });
  });
});

describe('orgAllowsMixedAutoEmail', () => {
  const scoped = mixedAutoEmailScopeFromFlag({ enabled: false, allow_org_ids: [V4], allow_user_ids: [] });

  it('libera a org da lista e recusa as outras', () => {
    expect(orgAllowsMixedAutoEmail(scoped, V4)).toBe(true);
    expect(orgAllowsMixedAutoEmail(scoped, V4.toUpperCase())).toBe(true);
    expect(orgAllowsMixedAutoEmail(scoped, OTHER)).toBe(false);
    expect(orgAllowsMixedAutoEmail({ kind: 'none' }, V4)).toBe(false);
    expect(orgAllowsMixedAutoEmail({ kind: 'all' }, OTHER)).toBe(true);
    expect(orgAllowsMixedAutoEmail(scoped, null)).toBe(false);
  });
});

describe('isMixedAutoEmailCadence', () => {
  it('só standard com executor humano', () => {
    expect(isMixedAutoEmailCadence({ type: 'standard', executor: 'sdr' })).toBe(true);
    expect(isMixedAutoEmailCadence({ type: 'standard', executor: null })).toBe(true);
    expect(isMixedAutoEmailCadence({ type: 'auto_email', executor: 'sdr' })).toBe(false);
    expect(isMixedAutoEmailCadence({ type: 'standard', executor: 'bdr_ai' })).toBe(false);
  });
});

describe('startOfBrtDay', () => {
  it('marca 00:00 no horário de Brasília', () => {
    const now = new Date('2026-11-16T02:30:00.000Z'); // 15/11 23:30 BRT
    expect(startOfBrtDay(now).toISOString()).toBe('2026-11-15T03:00:00.000Z');
    const mondayMorning = new Date('2026-11-16T11:15:00.000Z'); // 16/11 08:15 BRT
    expect(startOfBrtDay(mondayMorning).toISOString()).toBe('2026-11-16T03:00:00.000Z');
  });
});

describe('mailbox daily cap', () => {
  it('respeita teto explícito, pausa e envios do dia', () => {
    expect(mailboxDailyCap({ dailyCap: 10, connectedAt: '2026-01-01', pausedReason: null })).toBe(10);
    expect(mailboxDailyCap({ dailyCap: 10, connectedAt: '2026-01-01', pausedReason: 'bounce alto' })).toBe(0);
    expect(mailboxAtDailyCap(9, 10)).toBe(false);
    expect(mailboxAtDailyCap(10, 10)).toBe(true);
    expect(mailboxAtDailyCap(0, 0)).toBe(true);
  });
});

describe('pickDueMixedEmailEnrollments', () => {
  const scope = mixedAutoEmailScopeFromFlag({ enabled: false, allow_org_ids: [V4], allow_user_ids: [] });
  const emailSteps = new Map<string, Set<number>>([
    ['cad-mixed', new Set([1])],
    ['cad-auto', new Set([1])],
    ['cad-phone-first', new Set([2])],
  ]);

  const row = (
    id: string,
    orgId: string,
    cadence: { type: string; executor?: string | null },
    cadenceId: string,
    currentStep: number,
  ) => ({
    id,
    current_step: currentStep,
    cadence_id: cadenceId,
    lead: { org_id: orgId },
    cadence,
  });

  it('flag desligada não seleciona ninguém', () => {
    const rows = [row('e1', V4, { type: 'standard', executor: 'sdr' }, 'cad-mixed', 1)];
    expect(pickDueMixedEmailEnrollments(rows, emailSteps, { kind: 'none' })).toEqual([]);
  });

  it('seleciona e-mail vencido da org liberada e ignora o resto', () => {
    const rows = [
      row('ok', V4, { type: 'standard', executor: 'sdr' }, 'cad-mixed', 1),
      row('other-org', OTHER, { type: 'standard', executor: 'sdr' }, 'cad-mixed', 1),
      row('auto', V4, { type: 'auto_email', executor: 'sdr' }, 'cad-auto', 1),
      row('ana', V4, { type: 'standard', executor: 'bdr_ai' }, 'cad-mixed', 1),
      row('phone', V4, { type: 'standard', executor: 'sdr' }, 'cad-phone-first', 1),
    ];
    expect(pickDueMixedEmailEnrollments(rows, emailSteps, scope).map((r) => r.id)).toEqual(['ok']);
  });
});

describe('flag key', () => {
  it('usa o nome estável da flag', () => {
    expect(MIXED_AUTO_EMAIL_FLAG).toBe('cadence_mixed_auto_email_v1');
  });
});
