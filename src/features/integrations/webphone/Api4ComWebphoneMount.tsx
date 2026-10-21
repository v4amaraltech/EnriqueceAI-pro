'use client';

import { useEffect, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { getWebphoneSipConfig } from '@/features/calls/actions/get-webphone-sip-config';

import { useApi4ComWebphone } from './useApi4ComWebphone';
import { answerCall, hangupCall, startWebphone, stopWebphone, toggleMute } from './webphone-client';
import { callTalkSeconds, type WebphoneState } from './webphone-state';

/**
 * Liga o webphone da aba quando o gestor liberou para o usuário e mostra um
 * indicador mínimo (bloco 2). O painel flutuante completo é o bloco 3.
 */
export function Api4ComWebphoneMount() {
  const state = useApi4ComWebphone();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getWebphoneSipConfig()
      .then((r) => {
        if (cancelled || !r.success || !r.data.enabled) return;
        setEnabled(true);
        return startWebphone({ sipDomain: r.data.sipDomain, ramal: r.data.ramal, sipPassword: r.data.sipPassword });
      })
      .catch((err: unknown) => console.error('[webphone] start failed:', err));
    return () => {
      cancelled = true;
      stopWebphone();
    };
  }, []);

  if (!enabled) return null;
  return <WebphoneBadge state={state} />;
}

const REGISTRATION_LABEL: Record<WebphoneState['registration'], { text: string; dot: string }> = {
  disabled: { text: 'Webphone desligado', dot: 'bg-gray-400' },
  connecting: { text: 'Conectando ao ramal…', dot: 'bg-amber-500' },
  registered: { text: 'Webphone ativo', dot: 'bg-green-500' },
  disconnected: { text: 'Webphone desconectado', dot: 'bg-gray-400' },
  error: { text: 'Webphone com erro', dot: 'bg-red-500' },
};

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function WebphoneBadge({ state }: { state: WebphoneState }) {
  const [now, setNow] = useState(() => Date.now());
  const inCall = state.call?.phase === 'in-call';

  useEffect(() => {
    if (!inCall) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [inCall]);

  const reg = REGISTRATION_LABEL[state.registration];
  const call = state.call;

  return (
    <div
      data-webphone-badge
      className="fixed bottom-4 left-4 z-50 flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs shadow-lg"
      role="status"
      aria-live="polite"
    >
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${reg.dot}`} aria-hidden />
      {call ? (
        <>
          <span className="font-medium">
            {call.phase === 'ringing' && (call.integrated ? 'Conectando…' : 'Chamada recebida')}
            {call.phase === 'in-call' && `Em ligação · ${formatSeconds(callTalkSeconds(call, now))}`}
            {call.phase === 'ended' && 'Ligação encerrada'}
          </span>
          {call.remoteNumber && <span className="text-[var(--muted-foreground)]">{call.remoteNumber}</span>}
          {call.phase === 'ringing' && !call.integrated && (
            <Button size="sm" className="h-7 bg-green-600 px-2 hover:bg-green-700" onClick={answerCall} aria-label="Atender">
              <Phone className="h-3.5 w-3.5" />
            </Button>
          )}
          {call.phase !== 'ended' && (
            <>
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={toggleMute} disabled={!inCall} aria-label={call.muted ? 'Ativar microfone' : 'Mutar'}>
                {call.muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              </Button>
              <Button size="sm" variant="destructive" className="h-7 px-2" onClick={hangupCall} aria-label="Desligar">
                <PhoneOff className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </>
      ) : (
        <span className="text-[var(--muted-foreground)]">
          {reg.text}
          {state.mic === 'denied' && ' · microfone bloqueado'}
          {state.error && state.registration === 'error' && ` · ${state.error}`}
        </span>
      )}
    </div>
  );
}
