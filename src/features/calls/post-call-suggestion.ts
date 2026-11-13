// Resolução PURA da sugestão exibida no modal de resultado da ligação.
// Junta o marcador de escrita automática (CRM já preenchido), a escuta ao vivo
// (live_amd) e a qualificação JEV. Não escreve nada: só diz o que pré-selecionar.
//
// Prioridade: marcador auto_filled > live_amd > qualificação. Sem sugestão, o
// modal segue o comportamento anterior (atendida exige escolha; não atendida
// já vem em no_answer).
import { dispositionOptionsForTelemetry } from './disposition';
import { mapOutcomeToDisposition } from './services/crm-auto-update/decision';
import type { CallDisposition } from './types';

export type PostCallNextActivity = 'schedule_meeting' | 'schedule_callback' | 'not_connected';

export interface MeetingPrefill {
  closerId?: string | null;
  /** YYYY-MM-DD, só quando o horário já veio estruturado. Nunca é inventado. */
  date?: string | null;
  /** HH:MM, mesma regra da data. */
  time?: string | null;
}

export interface AutoUpdateMarkerView {
  applied: boolean;
  disposition: string;
  rules_version?: string | null;
  source?: string | null;
}

export interface LiveAmdSuggestionInput {
  prediction?: string | null;
  nextActivity?: PostCallNextActivity | null;
  nextActivityReason?: string | null;
  confidence?: number | null;
}

export interface QualificationSuggestionInput {
  outcome?: string | null;
  next_step_suggestion?: string | null;
  confidence?: number | null;
}

export interface PostCallSuggestionInput {
  connected: boolean;
  sdrDisposition?: string | null;
  autoUpdateMarker?: AutoUpdateMarkerView | null;
  liveAmd?: LiveAmdSuggestionInput | null;
  qualification?: QualificationSuggestionInput | null;
  meetingPrefill?: MeetingPrefill | null;
}

export interface PostCallSuggestion {
  /** Desfecho pré-selecionado, ainda editável. */
  outcome: CallDisposition | null;
  nextActivity: PostCallNextActivity | null;
  reason: string | null;
  source: 'auto_filled' | 'live_amd' | 'qualification' | null;
  alreadyFilled: boolean;
  alreadyFilledDisposition: CallDisposition | null;
  meetingPrefill: MeetingPrefill | null;
}

const DISPOSITIONS = new Set<CallDisposition>([
  'relevant_conversation',
  'answered_no_progress',
  'callback_requested',
  'voicemail',
  'no_answer',
  'technical_failure',
]);

const NEXT_ACTIVITIES = new Set<PostCallNextActivity>([
  'schedule_meeting',
  'schedule_callback',
  'not_connected',
]);

function asDisposition(value: string | null | undefined): CallDisposition | null {
  if (!value) return null;
  return DISPOSITIONS.has(value as CallDisposition) ? (value as CallDisposition) : null;
}

function asNextActivity(value: string | null | undefined): PostCallNextActivity | null {
  if (!value) return null;
  return NEXT_ACTIVITIES.has(value as PostCallNextActivity)
    ? (value as PostCallNextActivity)
    : null;
}

function allowed(connected: boolean, disposition: CallDisposition | null): CallDisposition | null {
  if (!disposition) return null;
  return dispositionOptionsForTelemetry(connected).some((o) => o.value === disposition)
    ? disposition
    : null;
}

function emptySuggestion(meetingPrefill: MeetingPrefill | null = null): PostCallSuggestion {
  return {
    outcome: null,
    nextActivity: null,
    reason: null,
    source: null,
    alreadyFilled: false,
    alreadyFilledDisposition: null,
    meetingPrefill,
  };
}

function fromLiveAmd(
  liveAmd: LiveAmdSuggestionInput,
  connected: boolean,
): { outcome: CallDisposition | null; next: PostCallNextActivity | null; reason: string | null } {
  const next = asNextActivity(liveAmd.nextActivity);
  const reason =
    typeof liveAmd.nextActivityReason === 'string' && liveAmd.nextActivityReason.trim()
      ? liveAmd.nextActivityReason.trim()
      : null;
  if (next === 'schedule_meeting')
    return { outcome: allowed(connected, 'relevant_conversation'), next, reason };
  if (next === 'schedule_callback')
    return { outcome: allowed(connected, 'callback_requested'), next, reason };
  if (next === 'not_connected') {
    if (liveAmd.prediction === 'number_not_exist') {
      return { outcome: allowed(connected, 'technical_failure'), next, reason };
    }
    if (liveAmd.prediction === 'no_answer') {
      return { outcome: allowed(connected, 'no_answer'), next, reason };
    }
    return { outcome: allowed(connected, connected ? 'voicemail' : 'no_answer'), next, reason };
  }
  if (liveAmd.prediction === 'voicemail')
    return { outcome: allowed(connected, 'voicemail'), next: null, reason };
  if (liveAmd.prediction === 'number_not_exist') {
    return { outcome: allowed(connected, 'technical_failure'), next: null, reason };
  }
  if (liveAmd.prediction === 'no_answer')
    return { outcome: allowed(connected, 'no_answer'), next: null, reason };
  return { outcome: null, next: null, reason };
}

function fromQualification(
  qualification: QualificationSuggestionInput,
  connected: boolean,
): { outcome: CallDisposition | null; next: PostCallNextActivity | null } {
  const outcome = allowed(connected, mapOutcomeToDisposition(qualification.outcome ?? null));
  const step = qualification.next_step_suggestion;
  let next: PostCallNextActivity | null = null;
  if (
    step === 'meeting' ||
    step === 'schedule_meeting' ||
    qualification.outcome === 'meeting_booked'
  ) {
    next = 'schedule_meeting';
  } else if (
    step === 'callback' ||
    step === 'schedule_callback' ||
    qualification.outcome === 'callback'
  ) {
    next = 'schedule_callback';
  } else if (
    step === 'not_connected' ||
    qualification.outcome === 'not_connected' ||
    qualification.outcome === 'voicemail'
  ) {
    next = 'not_connected';
  }
  return { outcome, next };
}

/**
 * Lê metadata.live_amd gravado por recordLiveAmd / mergeLiveAmdMetadata.
 * Aceita também o formato da tela (nextActivity em camelCase).
 */
export function readLiveAmdSuggestion(metadata: unknown): LiveAmdSuggestionInput | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>).live_amd;
  if (!raw || typeof raw !== 'object') return null;
  const live = raw as Record<string, unknown>;
  const prediction = typeof live.prediction === 'string' ? live.prediction : null;
  const nextActivity = asNextActivity(
    (typeof live.next_activity_suggestion === 'string' ? live.next_activity_suggestion : null) ??
      (typeof live.nextActivity === 'string' ? live.nextActivity : null),
  );
  const reasonRaw = live.next_activity_reason ?? live.nextActivityReason;
  const reason = typeof reasonRaw === 'string' ? reasonRaw : null;
  const confidenceRaw = live.next_activity_confidence ?? live.confidence;
  const confidence = typeof confidenceRaw === 'number' ? confidenceRaw : null;
  if (!prediction && !nextActivity) return null;
  return { prediction, nextActivity, nextActivityReason: reason, confidence };
}

/** Lê o marcador calls.metadata.crm_auto_update quando a escrita automática já aconteceu. */
export function readAutoUpdateMarkerView(metadata: unknown): AutoUpdateMarkerView | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>).crm_auto_update;
  if (!raw || typeof raw !== 'object') return null;
  const marker = raw as Record<string, unknown>;
  if (marker.applied !== true || typeof marker.disposition !== 'string') return null;
  return {
    applied: true,
    disposition: marker.disposition,
    rules_version: typeof marker.rules_version === 'string' ? marker.rules_version : null,
    source: typeof marker.source === 'string' ? marker.source : null,
  };
}

export function resolvePostCallSuggestion(input: PostCallSuggestionInput): PostCallSuggestion {
  const meetingPrefill = input.meetingPrefill ?? null;
  const empty = emptySuggestion(meetingPrefill);

  const markerDisp = input.autoUpdateMarker?.applied
    ? asDisposition(input.autoUpdateMarker.disposition)
    : null;
  if (input.autoUpdateMarker?.applied && markerDisp) {
    return {
      ...empty,
      outcome: allowed(input.connected, markerDisp) ?? markerDisp,
      alreadyFilled: true,
      alreadyFilledDisposition: markerDisp,
      source: 'auto_filled',
    };
  }

  if (input.liveAmd) {
    const fromAmd = fromLiveAmd(input.liveAmd, input.connected);
    if (fromAmd.outcome || fromAmd.next) {
      return {
        ...empty,
        outcome: fromAmd.outcome,
        nextActivity: fromAmd.next,
        reason: fromAmd.reason,
        source: 'live_amd',
        meetingPrefill,
      };
    }
  }

  if (input.qualification?.outcome) {
    const fromQual = fromQualification(input.qualification, input.connected);
    if (fromQual.outcome || fromQual.next) {
      return {
        ...empty,
        outcome: fromQual.outcome,
        nextActivity: fromQual.next,
        source: 'qualification',
        meetingPrefill,
      };
    }
  }

  return empty;
}
