'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { EvolutionCreateResponse, EvolutionQrResponse, EvolutionStatusResponse } from '../types';

type ConnectionStep = 'idle' | 'creating' | 'waiting_scan' | 'connected' | 'error';

interface EvolutionState {
  step: ConnectionStep;
  qrBase64: string | null;
  phone: string | null;
  instanceName: string | null;
  error: string | null;
}

const POLL_INTERVAL_MS = 5000;
/** Client-side backstop for the create-instance call. The edge fetches are now
 *  individually timed out, but this guards against the whole invoke hanging so
 *  the spinner can never stay up forever — it flips to a friendly error state. */
const CONNECT_TIMEOUT_MS = 90_000;

/**
 * Turn whatever the edge function / Evolution API returned into a short,
 * user-safe message. The shared Evolution server can answer a transient 500
 * whose body is its full minified bundle/stack trace; we must NEVER surface
 * that raw payload in the UI (it used to paint code across the screen). Map the
 * known transient cases to friendly PT copy and collapse anything code-like.
 */
function friendlyEvolutionError(raw: string | null | undefined): string {
  const msg = (raw ?? '').toString().trim();
  const lower = msg.toLowerCase();

  // Transient server hiccups: timeout / network / any 5xx from Evolution.
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('connection closed') ||
    lower.includes('econnrefused') ||
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    /evolution api 5\d\d/.test(lower)
  ) {
    return 'O servidor de WhatsApp demorou a responder. Aguarde alguns segundos e toque em "Atualizar QR Code".';
  }

  if (lower.includes('already in use')) {
    return 'Não foi possível preparar sua sessão agora. Toque em "Atualizar QR Code" para tentar novamente.';
  }

  // Never surface raw Evolution payloads / stack traces. If the message is long
  // or looks like code/markup, collapse to a generic message.
  const looksLikeCode = msg.length > 140 || /[{}<>;]|=>|function|catch\(|await /.test(msg);
  if (!msg || looksLikeCode) {
    return 'Não foi possível gerar o QR Code agora. Tente novamente em instantes.';
  }

  return msg;
}

export function useEvolutionWhatsApp() {
  const [state, setState] = useState<EvolutionState>({
    step: 'idle',
    qrBase64: null,
    phone: null,
    instanceName: null,
    error: null,
  });

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(() => {
    const supabase = createClient();

    pollingRef.current = setInterval(async () => {
      if (!mountedRef.current) {
        stopPolling();
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke<EvolutionStatusResponse>('evolution-status');

        if (!mountedRef.current) return;
        if (error || !data) return; // Silently ignore poll errors

        if (data.status === 'connected') {
          stopPolling();
          setState((prev) => ({
            ...prev,
            step: 'connected',
            phone: data.phone,
            qrBase64: null,
          }));
        } else if (data.qr_base64 && data.qr_base64 !== '') {
          setState((prev) => ({
            ...prev,
            qrBase64: data.qr_base64 ?? prev.qrBase64,
          }));
        }
      } catch {
        // Silently ignore — polling will retry on next interval
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling]);

  const connect = useCallback(async () => {
    setState((prev) => ({ ...prev, step: 'creating', error: null }));

    const supabase = createClient();

    // Backstop timeout: never let the create call hang the spinner forever.
    let data: EvolutionCreateResponse | null = null;
    let error:
      | { message: string; context?: { json?: () => Promise<{ error?: string; message?: string }> } }
      | null = null;
    try {
      const result = await Promise.race([
        supabase.functions.invoke<EvolutionCreateResponse>('evolution-create-instance'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), CONNECT_TIMEOUT_MS),
        ),
      ]);
      data = result.data;
      error = result.error;
    } catch {
      if (!mountedRef.current) return;
      setState((prev) => ({
        ...prev,
        step: 'error',
        error: friendlyEvolutionError('timeout'),
      }));
      return;
    }

    if (!mountedRef.current) return;

    if (error || !data) {
      // Extract real error message from edge function response
      let errorMsg = 'Erro ao criar instância';
      if (error) {
        try {
          // FunctionsHttpError has a context with the response
          const ctx = (error as { context?: { json?: () => Promise<{ error?: string; message?: string }> } }).context;
          if (ctx?.json) {
            const body = await ctx.json();
            errorMsg = body?.error ?? body?.message ?? error.message;
          } else {
            errorMsg = error.message;
          }
        } catch {
          errorMsg = error.message;
        }
      }
      console.error('[evolution] Create instance error:', errorMsg);
      setState((prev) => ({
        ...prev,
        step: 'error',
        error: friendlyEvolutionError(errorMsg),
      }));
      return;
    }

    if (data.status === 'connected') {
      setState({
        step: 'connected',
        qrBase64: null,
        phone: data.phone ?? null,
        instanceName: data.instance_name,
        error: null,
      });
      return;
    }

    setState({
      step: 'waiting_scan',
      qrBase64: data.qr_base64,
      phone: null,
      instanceName: data.instance_name,
      error: null,
    });

    pollStatus();
  }, [pollStatus]);

  const refreshQr = useCallback(async () => {
    const supabase = createClient();

    const { data, error } = await supabase.functions.invoke<EvolutionQrResponse>('evolution-qrcode');

    if (!mountedRef.current) return;

    if (error || !data) {
      let errorMsg = 'Erro ao atualizar QR Code';
      if (error) {
        try {
          const ctx = (error as { context?: { json?: () => Promise<{ error?: string; message?: string }> } }).context;
          if (ctx?.json) {
            const body = await ctx.json();
            errorMsg = body?.error ?? body?.message ?? error.message;
          } else {
            errorMsg = error.message;
          }
        } catch {
          errorMsg = error.message;
        }
      }
      console.error('[evolution] QR refresh error:', errorMsg);
      setState((prev) => ({ ...prev, step: 'error', error: friendlyEvolutionError(errorMsg) }));
      return;
    }

    if (data.status === 'connected') {
      stopPolling();
      setState((prev) => ({
        ...prev,
        step: 'connected',
        phone: data.phone ?? null,
        qrBase64: null,
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      qrBase64: data.qr_base64,
    }));
  }, [stopPolling]);

  const disconnect = useCallback(() => {
    stopPolling();
    setState({
      step: 'idle',
      qrBase64: null,
      phone: null,
      instanceName: null,
      error: null,
    });
  }, [stopPolling]);

  return {
    ...state,
    connect,
    refreshQr,
    disconnect,
  };
}
