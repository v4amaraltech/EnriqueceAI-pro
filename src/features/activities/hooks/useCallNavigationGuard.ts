'use client';

import { useEffect } from 'react';

/**
 * Prevents accidental navigation/tab close when a call is in progress.
 */
export function useCallNavigationGuard(isInCall: boolean) {
  useEffect(() => {
    if (!isInCall) return;

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isInCall]);
}
