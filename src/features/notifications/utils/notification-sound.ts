import type { NotificationType } from '../types';

/**
 * Notification types that play an audible chime when they arrive.
 *
 * Kept to the high-signal, actionable events a rep/manager wants to hear
 * immediately — deliberately excludes high-volume tracking noise
 * (lead_opened/lead_clicked/lead_bounced) and low-urgency system events
 * (sync_completed, import_completed, member_*, usage_limit_alert,
 * cadence_completed, lead_lost, integration_error). To make a type audible,
 * add it here.
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
 * Play a short two-note chime (A5 → D6) via the Web Audio API — no audio asset
 * to ship and it works offline. Fails silently: autoplay policies or an
 * unsupported browser must never break the notification flow (the toast and the
 * unread badge still update regardless).
 */
export function playNotificationSound(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    // A prior user gesture may be needed to unlock audio; resume best-effort.
    if (ctx.state === 'suspended') void ctx.resume();

    const now = ctx.currentTime;
    const notes = [
      { freq: 880, start: 0 }, // A5
      { freq: 1174.66, start: 0.12 }, // D6
    ];
    for (const { freq, start } of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = now + start;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.15, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.26);
    }
  } catch {
    // Sound is a nice-to-have, never a hard dependency.
  }
}
