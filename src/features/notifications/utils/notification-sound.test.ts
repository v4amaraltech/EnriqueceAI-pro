import { afterEach, describe, expect, it } from 'vitest';

import type { NotificationType } from '../types';
import {
  chimeNameForType,
  isNotificationSoundEnabled,
  playNotificationSound,
  setNotificationSoundEnabled,
  SOUND_NOTIFICATION_TYPES,
} from './notification-sound';

afterEach(() => {
  window.localStorage.clear();
});

describe('SOUND_NOTIFICATION_TYPES', () => {
  it('includes the high-signal, actionable types', () => {
    const expected: NotificationType[] = [
      'lead_replied',
      'whatsapp_reply',
      'lead_inbound',
      'lead_won',
      'closer_feedback',
      'meeting_reminder',
      'activity_reminder',
      'goal_reached',
    ];
    for (const t of expected) {
      expect(SOUND_NOTIFICATION_TYPES.has(t)).toBe(true);
    }
  });

  it('excludes high-volume tracking noise and low-urgency system events', () => {
    const silent: NotificationType[] = [
      'lead_opened',
      'lead_clicked',
      'lead_bounced',
      'sync_completed',
      'integration_error',
      'member_invited',
      'member_joined',
      'usage_limit_alert',
      'import_completed',
      'cadence_completed',
      'lead_lost',
    ];
    for (const t of silent) {
      expect(SOUND_NOTIFICATION_TYPES.has(t)).toBe(false);
    }
  });
});

describe('sound preference', () => {
  it('defaults to enabled when nothing is stored', () => {
    expect(isNotificationSoundEnabled()).toBe(true);
  });

  it('is disabled only after an explicit opt-out', () => {
    setNotificationSoundEnabled(false);
    expect(isNotificationSoundEnabled()).toBe(false);
    expect(window.localStorage.getItem('notifications:sound-enabled')).toBe('false');

    setNotificationSoundEnabled(true);
    expect(isNotificationSoundEnabled()).toBe(true);
  });
});

describe('chimeNameForType', () => {
  it('maps the confirmed per-type overrides', () => {
    expect(chimeNameForType('meeting_reminder')).toBe('tri-tom');
    expect(chimeNameForType('goal_reached')).toBe('fanfarra');
    expect(chimeNameForType('closer_feedback')).toBe('descendente');
  });

  it('falls back to the default bell for every other type', () => {
    expect(chimeNameForType('lead_replied')).toBe('sino');
    expect(chimeNameForType('whatsapp_reply')).toBe('sino');
    expect(chimeNameForType('lead_inbound')).toBe('sino');
    expect(chimeNameForType('lead_won')).toBe('sino'); // celebratório, mas fica no Sino
  });
});

describe('playNotificationSound', () => {
  it('never throws when the Web Audio API is unavailable (jsdom)', () => {
    // jsdom has no AudioContext — the call must degrade silently, not crash the
    // realtime notification handler.
    expect(() => playNotificationSound('lead_replied')).not.toThrow();
    expect(() => playNotificationSound('goal_reached')).not.toThrow();
  });
});
