import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stepCatalog } from './anti-no-show.logic';
import {
  closeProspectingForMeeting,
  onMeetingBooked,
  onMeetingEnded,
  onMeetingNoShow,
  onMeetingRescheduled,
  runAntiNoShowTick,
  type AntiNoShowDeps,
} from './engine';

const ORG = 'org-1';
const LEAD = 'lead-1';
const SDR = 'sdr-1';
const MEETING = '2026-11-12T18:00:00.000Z';
const DAY = new Date('2026-11-09T14:05:00.000Z'); // segunda 11:05 BRT

type Row = Record<string, unknown>;

function createDb() {
  const tables = new Map<string, Row[]>();
  const failures = new Map<string, { message: string; code?: string }>();
  function table(name: string): Row[] {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  }
  function from(name: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let patch: Row | null = null;
    let pending: Row | null = null;
    let limitN: number | null = null;
    let orderCol: string | null = null;
    let orderAsc = true;
    let conflict = 'id';
    let ignoreDuplicates = false;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push((row) => row[col] === val);
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((row) => vals.includes(row[col]));
        return builder;
      },
      is: (col: string, val: unknown) => {
        filters.push((row) => (val === null ? row[col] == null : row[col] === val));
        return builder;
      },
      gt: (col: string, val: unknown) => {
        filters.push((row) => (row[col] as number | string) > (val as number | string));
        return builder;
      },
      gte: (col: string, val: unknown) => {
        filters.push((row) => row[col] != null && (row[col] as number | string) >= (val as number | string));
        return builder;
      },
      contains: (col: string, value: Record<string, unknown>) => {
        filters.push((row) => {
          const meta = (row[col] ?? {}) as Record<string, unknown>;
          return Object.entries(value).every(([key, item]) => meta[key] === item);
        });
        return builder;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderCol = col;
        orderAsc = opts?.ascending !== false;
        return builder;
      },
      limit: (n: number) => {
        limitN = n;
        return builder;
      },
      update: (value: Row) => {
        op = 'update';
        patch = value;
        return builder;
      },
      insert: (value: Row) => {
        op = 'insert';
        pending = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...value };
        return builder;
      },
      upsert: (value: Row, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        op = 'upsert';
        pending = { id: crypto.randomUUID(), ...value };
        conflict = opts?.onConflict ?? 'id';
        ignoreDuplicates = opts?.ignoreDuplicates === true;
        return builder;
      },
      single: () => finish(true),
      maybeSingle: () => finish(true),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => finish(false).then(resolve, reject),
    };

    function matched(): Row[] {
      let rows = table(name).filter((row) => filters.every((filter) => filter(row)));
      if (orderCol) {
        const col = orderCol;
        rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (orderAsc ? 1 : -1));
      }
      if (limitN != null) rows = rows.slice(0, limitN);
      return rows;
    }

    async function finish(single: boolean) {
      const fail = failures.get(`${name}:${op}`);
      if (fail) return { data: null, error: fail };
      if (op === 'insert' && pending) {
        table(name).push(pending);
        return { data: single ? pending : [pending], error: null };
      }
      if (op === 'upsert' && pending) {
        const keys = conflict.split(',');
        const existing = table(name).find((row) => keys.every((key) => row[key] === pending?.[key]));
        if (!existing) table(name).push(pending);
        else if (!ignoreDuplicates) Object.assign(existing, pending);
        return { data: null, error: null };
      }
      if (op === 'update' && patch) {
        for (const row of matched()) Object.assign(row, patch);
        return { data: null, error: null };
      }
      const rows = matched();
      return { data: single ? rows[0] ?? null : rows, error: null };
    }
    return builder;
  }
  return {
    tables,
    failures,
    client: { from },
    rows: (name: string) => table(name),
  };
}

function seedLead(db: ReturnType<typeof createDb>, overrides: Row = {}) {
  db.rows('leads').push({
    id: LEAD,
    org_id: ORG,
    assigned_to: SDR,
    lead_source: 'Outbound',
    meeting_starts_at: MEETING,
    meeting_scheduled_at: DAY.toISOString(),
    meeting_held_at: null,
    meeting_no_show_at: null,
    status: 'qualified',
    email: 'ana@empresa.com',
    telefone: '11999999999',
    nome_fantasia: 'ACME',
    razao_social: 'ACME LTDA',
    cnpj: '000',
    first_name: 'Ana',
    porte: null,
    endereco: null,
    ...overrides,
  });
}

function seedFlag(db: ReturnType<typeof createDb>, on: boolean) {
  db.rows('app_flags').push({
    key: 'anti_no_show_cadence',
    enabled: false,
    allow_org_ids: on ? [ORG] : [],
    allow_user_ids: [],
  });
}

function seedSteps(db: ReturnType<typeof createDb>, activeAutos: string[] = []) {
  const wanted = new Set(activeAutos);
  for (const step of stepCatalog()) {
    db.rows('anti_no_show_steps').push({
      org_id: ORG,
      step_key: step.stepKey,
      phase: step.phase,
      context: step.context,
      channel: step.channel,
      mode: step.mode,
      anchor: step.anchor,
      offset_minutes: step.offsetMinutes,
      business_day_offset: step.businessDayOffset,
      clock_hour: step.clockHour,
      clock_minute: step.clockMinute,
      active: step.mode === 'task' || wanted.has(step.stepKey),
      only_if_unconfirmed: step.onlyIfUnconfirmed,
      skip_if_booked_within_hours: step.skipIfBookedWithinHours,
      min_hours_before_meeting: step.minHoursBeforeMeeting,
      quiet_hours_exempt: step.quietHoursExempt,
      not_before_hour_brt: step.notBeforeHourBrt,
      message_template_id: step.mode === 'auto' ? 'tpl-1' : null,
    });
  }
  db.rows('message_templates').push({ id: 'tpl-1', subject: 'Reunião', body: 'Olá {{primeiro_nome}} {{meet_link}}' });
  db.rows('reminder_source_context').push({ org_id: ORG, lead_source: 'Outbound', context: 'outbound' });
}

function deps(db: ReturnType<typeof createDb>, now = DAY): AntiNoShowDeps & { emails: unknown[]; whatsapps: unknown[]; notices: unknown[] } {
  const emails: unknown[] = [];
  const whatsapps: unknown[] = [];
  const notices: unknown[] = [];
  return {
    now: () => now,
    emails,
    whatsapps,
    notices,
    sendEmail: vi.fn(async (args) => {
      emails.push(args);
      return { ok: true };
    }),
    sendWhatsApp: vi.fn(async (args) => {
      whatsapps.push(args);
      return { ok: true };
    }),
    notify: vi.fn(async (args) => {
      notices.push(args);
    }),
    notifyManagers: vi.fn(async (args) => {
      notices.push(args);
    }),
  };
}

describe('ciclo anti no-show', () => {
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb();
  });

  it('agendar pelo SDR com a flag ligada encerra a prospecção e abre a cadência', async () => {
    seedFlag(db, true);
    seedLead(db);
    seedSteps(db, ['confirm_email', 'confirm_whatsapp']);
    db.rows('cadence_enrollments').push({ id: 'cad-1', lead_id: LEAD, status: 'active' });
    db.rows('cadence_enrollments').push({ id: 'cad-2', lead_id: LEAD, status: 'paused' });
    db.rows('scheduled_activities').push({ id: 'ret-1', org_id: ORG, lead_id: LEAD, status: 'pending', kind: 'return' });
    db.rows('scheduled_activities').push({ id: 'limbo-1', org_id: ORG, lead_id: LEAD, status: 'pending', kind: 'limbo_followup' });
    db.rows('whatsapp_send_queue').push({ id: 'q-1', org_id: ORG, lead_id: LEAD, status: 'pending' });
    db.rows('gmail_connections').push({ id: 'g-1', org_id: ORG, user_id: SDR, status: 'connected' });
    db.rows('whatsapp_instances').push({ id: 'w-1', org_id: ORG, user_id: SDR, status: 'connected' });
    const clock = deps(db);

    const closed = await closeProspectingForMeeting(db.client as never, {
      orgId: ORG, leadId: LEAD, userId: SDR, eventId: 'evt-1', source: 'sdr',
    });
    expect(closed.ok).toBe(true);
    await onMeetingBooked(db.client as never, {
      orgId: ORG, leadId: LEAD, userId: SDR, source: 'sdr', eventId: 'evt-1', startTime: '2026-11-12T15:00:00',
    }, clock);

    expect(db.rows('cadence_enrollments').every((row) => row.status === 'completed')).toBe(true);
    expect(db.rows('contact_holds')).toEqual([
      expect.objectContaining({ lead_id: LEAD, tipo: 'prospeccao', origem: 'reuniao_agendada' }),
    ]);
    expect(db.rows('scheduled_activities').find((row) => row.id === 'ret-1')?.status).toBe('cancelled');
    expect(db.rows('scheduled_activities').find((row) => row.id === 'limbo-1')?.status).toBe('pending');
    expect(db.rows('whatsapp_send_queue')[0]?.status).toBe('canceled');
    const timelines = db.rows('interactions').filter((row) => row.message_content === 'prospecção encerrada por reunião');
    expect(timelines).toHaveLength(1);
    expect(db.rows('leads')[0]?.status).toBe('qualified');
    const enrollment = db.rows('anti_no_show_enrollments').find((row) => row.status === 'active');
    expect(enrollment).toMatchObject({ phase: 'pre_meeting', source: 'sdr', context: 'outbound' });
    expect(clock.emails).toHaveLength(1);
    expect(clock.whatsapps).toHaveLength(1);
    expect(db.rows('anti_no_show_runs').some((row) => row.step_key === 'confirm_email' && row.status === 'sent')).toBe(true);

    await closeProspectingForMeeting(db.client as never, {
      orgId: ORG, leadId: LEAD, userId: SDR, eventId: 'evt-1', source: 'sdr',
    });
    expect(db.rows('interactions').filter((row) => row.message_content === 'prospecção encerrada por reunião')).toHaveLength(1);
  });

  it('agendar pelo BDR com a flag desligada mantém o hold e não abre a cadência nova', async () => {
    seedFlag(db, false);
    seedLead(db);
    db.rows('cadence_enrollments').push({ id: 'cad-1', lead_id: LEAD, status: 'active' });
    db.rows('scheduled_activities').push({ id: 'ret-1', org_id: ORG, lead_id: LEAD, status: 'pending', kind: 'return' });

    const closed = await closeProspectingForMeeting(db.client as never, {
      orgId: ORG, leadId: LEAD, userId: SDR, eventId: 'evt-bdr', source: 'bdr',
    });
    expect(closed.ok).toBe(true);
    await onMeetingBooked(db.client as never, {
      orgId: ORG, leadId: LEAD, userId: SDR, source: 'bdr', eventId: 'evt-bdr', startTime: MEETING,
    }, deps(db));

    expect(db.rows('cadence_enrollments')[0]?.status).toBe('completed');
    expect(db.rows('contact_holds')).toHaveLength(1);
    expect(db.rows('scheduled_activities')[0]?.status).toBe('pending');
    expect(db.rows('anti_no_show_enrollments')).toHaveLength(0);
    expect(db.rows('interactions')).toHaveLength(0);
  });

  it('erro ao concluir a matrícula não segue para hold nem timeline', async () => {
    seedFlag(db, true);
    db.failures.set('cadence_enrollments:update', { message: 'falha de banco' });
    const closed = await closeProspectingForMeeting(db.client as never, {
      orgId: ORG, leadId: LEAD, userId: SDR, eventId: 'evt-1', source: 'sdr',
    });
    expect(closed).toEqual({ ok: false, error: 'falha de banco' });
    expect(db.rows('contact_holds')).toHaveLength(0);
  });

  it('remarcar, cancelar e realizada mantêm a mesma matrícula e cancelam pendências', async () => {
    seedFlag(db, true);
    seedLead(db);
    seedSteps(db);
    db.rows('gmail_connections').push({ id: 'g-1', org_id: ORG, user_id: SDR, status: 'connected' });
    db.rows('anti_no_show_enrollments').push({
      id: 'enr-1', org_id: ORG, lead_id: LEAD, phase: 'pre_meeting', status: 'active',
      meeting_starts_at: MEETING, context: 'outbound', confirmed_at: '2026-11-10T12:00:00.000Z',
      confirmation_source: 'confirmacoes_reuniao', enrolled_at: DAY.toISOString(), booked_at: DAY.toISOString(),
      recovery_opened_at: null, source: 'sdr', sdr_user_id: SDR, calendar_event_id: 'evt-1',
    });
    db.rows('anti_no_show_runs').push({
      id: 'run-1', enrollment_id: 'enr-1', step_key: 'confirm_email', meeting_starts_at: MEETING, status: 'sent',
    });
    db.rows('anti_no_show_runs').push({
      id: 'run-2', enrollment_id: 'enr-1', step_key: 'call_eve', meeting_starts_at: MEETING, status: 'task_open',
    });
    db.rows('scheduled_activities').push({
      id: 'task-1', org_id: ORG, lead_id: LEAD, status: 'pending', kind: 'anti_no_show', user_id: SDR,
    });

    db.rows('leads')[0]!.meeting_starts_at = '2026-11-17T18:00:00.000Z';
    await onMeetingRescheduled(db.client as never, {
      orgId: ORG, leadId: LEAD, userId: SDR, source: 'sdr', eventId: 'evt-2', startTime: '2026-11-17T15:00:00',
    }, deps(db, new Date('2026-11-16T14:00:00.000Z')));

    const enrollment = db.rows('anti_no_show_enrollments').find((row) => row.id === 'enr-1');
    expect(enrollment).toMatchObject({
      status: 'active',
      meeting_starts_at: '2026-11-17T18:00:00.000Z',
      confirmed_at: null,
      calendar_event_id: 'evt-2',
    });
    expect(db.rows('anti_no_show_runs').find((row) => row.id === 'run-1')?.status).toBe('sent');
    expect(db.rows('anti_no_show_runs').find((row) => row.id === 'run-2')?.status).toBe('cancelled');
    expect(db.rows('scheduled_activities').find((row) => row.id === 'task-1')?.status).toBe('cancelled');
    expect(db.rows('anti_no_show_runs').some((row) => row.step_key === 'confirm_email' && row.status === 'sent' && row.meeting_starts_at !== MEETING)).toBe(false);

    await onMeetingEnded(db.client as never, { orgId: ORG, leadId: LEAD, userId: SDR, reason: 'cancelled' });
    expect(db.rows('anti_no_show_enrollments').find((row) => row.id === 'enr-1')).toMatchObject({
      status: 'completed', completed_reason: 'cancelled',
    });

    db.rows('anti_no_show_enrollments')[0]!.status = 'active';
    db.rows('anti_no_show_enrollments')[0]!.completed_reason = null;
    await onMeetingEnded(db.client as never, { orgId: ORG, leadId: LEAD, userId: SDR, reason: 'held' });
    expect(db.rows('anti_no_show_enrollments')[0]).toMatchObject({ status: 'completed', completed_reason: 'held' });
  });

  it('no-show abre recuperação e a recuperação completa não marca perdido', async () => {
    seedFlag(db, true);
    seedLead(db);
    seedSteps(db);
    db.rows('anti_no_show_enrollments').push({
      id: 'enr-pre', org_id: ORG, lead_id: LEAD, phase: 'pre_meeting', status: 'active',
      meeting_starts_at: MEETING, context: 'outbound', confirmed_at: null, confirmation_source: null,
      enrolled_at: DAY.toISOString(), booked_at: DAY.toISOString(), recovery_opened_at: null,
      source: 'sdr', sdr_user_id: SDR, calendar_event_id: 'evt-1',
    });
    const opened = await onMeetingNoShow(db.client as never, {
      orgId: ORG, leadId: LEAD, userId: SDR, source: 'sdr',
    }, deps(db, new Date('2026-11-12T18:20:00.000Z')));
    expect(opened).toBe(true);
    expect(db.rows('anti_no_show_enrollments').find((row) => row.id === 'enr-pre')).toMatchObject({
      status: 'completed', completed_reason: 'no_show',
    });
    const recovery = db.rows('anti_no_show_enrollments').find((row) => row.phase === 'recovery' && row.status === 'active');
    expect(recovery).toBeTruthy();
    expect(db.rows('scheduled_activities').some((row) => row.kind === 'anti_no_show' && row.status === 'pending')).toBe(true);
    expect(db.rows('leads')[0]?.status).toBe('qualified');

    recovery!.enrolled_at = '2026-11-12T18:10:00.000Z';
    recovery!.recovery_opened_at = '2026-11-12T18:10:00.000Z';
    recovery!.booked_at = DAY.toISOString();
    await runAntiNoShowTick(db.client as never, [ORG], deps(db, new Date('2026-11-24T14:00:00.000Z')));
    expect(db.rows('anti_no_show_enrollments').find((row) => row.id === recovery!.id)).toMatchObject({
      status: 'completed', completed_reason: 'recovery_exhausted',
    });
    expect(db.rows('leads')[0]?.status).toBe('qualified');
    expect(db.rows('scheduled_activities').filter((row) => row.kind === 'anti_no_show' && row.status === 'pending').length).toBeGreaterThanOrEqual(7);
    expect(db.rows('interactions').some((row) => String(row.message_content).includes('não foi marcado como perdido'))).toBe(true);
  });

  it('remarcar durante a recuperação volta para a fase anterior à reunião', async () => {
    seedFlag(db, true);
    seedLead(db, { meeting_starts_at: '2026-11-17T18:00:00.000Z' });
    seedSteps(db, ['confirm_email']);
    db.rows('gmail_connections').push({ id: 'g-1', org_id: ORG, user_id: SDR, status: 'connected' });
    db.rows('anti_no_show_enrollments').push({
      id: 'enr-rec', org_id: ORG, lead_id: LEAD, phase: 'recovery', status: 'active',
      meeting_starts_at: MEETING, context: 'outbound', confirmed_at: null, confirmation_source: null,
      enrolled_at: MEETING, booked_at: DAY.toISOString(), recovery_opened_at: MEETING,
      source: 'sdr', sdr_user_id: SDR, calendar_event_id: 'evt-1',
    });
    await onMeetingRescheduled(db.client as never, {
      orgId: ORG, leadId: LEAD, userId: SDR, source: 'sdr', eventId: 'evt-3', startTime: '2026-11-17T15:00:00',
    }, deps(db, new Date('2026-11-16T14:00:00.000Z')));
    expect(db.rows('anti_no_show_enrollments').find((row) => row.id === 'enr-rec')).toMatchObject({
      status: 'completed', completed_reason: 'superseded',
    });
    expect(db.rows('anti_no_show_enrollments').find((row) => row.status === 'active')).toMatchObject({
      phase: 'pre_meeting', meeting_starts_at: '2026-11-17T18:00:00.000Z',
    });
  });

  it('WhatsApp e Gmail desconectados geram não enviado e aviso, sem disparo', async () => {
    seedFlag(db, true);
    seedLead(db);
    seedSteps(db, ['confirm_email', 'confirm_whatsapp']);
    db.rows('whatsapp_instances').push({ id: 'w-1', org_id: ORG, user_id: SDR, status: 'disconnected' });
    const clock = deps(db);
    await onMeetingBooked(db.client as never, {
      orgId: ORG, leadId: LEAD, userId: SDR, source: 'sdr', eventId: 'evt-1', startTime: '2026-11-12T15:00:00',
    }, clock);
    expect(clock.emails).toHaveLength(0);
    expect(clock.whatsapps).toHaveLength(0);
    const runs = db.rows('anti_no_show_runs');
    expect(runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ step_key: 'confirm_email', status: 'not_sent', detail: 'gmail_desconectado' }),
      expect.objectContaining({ step_key: 'confirm_whatsapp', status: 'not_sent', detail: 'whatsapp_desconectado' }),
    ]));
    expect(clock.notices.length).toBeGreaterThanOrEqual(2);
  });

  it('WhatsApp do SDR desconectado cai na linha padrão da org', async () => {
    seedFlag(db, true);
    seedLead(db);
    seedSteps(db, ['confirm_whatsapp']);
    db.rows('whatsapp_instances').push({ id: 'w-sdr', org_id: ORG, user_id: SDR, status: 'disconnected' });
    db.rows('whatsapp_instances').push({ id: 'w-org', org_id: ORG, user_id: null, status: 'connected' });
    const clock = deps(db);
    await onMeetingBooked(db.client as never, {
      orgId: ORG, leadId: LEAD, userId: SDR, source: 'sdr', eventId: 'evt-1', startTime: '2026-11-12T15:00:00',
    }, clock);
    expect(clock.whatsapps).toEqual([expect.objectContaining({ userId: undefined })]);
  });

  it('Gmail do SDR ausente cai em outra conta conectada da org', async () => {
    seedFlag(db, true);
    seedLead(db);
    seedSteps(db, ['confirm_email']);
    db.rows('gmail_connections').push({ id: 'g-2', org_id: ORG, user_id: 'ana', status: 'connected' });
    const clock = deps(db);
    await onMeetingBooked(db.client as never, {
      orgId: ORG, leadId: LEAD, userId: SDR, source: 'sdr', eventId: 'evt-1', startTime: '2026-11-12T15:00:00',
    }, clock);
    expect(clock.emails).toEqual([expect.objectContaining({ userId: 'ana' })]);
  });

  it('não reenvia o que a régua antiga já registrou e envia o que ela ainda não mandou', async () => {
    seedFlag(db, true);
    const meeting = '2026-11-09T15:00:00.000Z';
    seedLead(db, { meeting_starts_at: meeting, meeting_scheduled_at: '2026-11-09T12:00:00.000Z' });
    seedSteps(db, ['confirm_email', 'whatsapp_20m']);
    db.rows('gmail_connections').push({ id: 'g-1', org_id: ORG, user_id: SDR, status: 'connected' });
    db.rows('whatsapp_instances').push({ id: 'w-1', org_id: ORG, user_id: SDR, status: 'connected' });
    db.rows('reminder_steps').push({
      id: 'rs-email', org_id: ORG, channel: 'email', anchor: 'on_book', offset_minutes: 0, context: 'outbound',
    });
    db.rows('meeting_reminder_log').push({
      reminder_step_id: 'rs-email', lead_id: LEAD, meeting_starts_at: meeting,
    });
    const clock = deps(db, new Date('2026-11-09T14:45:00.000Z'));
    await runAntiNoShowTick(db.client as never, [ORG], clock);
    expect(clock.emails).toHaveLength(0);
    expect(clock.whatsapps).toHaveLength(1);
    expect(db.rows('anti_no_show_runs')).toEqual(expect.arrayContaining([
      expect.objectContaining({ step_key: 'confirm_email', status: 'skipped', detail: 'virada' }),
      expect.objectContaining({ step_key: 'whatsapp_20m', status: 'sent' }),
    ]));
  });

  it('worker ignora matrícula completed e não envia depois do encerramento', async () => {
    seedFlag(db, true);
    seedLead(db, { meeting_starts_at: '2026-11-08T18:00:00.000Z' });
    seedSteps(db, ['confirm_email']);
    db.rows('gmail_connections').push({ id: 'g-1', org_id: ORG, user_id: SDR, status: 'connected' });
    db.rows('anti_no_show_enrollments').push({
      id: 'enr-done', org_id: ORG, lead_id: LEAD, phase: 'pre_meeting', status: 'completed',
      meeting_starts_at: MEETING, context: 'outbound', confirmed_at: null, confirmation_source: null,
      enrolled_at: DAY.toISOString(), booked_at: DAY.toISOString(), recovery_opened_at: null,
      completed_reason: 'cancelled', source: 'sdr', sdr_user_id: SDR, calendar_event_id: 'evt-1',
    });
    const clock = deps(db);
    await runAntiNoShowTick(db.client as never, [ORG], clock);
    expect(clock.emails).toHaveLength(0);
    expect(db.rows('anti_no_show_runs')).toHaveLength(0);
  });

  it('reunião em menos de 3 horas não abre ligação', async () => {
    seedFlag(db, true);
    seedLead(db, { meeting_starts_at: '2026-11-09T16:30:00.000Z' });
    seedSteps(db, ['confirm_email', 'whatsapp_20m']);
    db.rows('gmail_connections').push({ id: 'g-1', org_id: ORG, user_id: SDR, status: 'connected' });
    db.rows('whatsapp_instances').push({ id: 'w-1', org_id: ORG, user_id: SDR, status: 'connected' });
    await onMeetingBooked(db.client as never, {
      orgId: ORG, leadId: LEAD, userId: SDR, source: 'sdr', eventId: 'evt-1', startTime: '2026-11-09T13:30:00',
    }, deps(db, new Date('2026-11-09T14:05:00.000Z')));
    const runs = db.rows('anti_no_show_runs');
    expect(runs.some((row) => row.step_key === 'call_eve')).toBe(true);
    expect(runs.find((row) => row.step_key === 'call_eve')).toMatchObject({ status: 'skipped', detail: 'short_meeting' });
    expect(runs.find((row) => row.step_key === 'call_3h')).toMatchObject({ status: 'skipped', detail: 'short_meeting' });
    expect(runs.find((row) => row.step_key === 'confirm_email')?.status).toBe('sent');
  });
});
