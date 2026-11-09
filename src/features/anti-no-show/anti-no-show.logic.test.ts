import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { suppressionPlan } from './flag';
import {
  activateSteps,
  addBusinessDays,
  atBrt,
  cutoverSkipKeys,
  dueAt,
  maySend,
  meetingInstantFromInput,
  pickGmailAccount,
  pickWhatsAppAccount,
  planSteps,
  previousBusinessDay,
  reminderRowsForOldRuler,
  stepCatalog,
  type EnrollmentSnap,
  type StepDef,
} from './anti-no-show.logic';

const MEETING = new Date('2026-11-12T18:00:00.000Z'); // quinta 15:00 BRT
const BOOKED = new Date('2026-11-09T14:00:00.000Z'); // segunda 11:00 BRT

function enrollment(overrides: Partial<EnrollmentSnap> = {}): EnrollmentSnap {
  return {
    id: 'enr-1',
    phase: 'pre_meeting',
    status: 'active',
    meetingStartsAt: MEETING,
    enrolledAt: BOOKED,
    bookedAt: BOOKED,
    context: 'outbound',
    confirmedAt: null,
    recoveryOpenedAt: null,
    ...overrides,
  };
}

function readySteps(): StepDef[] {
  return stepCatalog().map((step) => ({
    ...step,
    active: true,
    messageTemplateId: step.mode === 'auto' ? 'tpl-1' : null,
  }));
}

function plan(now: Date, snap: EnrollmentSnap, extra?: Partial<Parameters<typeof planSteps>[0]>) {
  return planSteps({
    steps: readySteps(),
    enrollment: snap,
    runs: [],
    now,
    channels: { email: true, whatsapp: true },
    replied: false,
    ...extra,
  });
}

function byKey(now: Date, snap: EnrollmentSnap, extra?: Partial<Parameters<typeof planSteps>[0]>) {
  return new Map(plan(now, snap, extra).decisions.map((decision) => [decision.stepKey, decision]));
}

describe('anti no-show planner', () => {
  it('trata horário sem fuso como parede em Brasília e instante com Z como UTC', () => {
    expect(meetingInstantFromInput('2026-11-12T15:00:00')?.toISOString()).toBe('2026-11-12T18:00:00.000Z');
    expect(meetingInstantFromInput('2026-11-12T18:00:00.000Z')?.toISOString()).toBe('2026-11-12T18:00:00.000Z');
    expect(meetingInstantFromInput('2026-11-12T15:00:00-03:00')?.toISOString()).toBe('2026-11-12T18:00:00.000Z');
  });

  it('véspera cai no dia útil anterior e pula feriado', () => {
    expect(previousBusinessDay('2026-11-12')).toBe('2026-11-11');
    expect(previousBusinessDay('2026-11-03')).toBe('2026-10-30');
    expect(addBusinessDays('2026-11-12', 1)).toBe('2026-11-13');
    expect(addBusinessDays('2026-11-12', 2)).toBe('2026-11-16');
    expect(addBusinessDays('2026-11-12', 7)).toBe('2026-11-24');
  });

  it('confirma na hora e deixa véspera, ligações e lembretes ancorados para o horário certo', () => {
    const now = new Date('2026-11-11T13:05:00.000Z'); // quarta 10:05 BRT
    const decisions = byKey(now, enrollment());
    expect(decisions.get('confirm_email')?.action).toBe('send');
    expect(decisions.get('confirm_whatsapp')?.action).toBe('send');
    expect(decisions.get('eve_email')?.action).toBe('send');
    expect(decisions.get('call_eve')).toMatchObject({ action: 'wait' });
    expect(decisions.get('call_3h')).toMatchObject({ action: 'wait' });
    expect(decisions.get('email_soon')).toMatchObject({ action: 'wait' });
    expect(decisions.get('whatsapp_20m')).toMatchObject({ action: 'wait' });
    expect(dueAt(readySteps().find((step) => step.stepKey === 'email_soon' && step.context === 'outbound')!, enrollment()).due?.toISOString())
      .toBe(atBrt('2026-11-12', 13).toISOString());
    expect(dueAt(readySteps().find((step) => step.stepKey === 'email_soon' && step.context === 'inbound')!, enrollment({ context: 'inbound' })).due?.toISOString())
      .toBe(atBrt('2026-11-12', 14).toISOString());
    expect(dueAt(readySteps().find((step) => step.stepKey === 'whatsapp_20m' && step.context === 'outbound')!, enrollment()).due?.toISOString())
      .toBe(atBrt('2026-11-12', 14, 40).toISOString());
  });

  it('abre as ligações só enquanto o lead não confirmou por nenhum canal', () => {
    const now = new Date('2026-11-12T15:30:00.000Z'); // quinta 12:30 BRT
    const open = byKey(now, enrollment());
    expect(open.get('call_eve')?.action).toBe('open_task');
    expect(open.get('call_3h')?.action).toBe('open_task');
    const confirmed = byKey(now, enrollment({ confirmedAt: new Date('2026-11-11T18:00:00.000Z') }));
    expect(confirmed.get('call_eve')).toMatchObject({ action: 'skip', reason: 'confirmed' });
    expect(confirmed.get('call_3h')).toMatchObject({ action: 'skip', reason: 'confirmed' });
    expect(confirmed.get('email_soon')?.action).toBe('wait');
  });

  it('reunião com menos de 3 horas fica só com confirmação e WhatsApp de 20 minutos', () => {
    const booked = new Date('2026-11-12T16:00:00.000Z'); // 13:00 BRT
    const now = new Date('2026-11-12T16:01:00.000Z');
    const decisions = byKey(now, enrollment({ bookedAt: booked, enrolledAt: booked }));
    expect(decisions.get('confirm_email')?.action).toBe('send');
    expect(decisions.get('whatsapp_20m')).toMatchObject({ action: 'wait' });
    for (const key of ['eve_email', 'eve_whatsapp', 'call_eve', 'call_3h', 'email_soon']) {
      expect(decisions.get(key)).toMatchObject({ action: 'skip', reason: 'short_meeting' });
    }
  });

  it('véspera não sai quando o agendamento foi feito com menos de 20 horas', () => {
    const booked = new Date('2026-11-11T23:00:00.000Z'); // quarta 20:00 BRT, 19h antes
    const now = new Date('2026-11-12T15:30:00.000Z');
    const decisions = byKey(now, enrollment({ bookedAt: booked, enrolledAt: booked }));
    expect(decisions.get('eve_email')).toMatchObject({ action: 'skip', reason: 'booked_close' });
    expect(decisions.get('call_eve')).toMatchObject({ action: 'skip', reason: 'before_booking' });
    expect(decisions.get('call_3h')?.action).toBe('open_task');
  });

  it('ligação de 3 horas nunca fica antes das 9h e some se esse piso passa da reunião', () => {
    const morning = enrollment({ meetingStartsAt: atBrt('2026-11-12', 10) });
    expect(dueAt(readySteps().find((step) => step.stepKey === 'call_3h')!, morning).due?.toISOString())
      .toBe(atBrt('2026-11-12', 9).toISOString());
    const tooEarly = enrollment({ meetingStartsAt: atBrt('2026-11-12', 8, 30), bookedAt: atBrt('2026-11-09', 11) });
    const decisions = byKey(atBrt('2026-11-12', 8), tooEarly);
    expect(decisions.get('call_3h')).toMatchObject({ action: 'skip', reason: 'unschedulable' });
  });

  it('canal desconectado marca não enviado e não conta como confirmação', () => {
    const now = new Date('2026-11-11T13:05:00.000Z');
    const decisions = byKey(now, enrollment(), { channels: { email: false, whatsapp: false } });
    expect(decisions.get('confirm_email')).toMatchObject({ action: 'not_sent', reason: 'gmail_desconectado' });
    expect(decisions.get('eve_whatsapp')).toMatchObject({ action: 'not_sent', reason: 'whatsapp_desconectado' });
    expect(decisions.get('call_3h')?.action).toBe('wait');
  });

  it('remarcação não reenvia a confirmação já enviada e recalcula o que está ancorado na reunião', () => {
    const now = new Date('2026-11-16T13:05:00.000Z'); // segunda seguinte 10:05, véspera da nova reunião
    const moved = enrollment({
      meetingStartsAt: new Date('2026-11-17T18:00:00.000Z'),
      bookedAt: new Date('2026-11-16T12:00:00.000Z'),
    });
    const decisions = byKey(now, moved, {
      runs: [{ stepKey: 'confirm_email', meetingStartsAt: MEETING.toISOString(), status: 'sent' }],
    });
    expect(decisions.get('confirm_email')).toMatchObject({ action: 'skip', reason: 'already_sent' });
    expect(decisions.get('eve_email')?.action).toBe('send');
  });

  it('matrícula encerrada não gera passo e o worker não envia', () => {
    expect(maySend('active')).toBe(true);
    expect(maySend('completed')).toBe(false);
    expect(plan(new Date(), enrollment({ status: 'completed' })).decisions).toEqual([]);
  });

  it('recuperação completa abre as tarefas em ordem e não marca o lead perdido', () => {
    const opened = new Date('2026-11-12T18:10:00.000Z');
    const snap = enrollment({
      phase: 'recovery',
      enrolledAt: opened,
      bookedAt: BOOKED,
      recoveryOpenedAt: opened,
    });
    const result = plan(new Date('2026-11-24T14:00:00.000Z'), snap);
    const tasks = result.decisions.filter((decision) => decision.action === 'open_task');
    expect(tasks.map((decision) => decision.stepKey)).toEqual([
      'rec_d0_call',
      'rec_d1_call',
      'rec_d2_whatsapp',
      'rec_d2_email',
      'rec_d4_call',
      'rec_d7_email',
      'rec_decide',
    ]);
    expect(tasks.every((decision) => decision.action === 'open_task' && decision.marksLeadLost === false)).toBe(true);
    expect(tasks.at(-1)).toMatchObject({ stepKey: 'rec_decide', completesEnrollment: true, marksLeadLost: false });
    expect(plan(new Date('2026-11-13T12:00:00.000Z'), snap, { replied: true }).stopRecovery).toBe(true);
  });

  it('passo automático fora de 8h às 20h espera, exceto o que está ancorado na reunião', () => {
    const now = atBrt('2026-11-11', 21);
    const decisions = byKey(now, enrollment());
    expect(decisions.get('eve_email')).toMatchObject({ action: 'wait' });
    const soon = byKey(
      atBrt('2026-11-12', 21, 45),
      enrollment({ meetingStartsAt: atBrt('2026-11-12', 22), bookedAt: atBrt('2026-11-10', 11), enrolledAt: atBrt('2026-11-10', 11) }),
    );
    expect(soon.get('whatsapp_20m')?.action).toBe('send');
  });

  it('na virada não reenvia passo cujo horário já passou', () => {
    const now = new Date('2026-11-12T16:30:00.000Z'); // 13:30 BRT, falta 1h30
    const keys = cutoverSkipKeys(readySteps(), enrollment(), now);
    expect(keys).toContain('confirm_email');
    expect(keys).toContain('eve_email');
    expect(keys).toContain('email_soon');
    expect(keys).not.toContain('whatsapp_20m');
  });

  it('escolhe a linha conectada e cai para a padrão da org quando a do SDR está caída', () => {
    const user = { id: 'user', status: 'disconnected', userId: 'sdr' };
    const org = { id: 'org', status: 'connected', userId: null };
    expect(pickWhatsAppAccount({ ...user, status: 'connected' }, org)?.id).toBe('user');
    expect(pickWhatsAppAccount(user, org)?.id).toBe('org');
    expect(pickWhatsAppAccount(null, org)?.id).toBe('org');
    expect(pickWhatsAppAccount(user, { ...org, status: 'disconnected' })).toBeNull();
    expect(pickGmailAccount({ id: 'mine', status: 'error', userId: 'sdr' }, [])?.id).toBe('mine');
    expect(pickGmailAccount(null, [{ id: 'other', status: 'connected', userId: 'ana' }])?.id).toBe('other');
    expect(pickGmailAccount(null, [])).toBeNull();
  });

  it('flag desligada não tira ninguém da régua antiga; ligada tira só a org', () => {
    const rows = [{ org_id: 'org-a' }, { org_id: 'ORG-B' }];
    expect(suppressionPlan(null)).toEqual({ tick: false, orgs: [] });
    expect(suppressionPlan('error')).toEqual({ tick: false, orgs: [] });
    expect(suppressionPlan({ enabled: false, allow_org_ids: [] })).toEqual({ tick: false, orgs: [] });
    expect(reminderRowsForOldRuler(rows, undefined)).toEqual(rows);
    const plan = suppressionPlan({ enabled: false, allow_org_ids: ['ORG-B'] });
    expect(plan.tick).toBe(true);
    expect(reminderRowsForOldRuler(rows, plan.orgs)).toEqual([{ org_id: 'org-a' }]);
    expect(reminderRowsForOldRuler(rows, 'all')).toEqual([]);
  });

  it('o seed da migration cobre o catálogo, nasce desligado e não mexe em cron', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261109133000_anti_no_show_cadence.sql'), 'utf8');
    for (const step of stepCatalog()) expect(sql).toContain(`'${step.stepKey}'`);
    expect(sql).toContain("'anti_no_show_cadence'");
    expect(sql).toContain('false');
    expect(sql).not.toContain('cron.schedule');
    expect(sql).not.toContain('UPDATE public.reminder_steps');
    expect(activateSteps(stepCatalog(), ['confirm_email']).find((step) => step.stepKey === 'eve_email')?.active).toBe(false);
  });
});
