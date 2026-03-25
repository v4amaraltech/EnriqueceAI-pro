'use client';

import { useEffect, useSyncExternalStore } from 'react';

const LIBWEBPHONE_URL = 'https://api.api4com.com/static/libwebphone.js';
const SCRIPT_ID = 'libwebphone-script';

// Module-level state for the singleton script loader
let loaded = false;
let loadError: string | null = null;
let listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): { loaded: boolean; error: string | null } {
  return { loaded, error: loadError };
}

function getServerSnapshot(): { loaded: boolean; error: string | null } {
  return { loaded: false, error: null };
}

function notify() {
  for (const cb of listeners) cb();
}

interface UseLibWebphoneLoaderReturn {
  isLoaded: boolean;
  error: string | null;
}

/**
 * Dynamically loads the libwebphone.js script from API4COM CDN.
 * Singleton: only injects once, subsequent calls reuse the same script.
 */
export function useLibWebphoneLoader(): UseLibWebphoneLoaderReturn {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    // Already loaded
    if (loaded) {
      return undefined;
    }

    // Check if library is already on window (loaded externally)
    if ((window as unknown as Record<string, unknown>).libwebphone) {
      loaded = true;
      notify();
      return undefined;
    }

    // Script tag already exists (another component started loading)
    const existingScript = document.getElementById(SCRIPT_ID);
    if (existingScript) {
      const handleLoad = () => { loaded = true; notify(); };
      const handleError = () => { loadError = 'Falha ao carregar libwebphone.js'; notify(); };
      existingScript.addEventListener('load', handleLoad);
      existingScript.addEventListener('error', handleError);
      return () => {
        existingScript.removeEventListener('load', handleLoad);
        existingScript.removeEventListener('error', handleError);
      };
    }

    // Inject script
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = LIBWEBPHONE_URL;
    script.async = true;

    script.onload = () => { loaded = true; notify(); };
    script.onerror = () => { loadError = 'Falha ao carregar libwebphone.js'; notify(); };

    document.head.appendChild(script);
    return undefined;
  }, []);

  return { isLoaded: state.loaded, error: state.error };
}
