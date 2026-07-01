'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { isNotificationSoundEnabled, setNotificationSoundEnabled } from '../utils/notification-sound';

const STORAGE_KEY = 'notifications:sound-enabled';

function subscribe(callback: () => void): () => void {
  // Native `storage` events fire across tabs; the toggle dispatches a synthetic
  // one for the current tab, so a single listener covers both.
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

/**
 * Reads/persists the per-browser "notification sound" toggle (localStorage,
 * default ON). Uses `useSyncExternalStore` for an SSR-safe snapshot (server
 * renders `true`) that stays in sync across tabs without a hydration mismatch.
 */
export function useNotificationSound(): { enabled: boolean; toggle: () => void } {
  const enabled = useSyncExternalStore(
    subscribe,
    () => isNotificationSoundEnabled(), // client snapshot (primitive → value-stable)
    () => true, // server snapshot (SSR-safe default)
  );

  const toggle = useCallback(() => {
    setNotificationSoundEnabled(!isNotificationSoundEnabled());
    // The native `storage` event only fires in other tabs; nudge this one too.
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
  }, []);

  return { enabled, toggle };
}
