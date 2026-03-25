'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mic, MicOff, Minus, Phone, PhoneOff, X } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

import { getApi4ComSipCredentials } from '@/features/calls/actions/get-api4com-sip-credentials';
import type { Api4ComSipCredentials } from '@/features/calls/actions/get-api4com-sip-credentials';
import { PostCallClassificationDialog } from '@/features/calls/components/PostCallClassificationDialog';

import { useLibWebphoneLoader } from '../hooks/useLibWebphoneLoader';
import { useApi4ComWebphone } from '../hooks/useApi4ComWebphone';
import type { WebphoneStatus } from '../hooks/useApi4ComWebphone';

function StatusDot({ status }: { status: WebphoneStatus }) {
  const colors: Record<WebphoneStatus, string> = {
    disconnected: 'bg-red-500',
    connecting: 'bg-yellow-500 animate-pulse',
    registered: 'bg-green-500',
    error: 'bg-red-500',
  };
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${colors[status]}`} />;
}

function statusLabel(status: WebphoneStatus): string {
  const labels: Record<WebphoneStatus, string> = {
    disconnected: 'Desconectado',
    connecting: 'Conectando...',
    registered: 'Online',
    error: 'Erro',
  };
  return labels[status];
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function CallTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return <span className="font-mono text-sm">{formatDuration(elapsed)}</span>;
}

export function Api4ComWebphone() {
  const [credentials, setCredentials] = useState<Api4ComSipCredentials | null>(null);
  const [loading, setLoading] = useState(true);
  const [minimized, setMinimized] = useState(false);

  // 1. Fetch SIP credentials
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getApi4ComSipCredentials();
      if (cancelled) return;
      if (result.success) {
        setCredentials(result.data);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // 2. Load libwebphone script (only when credentials are available)
  const { isLoaded: scriptLoaded, error: scriptError } = useLibWebphoneLoader();
  const scriptReady = credentials !== null && scriptLoaded && !scriptError;

  // 3. Connect webphone
  const {
    webphoneStatus,
    callStatus,
    currentCall,
    endedCall,
    isMuted,
    toggleMute,
    hangup,
    answer,
    reject,
    dismissEnded,
  } = useApi4ComWebphone({
    sipDomain: credentials?.sipDomain ?? '',
    ramal: credentials?.ramal ?? '',
    sipPassword: credentials?.sipPassword ?? '',
    enabled: scriptReady,
  });

  const toggleMinimize = useCallback(() => setMinimized((prev) => !prev), []);

  // Don't render if no credentials or still loading
  if (loading || !credentials) return null;

  const isInCall = callStatus === 'in-call' || callStatus === 'ringing';

  // Minimized badge
  if (minimized && !isInCall) {
    return (
      <button
        onClick={toggleMinimize}
        className="fixed bottom-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--card)] shadow-lg border border-[var(--border)] hover:bg-[var(--accent)] transition-colors"
        title={`Webphone: ${statusLabel(webphoneStatus)}`}
      >
        <StatusDot status={webphoneStatus} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-[var(--muted-foreground)]" />
          <span className="text-sm font-medium">Ramal {credentials.ramal}</span>
          <StatusDot status={webphoneStatus} />
          <span className="text-xs text-[var(--muted-foreground)]">{statusLabel(webphoneStatus)}</span>
        </div>
        {!isInCall && (
          <button
            onClick={toggleMinimize}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            title="Minimizar"
          >
            <Minus className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Call content */}
      {callStatus === 'ringing' && currentCall && (
        <div className="space-y-3 p-3">
          <div className="text-center">
            <p className="text-xs text-[var(--muted-foreground)]">Chamada recebida</p>
            <p className="text-sm font-medium">{currentCall.phone}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={answer}>
              <Phone className="mr-1 h-3.5 w-3.5" />
              Atender
            </Button>
            <Button size="sm" variant="destructive" className="flex-1" onClick={reject}>
              <X className="mr-1 h-3.5 w-3.5" />
              Rejeitar
            </Button>
          </div>
        </div>
      )}

      {callStatus === 'in-call' && currentCall && (
        <div className="space-y-3 p-3">
          <div className="text-center">
            <p className="text-xs text-[var(--muted-foreground)]">Chamada ativa</p>
            <p className="text-sm font-medium">{currentCall.phone}</p>
            <CallTimer startedAt={currentCall.startedAt} />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={isMuted ? 'default' : 'outline'}
              className="flex-1"
              onClick={toggleMute}
            >
              {isMuted ? (
                <><MicOff className="mr-1 h-3.5 w-3.5" /> Mudo</>
              ) : (
                <><Mic className="mr-1 h-3.5 w-3.5" /> Mute</>
              )}
            </Button>
            <Button size="sm" variant="destructive" className="flex-1" onClick={hangup}>
              <PhoneOff className="mr-1 h-3.5 w-3.5" />
              Desligar
            </Button>
          </div>
        </div>
      )}

      {callStatus === 'idle' && webphoneStatus === 'error' && (
        <div className="p-3">
          <p className="text-xs text-red-500 text-center">
            {scriptError ?? 'Erro na conexão SIP. Verifique suas credenciais.'}
          </p>
        </div>
      )}

      {/* Post-call classification dialog for non-API-initiated calls (inbound) */}
      {endedCall && (
        <PostCallClassificationDialog
          open={callStatus === 'ended'}
          phone={endedCall.phone}
          durationMs={endedCall.durationMs ?? 0}
          callRecordId={endedCall.callRecordId}
          leadId={endedCall.leadId}
          onClose={dismissEnded}
        />
      )}
    </div>
  );
}

/**
 * Wrapper that only renders the webphone if SIP credentials exist.
 * Mounted in the app layout — zero overhead when not configured.
 */
export function Api4ComWebphoneWrapper() {
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getApi4ComSipCredentials();
      if (cancelled) return;
      setHasCredentials(result.success);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!hasCredentials) return null;

  return <Api4ComWebphone />;
}
