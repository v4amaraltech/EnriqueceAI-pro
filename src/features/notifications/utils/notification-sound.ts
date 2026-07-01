import type { NotificationType } from '../types';

/**
 * Notification types that play an audible chime when they arrive.
 *
 * Kept to the high-signal, actionable events a rep/manager wants to hear
 * immediately — deliberately excludes high-volume tracking noise
 * (lead_opened/lead_clicked/lead_bounced) and low-urgency system events
 * (sync_completed, import_completed, member_*, usage_limit_alert,
 * cadence_completed, lead_lost, integration_error). To make a type audible,
 * add it here (and optionally give it a distinct chime in TYPE_CHIME).
 */
export const SOUND_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'lead_replied',
  'whatsapp_reply',
  'lead_inbound',
  'lead_won',
  'closer_feedback',
  'meeting_reminder',
  'activity_reminder',
  'goal_reached',
]);

const STORAGE_KEY = 'notifications:sound-enabled';

/** Sound is ON by default; only an explicit "false" in storage disables it. */
export function isNotificationSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_KEY) !== 'false';
}

export function setNotificationSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
}

// --- Chimes -----------------------------------------------------------------

type ChimeNote = {
  freq: number;
  start?: number;
  dur?: number;
  type?: OscillatorType;
  peak?: number;
};

export type ChimeName = 'sino' | 'tri-tom' | 'fanfarra' | 'descendente';

/** Note sequences synthesized live via the Web Audio API (no audio assets). */
const CHIMES: Record<ChimeName, ChimeNote[]> = {
  // Default two-note bell (A5 → D6).
  sino: [{ freq: 880, start: 0 }, { freq: 1174.66, start: 0.12 }],
  // Three ascending notes — a bit more attention-grabbing (meetings).
  'tri-tom': [
    { freq: 784, start: 0, dur: 0.18 },
    { freq: 988, start: 0.1, dur: 0.18 },
    { freq: 1319, start: 0.2, dur: 0.28 },
  ],
  // Four-note "victory" flourish (goal reached).
  fanfarra: [
    { freq: 523.25, start: 0, dur: 0.14 },
    { freq: 659.25, start: 0.1, dur: 0.14 },
    { freq: 783.99, start: 0.2, dur: 0.14 },
    { freq: 1046.5, start: 0.3, dur: 0.32 },
  ],
  // Two notes descending — calmer (closer feedback).
  descendente: [{ freq: 987.77, start: 0, dur: 0.2 }, { freq: 659.25, start: 0.11, dur: 0.28 }],
};

/**
 * Per-type chime overrides. Any sound-worthy type not listed here uses 'sino'.
 * Confirmed mapping: reunião → tri-tom, meta → fanfarra, feedback do closer →
 * descendente; everything else (lead respondeu, WhatsApp, inbound, lead ganho)
 * stays on the default bell.
 */
const TYPE_CHIME: Partial<Record<NotificationType, ChimeName>> = {
  meeting_reminder: 'tri-tom',
  goal_reached: 'fanfarra',
  closer_feedback: 'descendente',
};

/** Which chime a given notification type plays (default 'sino'). */
export function chimeNameForType(type: NotificationType): ChimeName {
  return TYPE_CHIME[type] ?? 'sino';
}

// Lazily created and shared across chimes — browsers cap the number of contexts.
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  return audioContext;
}

/**
 * Play the chime for `type` via the Web Audio API — no audio asset to ship and
 * it works offline. Fails silently: autoplay policies or an unsupported browser
 * must never break the notification flow (the toast and the unread badge still
 * update regardless).
 */
export function playNotificationSound(type: NotificationType): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    // A prior user gesture may be needed to unlock audio; resume best-effort.
    if (ctx.state === 'suspended') void ctx.resume();

    const now = ctx.currentTime;
    for (const note of CHIMES[chimeNameForType(type)]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.type ?? 'sine';
      osc.frequency.value = note.freq;
      const t0 = now + (note.start ?? 0);
      const dur = note.dur ?? 0.25;
      const peak = note.peak ?? 0.15;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
  } catch {
    // Sound is a nice-to-have, never a hard dependency.
  }
}
