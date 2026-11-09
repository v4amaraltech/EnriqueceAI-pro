import { brtDateKey, isBrBusinessDay } from '@/lib/utils/br-holidays';

/**
 * Plano puro da cadência anti no-show. Sem banco e sem envio.
 * Horários em America/Sao_Paulo (UTC-3, sem horário de verão).
 * Automáticos entre 8h e 20h, exceto os ancorados na reunião.
 */

const BRT_OFFSET_MS = 3 * 3600 * 1000;
const QUIET_START_HOUR = 8;
const QUIET_END_HOUR = 20;

export type AntiNoShowPhase = 'pre_meeting' | 'recovery';
export type AntiNoShowContext = 'inbound' | 'outbound' | 'any';
export type AntiNoShowChannel = 'email' | 'whatsapp' | 'phone';
export type AntiNoShowMode = 'auto' | 'task';
export type AntiNoShowAnchor = 'on_book' | 'meeting_offset' | 'business_clock' | 'after_meeting';
export type RunStatus = 'sent' | 'skipped' | 'failed' | 'not_sent' | 'cancelled' | 'task_open' | 'task_done';

export interface StepDef {
  stepKey: string;
  phase: AntiNoShowPhase;
  context: AntiNoShowContext;
  channel: AntiNoShowChannel;
  mode: AntiNoShowMode;
  anchor: AntiNoShowAnchor;
  offsetMinutes: number | null;
  businessDayOffset: number | null;
  clockHour: number | null;
  clockMinute: number | null;
  active: boolean;
  onlyIfUnconfirmed: boolean;
  skipIfBookedWithinHours: number | null;
  minHoursBeforeMeeting: number | null;
  quietHoursExempt: boolean;
  notBeforeHourBrt: number | null;
  messageTemplateId: string | null;
}

export interface EnrollmentSnap {
  id: string;
  phase: AntiNoShowPhase;
  status: 'active' | 'completed';
  meetingStartsAt: Date;
  enrolledAt: Date;
  /** Instante usado para "agendado há menos de X horas". Na remarcação, é o instante da nova data. */
  bookedAt: Date;
  context: 'inbound' | 'outbound';
  confirmedAt: Date | null;
  recoveryOpenedAt: Date | null;
}

export interface RunSnap {
  stepKey: string;
  meetingStartsAt: string;
  status: RunStatus;
}

export interface ChannelAccount {
  id: string;
  status: string;
  userId: string | null;
}

export type PlanDecision =
  | { action: 'skip'; stepKey: string; reason: string; persist: boolean }
  | { action: 'wait'; stepKey: string; dueAt: string }
  | { action: 'send'; stepKey: string; channel: 'email' | 'whatsapp'; dueAt: string; templateId: string | null }
  | {
      action: 'open_task';
      stepKey: string;
      channel: AntiNoShowChannel;
      dueAt: string;
      notes: string;
      completesEnrollment: boolean;
      marksLeadLost: false;
    }
  | { action: 'not_sent'; stepKey: string; channel: AntiNoShowChannel; reason: string; dueAt: string };

export interface PlanResult {
  decisions: PlanDecision[];
  /** Lead respondeu na recuperação: parar, gravar histórico, não marcar perdido. */
  stopRecovery: boolean;
}

const TASK_NOTES: Record<string, string> = {
  call_eve: 'Anti no-show: ligar na véspera. O lead ainda não confirmou a reunião por nenhum canal.',
  call_3h: 'Anti no-show: ligar 3 horas antes. O lead ainda não confirmou.',
  rec_d0_call: 'No-show: ligar e tentar remarcar a reunião.',
  rec_d1_call: 'No-show D1: ligar de manhã.',
  rec_d2_whatsapp: 'No-show D2: WhatsApp manual oferecendo dois horários para remarcar.',
  rec_d2_email: 'No-show D2: e-mail manual oferecendo dois horários para remarcar.',
  rec_d4_call: 'No-show D4: ligar à tarde.',
  rec_d7_email: 'No-show D7: último e-mail manual.',
  rec_decide:
    'Recuperação de no-show encerrada sem resposta. Decidir o destino do lead. Não marcar como perdido automaticamente.',
};

function blankStep(partial: Omit<StepDef, 'offsetMinutes' | 'businessDayOffset' | 'clockHour' | 'clockMinute' | 'active' | 'onlyIfUnconfirmed' | 'skipIfBookedWithinHours' | 'minHoursBeforeMeeting' | 'quietHoursExempt' | 'notBeforeHourBrt' | 'messageTemplateId'> & Partial<StepDef>): StepDef {
  return {
    offsetMinutes: null,
    businessDayOffset: null,
    clockHour: null,
    clockMinute: null,
    active: false,
    onlyIfUnconfirmed: false,
    skipIfBookedWithinHours: null,
    minHoursBeforeMeeting: null,
    quietHoursExempt: false,
    notBeforeHourBrt: null,
    messageTemplateId: null,
    ...partial,
  };
}

/** Catálogo equivalente ao seed da migration. Automáticos nascem desligados; a migration copia o active real de reminder_steps. */
export function stepCatalog(): StepDef[] {
  const contexts = ['inbound', 'outbound'] as const;
  const confirm = contexts.flatMap((context) => [
    blankStep({ stepKey: 'confirm_email', phase: 'pre_meeting', context, channel: 'email', mode: 'auto', anchor: 'on_book' }),
    blankStep({ stepKey: 'confirm_whatsapp', phase: 'pre_meeting', context, channel: 'whatsapp', mode: 'auto', anchor: 'on_book' }),
    blankStep({
      stepKey: 'eve_email',
      phase: 'pre_meeting',
      context,
      channel: 'email',
      mode: 'auto',
      anchor: 'business_clock',
      businessDayOffset: -1,
      clockHour: 10,
      skipIfBookedWithinHours: 20,
      minHoursBeforeMeeting: 3,
    }),
    blankStep({
      stepKey: 'eve_whatsapp',
      phase: 'pre_meeting',
      context,
      channel: 'whatsapp',
      mode: 'auto',
      anchor: 'business_clock',
      businessDayOffset: -1,
      clockHour: 10,
      skipIfBookedWithinHours: 20,
      minHoursBeforeMeeting: 3,
    }),
  ]);

  return [
    ...confirm,
    blankStep({
      stepKey: 'call_eve',
      phase: 'pre_meeting',
      context: 'any',
      channel: 'phone',
      mode: 'task',
      anchor: 'business_clock',
      businessDayOffset: -1,
      clockHour: 16,
      active: true,
      onlyIfUnconfirmed: true,
      minHoursBeforeMeeting: 3,
    }),
    blankStep({
      stepKey: 'call_3h',
      phase: 'pre_meeting',
      context: 'any',
      channel: 'phone',
      mode: 'task',
      anchor: 'meeting_offset',
      offsetMinutes: -180,
      active: true,
      onlyIfUnconfirmed: true,
      minHoursBeforeMeeting: 3,
      notBeforeHourBrt: 9,
    }),
    blankStep({
      stepKey: 'email_soon',
      phase: 'pre_meeting',
      context: 'inbound',
      channel: 'email',
      mode: 'auto',
      anchor: 'meeting_offset',
      offsetMinutes: -60,
      minHoursBeforeMeeting: 3,
      quietHoursExempt: true,
    }),
    blankStep({
      stepKey: 'email_soon',
      phase: 'pre_meeting',
      context: 'outbound',
      channel: 'email',
      mode: 'auto',
      anchor: 'meeting_offset',
      offsetMinutes: -120,
      minHoursBeforeMeeting: 3,
      quietHoursExempt: true,
    }),
    ...contexts.map((context) =>
      blankStep({
        stepKey: 'whatsapp_20m',
        phase: 'pre_meeting',
        context,
        channel: 'whatsapp',
        mode: 'auto',
        anchor: 'meeting_offset',
        offsetMinutes: -20,
        quietHoursExempt: true,
      }),
    ),
    blankStep({
      stepKey: 'rec_d0_call',
      phase: 'recovery',
      context: 'any',
      channel: 'phone',
      mode: 'task',
      anchor: 'after_meeting',
      offsetMinutes: 15,
      active: true,
    }),
    blankStep({
      stepKey: 'rec_d1_call',
      phase: 'recovery',
      context: 'any',
      channel: 'phone',
      mode: 'task',
      anchor: 'business_clock',
      businessDayOffset: 1,
      clockHour: 9,
      active: true,
    }),
    blankStep({
      stepKey: 'rec_d2_whatsapp',
      phase: 'recovery',
      context: 'any',
      channel: 'whatsapp',
      mode: 'task',
      anchor: 'business_clock',
      businessDayOffset: 2,
      clockHour: 10,
      active: true,
    }),
    blankStep({
      stepKey: 'rec_d2_email',
      phase: 'recovery',
      context: 'any',
      channel: 'email',
      mode: 'task',
      anchor: 'business_clock',
      businessDayOffset: 2,
      clockHour: 10,
      active: true,
    }),
    blankStep({
      stepKey: 'rec_d4_call',
      phase: 'recovery',
      context: 'any',
      channel: 'phone',
      mode: 'task',
      anchor: 'business_clock',
      businessDayOffset: 4,
      clockHour: 14,
      active: true,
    }),
    blankStep({
      stepKey: 'rec_d7_email',
      phase: 'recovery',
      context: 'any',
      channel: 'email',
      mode: 'task',
      anchor: 'business_clock',
      businessDayOffset: 7,
      clockHour: 10,
      active: true,
    }),
    blankStep({
      stepKey: 'rec_decide',
      phase: 'recovery',
      context: 'any',
      channel: 'phone',
      mode: 'task',
      anchor: 'business_clock',
      businessDayOffset: 7,
      clockHour: 11,
      active: true,
    }),
  ];
}

export function activateSteps(steps: StepDef[], keys: string[]): StepDef[] {
  const wanted = new Set(keys);
  return steps.map((step) => (wanted.has(step.stepKey) ? { ...step, active: true } : step));
}

/** O worker só envia matrícula active. completed, paused e o resto são ignorados. */
export function maySend(status: string | null | undefined): boolean {
  return status === 'active';
}

export function brtHour(date: Date): number {
  return new Date(date.getTime() - BRT_OFFSET_MS).getUTCHours();
}

function dateParts(dateKey: string): [number, number, number] {
  const [year, month, day] = dateKey.split('-');
  return [Number(year), Number(month), Number(day)];
}

export function atBrt(dateKey: string, hour: number, minute = 0): Date {
  const [year, month, day] = dateParts(dateKey);
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute, 0, 0));
}

function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateParts(dateKey);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  cursor.setUTCDate(cursor.getUTCDate() + days);
  const y = cursor.getUTCFullYear();
  const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
  const d = String(cursor.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function previousBusinessDay(dateKey: string): string {
  let cursor = shiftDateKey(dateKey, -1);
  for (let guard = 0; guard < 21 && !isBrBusinessDay(cursor); guard += 1) {
    cursor = shiftDateKey(cursor, -1);
  }
  return cursor;
}

export function addBusinessDays(dateKey: string, days: number): string {
  let cursor = dateKey;
  let left = days;
  for (let guard = 0; left > 0 && guard < 40; guard += 1) {
    cursor = shiftDateKey(cursor, 1);
    if (isBrBusinessDay(cursor)) left -= 1;
  }
  return cursor;
}

/** 8h inclusive até 20h exclusive. Passos ancorados na reunião não passam por aqui. */
export function isAntiNoShowQuiet(now: Date): boolean {
  const hour = brtHour(now);
  return hour < QUIET_START_HOUR || hour >= QUIET_END_HOUR;
}

function nextWindowOpen(now: Date): Date {
  const key = brtDateKey(now);
  const open = atBrt(key, QUIET_START_HOUR, 0);
  if (now.getTime() < open.getTime()) return open;
  return atBrt(shiftDateKey(key, 1), QUIET_START_HOUR, 0);
}

export interface DueResult {
  due: Date | null;
  reason: string | null;
}

/** Horário do passo. `reason` preenchido quando o passo não cabe antes da reunião. */
export function dueAt(step: StepDef, enrollment: EnrollmentSnap): DueResult {
  const meeting = enrollment.meetingStartsAt;

  if (step.anchor === 'on_book') {
    let due = new Date(enrollment.bookedAt);
    if (!step.quietHoursExempt && isAntiNoShowQuiet(due)) due = nextWindowOpen(due);
    if (due.getTime() >= meeting.getTime()) return { due: null, reason: 'after_meeting' };
    return { due, reason: null };
  }

  if (step.anchor === 'after_meeting') {
    const base = meeting.getTime() + (step.offsetMinutes ?? 0) * 60_000;
    const opened = (enrollment.recoveryOpenedAt ?? enrollment.enrolledAt).getTime();
    return { due: new Date(Math.max(base, opened)), reason: null };
  }

  if (step.anchor === 'meeting_offset') {
    let due = new Date(meeting.getTime() + (step.offsetMinutes ?? 0) * 60_000);
    if (step.notBeforeHourBrt != null) {
      const floor = atBrt(brtDateKey(due), step.notBeforeHourBrt, 0);
      if (due.getTime() < floor.getTime()) due = floor;
    }
    if (enrollment.phase === 'pre_meeting' && due.getTime() >= meeting.getTime()) {
      return { due: null, reason: 'unschedulable' };
    }
    return { due, reason: null };
  }

  const anchorKey = step.phase === 'recovery'
    ? brtDateKey(enrollment.recoveryOpenedAt ?? enrollment.enrolledAt)
    : brtDateKey(meeting);
  const offset = step.businessDayOffset ?? 0;
  let day = anchorKey;
  if (offset < 0) {
    for (let i = 0; i < -offset; i += 1) day = previousBusinessDay(day);
  } else if (offset > 0) {
    day = addBusinessDays(anchorKey, offset);
  }
  return { due: atBrt(day, step.clockHour ?? 9, step.clockMinute ?? 0), reason: null };
}

function leadHours(enrollment: EnrollmentSnap): number {
  return (enrollment.meetingStartsAt.getTime() - enrollment.bookedAt.getTime()) / 3_600_000;
}

function meetingKey(enrollment: EnrollmentSnap): string {
  return enrollment.meetingStartsAt.toISOString();
}

/**
 * String sem fuso é horário de parede em Brasília (o que o modal do SDR grava).
 * String com Z ou offset é instante real.
 */
export function meetingInstantFromInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const [, year, month, day, hour, minute, second] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) + 3, Number(minute), Number(second ?? 0)));
}

/**
 * SDR conectado usa a própria linha. Linha inexistente ou desconectada cai na
 * padrão da org se ela estiver conectada. Sem nenhuma, o passo não é enviado.
 */
export function pickWhatsAppAccount(user: ChannelAccount | null, org: ChannelAccount | null): ChannelAccount | null {
  if (user?.status === 'connected') return user;
  if (org?.status === 'connected') return org;
  return null;
}

/** Gmail do SDR primeiro (connected ou error, igual ao envio atual). Senão, outro conectado da org. */
export function pickGmailAccount(user: ChannelAccount | null, others: ChannelAccount[]): ChannelAccount | null {
  if (user && (user.status === 'connected' || user.status === 'error')) return user;
  return others.find((account) => account.status === 'connected') ?? null;
}

export function planSteps(input: {
  steps: StepDef[];
  enrollment: EnrollmentSnap;
  runs: RunSnap[];
  now: Date;
  channels: { email: boolean; whatsapp: boolean };
  replied: boolean;
}): PlanResult {
  if (!maySend(input.enrollment.status)) return { decisions: [], stopRecovery: false };
  if (input.enrollment.phase === 'recovery' && input.replied) {
    return { decisions: [], stopRecovery: true };
  }

  const applicable = input.steps.filter((step) => {
    if (!step.active || step.phase !== input.enrollment.phase) return false;
    if (step.context !== 'any' && step.context !== input.enrollment.context) return false;
    return true;
  });

  const decisions: PlanDecision[] = [];
  for (const step of applicable) {
    decisions.push(decideStep(step, input));
  }
  decisions.sort((a, b) => {
    const aDue = 'dueAt' in a ? a.dueAt : '';
    const bDue = 'dueAt' in b ? b.dueAt : '';
    return aDue.localeCompare(bDue);
  });
  return { decisions, stopRecovery: false };
}

function decideStep(
  step: StepDef,
  input: { enrollment: EnrollmentSnap; runs: RunSnap[]; now: Date; channels: { email: boolean; whatsapp: boolean } },
): PlanDecision {
  const { enrollment, runs, now } = input;
  const key = meetingKey(enrollment);
  const existing = runs.find((run) => run.stepKey === step.stepKey && new Date(run.meetingStartsAt).toISOString() === key && run.status !== 'cancelled');
  if (existing) return { action: 'skip', stepKey: step.stepKey, reason: 'already_recorded', persist: false };

  if (step.anchor === 'on_book' && runs.some((run) => run.stepKey === step.stepKey && run.status === 'sent')) {
    return { action: 'skip', stepKey: step.stepKey, reason: 'already_sent', persist: true };
  }

  const hours = leadHours(enrollment);
  if (step.minHoursBeforeMeeting != null && hours < step.minHoursBeforeMeeting) {
    return { action: 'skip', stepKey: step.stepKey, reason: 'short_meeting', persist: true };
  }
  if (step.skipIfBookedWithinHours != null && hours < step.skipIfBookedWithinHours) {
    return { action: 'skip', stepKey: step.stepKey, reason: 'booked_close', persist: true };
  }
  if (step.onlyIfUnconfirmed && enrollment.confirmedAt) {
    return { action: 'skip', stepKey: step.stepKey, reason: 'confirmed', persist: true };
  }

  const due = dueAt(step, enrollment);
  if (!due.due) return { action: 'skip', stepKey: step.stepKey, reason: due.reason ?? 'unschedulable', persist: true };

  if (enrollment.phase === 'pre_meeting' && due.due.getTime() + 60_000 < enrollment.bookedAt.getTime()) {
    return { action: 'skip', stepKey: step.stepKey, reason: 'before_booking', persist: true };
  }
  if (enrollment.phase === 'pre_meeting' && due.due.getTime() >= enrollment.meetingStartsAt.getTime()) {
    return { action: 'skip', stepKey: step.stepKey, reason: 'after_meeting', persist: true };
  }
  if (enrollment.phase === 'pre_meeting' && now.getTime() >= enrollment.meetingStartsAt.getTime()) {
    return { action: 'skip', stepKey: step.stepKey, reason: 'missed', persist: true };
  }

  if (now.getTime() < due.due.getTime()) {
    return { action: 'wait', stepKey: step.stepKey, dueAt: due.due.toISOString() };
  }

  if (step.mode === 'auto' && !step.quietHoursExempt && isAntiNoShowQuiet(now)) {
    return { action: 'wait', stepKey: step.stepKey, dueAt: due.due.toISOString() };
  }

  if (step.mode === 'auto') {
    const ready = step.channel === 'email' ? input.channels.email : input.channels.whatsapp;
    if (!ready) {
      return {
        action: 'not_sent',
        stepKey: step.stepKey,
        channel: step.channel === 'email' ? 'email' : 'whatsapp',
        reason: step.channel === 'email' ? 'gmail_desconectado' : 'whatsapp_desconectado',
        dueAt: due.due.toISOString(),
      };
    }
    if (!step.messageTemplateId) {
      return {
        action: 'not_sent',
        stepKey: step.stepKey,
        channel: step.channel === 'email' ? 'email' : 'whatsapp',
        reason: 'sem_template',
        dueAt: due.due.toISOString(),
      };
    }
    return {
      action: 'send',
      stepKey: step.stepKey,
      channel: step.channel === 'email' ? 'email' : 'whatsapp',
      dueAt: due.due.toISOString(),
      templateId: step.messageTemplateId,
    };
  }

  return {
    action: 'open_task',
    stepKey: step.stepKey,
    channel: step.channel,
    dueAt: due.due.toISOString(),
    notes: TASK_NOTES[step.stepKey] ?? `Anti no-show: ${step.stepKey}`,
    completesEnrollment: step.stepKey === 'rec_decide',
    marksLeadLost: false,
  };
}

/** Passos cujo horário já passou na virada: grava skip para não reenviar o que a régua antiga pode ter mandado. */
export function cutoverSkipKeys(steps: StepDef[], enrollment: EnrollmentSnap, now: Date): string[] {
  return steps
    .filter((step) => step.active && step.phase === enrollment.phase && (step.context === 'any' || step.context === enrollment.context))
    .filter((step) => {
      const due = dueAt(step, enrollment);
      return due.due != null && due.due.getTime() <= now.getTime();
    })
    .map((step) => step.stepKey);
}

export function reminderRowsForOldRuler<T extends { org_id: string }>(rows: T[], orgs: 'all' | string[] | undefined): T[] {
  if (!orgs || (Array.isArray(orgs) && orgs.length === 0)) return rows;
  if (orgs === 'all') return [];
  const set = new Set(orgs.map((org) => org.toLowerCase()));
  return rows.filter((row) => !set.has(row.org_id.toLowerCase()));
}
