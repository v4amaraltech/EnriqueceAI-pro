import { afterEach, describe, expect, it } from 'vitest';

import type { NotificationType } from '../types';
import {
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

describe('playNotificationSound', () => {
  it('never throws when the Web Audio API is unavailable (jsdom)', () => {
    // jsdom has no AudioContext — the call must degrade silently, not crash the
    // realtime notification handler.
    expect(() => playNotificationSound()).not.toThrow();
  });
});
