'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { getWebphoneCallOutcome } from '@/features/calls/actions/get-webphone-call-outcome';
import type { LiveAmdView } from '@/features/integrations/webphone/live-amd-session';
import {
  getLiveAmdView,
  subscribeLiveAmdView,
} from '@/features/integrations/webphone/live-amd-view-store';
import {
  LEAD_ANSWER_MAX_POLLS,
  LEAD_ANSWER_POLL_INTERVAL_MS,
} from '@/features/integrations/webphone/webphone-lead-answer';

import {
  type AutoUpdateMarkerView,
  type LiveAmdSuggestionInput,
  type PostCallSuggestion,
  resolvePostCallSuggestion,
} from './post-call-suggestion';

function subscribeAmdStore(onChange: () => void): () => void {
  return subscribeLiveAmdView(() => onChange());
}

function viewToInput(view: LiveAmdView | null | undefined): LiveAmdSuggestionInput | null {
  if (!view) return null;
  return {
    prediction: view.prediction,
    nextActivity: view.nextActivity,
    nextActivityReason: view.nextActivityReason,
    confidence: view.confidence,
  };
}

function mergeLiveAmd(
  local: LiveAmdSuggestionInput | null,
  server: LiveAmdSuggestionInput | null,
): LiveAmdSuggestionInput | null {
  if (!local && !server) return null;
  return {
    prediction: local?.prediction ?? server?.prediction ?? null,
    nextActivity: local?.nextActivity ?? server?.nextActivity ?? null,
    nextActivityReason: local?.nextActivityReason ?? server?.nextActivityReason ?? null,
    confidence: local?.confidence ?? server?.confidence ?? null,
  };
}

interface ServerSignals {
  callId: string | null;
  liveAmd: LiveAmdSuggestionInput | null;
  autoUpdateMarker: AutoUpdateMarkerView | null;
  sdrDisposition: string | null;
}

const EMPTY_SERVER: ServerSignals = {
  callId: null,
  liveAmd: null,
  autoUpdateMarker: null,
  sdrDisposition: null,
};

/**
 * Junta a escuta ao vivo desta aba com o que o servidor já gravou (marcador
 * automático e metadata.live_amd). Continua consultando enquanto o modal está
 * aberto, porque o webhook e a sugestão podem chegar alguns segundos depois.
 */
export function usePostCallSuggestion(args: {
  callId: string | null;
  connected: boolean;
  enabled: boolean;
  localLiveAmd?: LiveAmdView | null;
}): PostCallSuggestion {
  const { callId, connected, enabled, localLiveAmd } = args;
  const storeView = useSyncExternalStore(
    subscribeAmdStore,
    () => getLiveAmdView(callId),
    () => null,
  );

  const [server, setServer] = useState<ServerSignals>(EMPTY_SERVER);
  const serverForCall = enabled && callId && server.callId === callId ? server : EMPTY_SERVER;

  useEffect(() => {
    if (!enabled || !callId) return;
    const id = callId;
    let cancelled = false;
    let polls = 0;
    let timer: number | null = null;

    async function tick() {
      polls += 1;
      const result = await getWebphoneCallOutcome({ callId: id }).catch(() => null);
      if (cancelled) return;
      if (result?.success) {
        setServer({
          callId: id,
          liveAmd: result.data.liveAmd,
          autoUpdateMarker: result.data.autoUpdateMarker,
          sdrDisposition: result.data.sdrDisposition,
        });
        if (result.data.autoUpdateMarker?.applied) return;
      }
      if (cancelled) return;
      if (polls < LEAD_ANSWER_MAX_POLLS) {
        timer = window.setTimeout(() => void tick(), LEAD_ANSWER_POLL_INTERVAL_MS);
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [callId, enabled]);

  return useMemo(() => {
    const local = viewToInput(localLiveAmd) ?? viewToInput(storeView);
    return resolvePostCallSuggestion({
      connected,
      sdrDisposition: serverForCall.sdrDisposition,
      autoUpdateMarker: serverForCall.autoUpdateMarker,
      liveAmd: mergeLiveAmd(local, serverForCall.liveAmd),
    });
  }, [connected, serverForCall, localLiveAmd, storeView]);
}
