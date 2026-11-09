'use client';

import { Mic, MicOff } from 'lucide-react';

import { toggleMute } from '@/features/integrations/webphone/webphone-client';
import type { WebphoneCall } from '@/features/integrations/webphone/webphone-state';

interface DockMicControlProps {
  /** Ramal registrado nesta aba e microfone do navegador não recusado. */
  webphoneReady: boolean;
  /** Chamada SIP desta aba. Null quando o áudio está na extensão ou ainda não há sessão. */
  sipCall: Pick<WebphoneCall, 'phase' | 'muted'> | null;
  /** O dock mostra Encerrar (calling/connected), mesmo se o SIP já tiver caído. */
  dockInCall: boolean;
}

/**
 * No dock da ligação, o microfone ao lado de Encerrar é o mute da sessão SIP
 * desta aba. Fora de uma sessão `in-call` ele não finge ação: ou avisa que
 * não há áudio para silenciar, ou volta a ser o indicador de prontidão.
 */
export function DockMicControl({ webphoneReady, sipCall, dockInCall }: DockMicControlProps) {
  if (sipCall?.phase === 'in-call') {
    const muted = sipCall.muted;
    return (
      <button
        type="button"
        data-testid="dock-mic-toggle"
        onClick={() => toggleMute()}
        aria-pressed={muted}
        aria-label={muted ? 'Reativar microfone' : 'Silenciar microfone'}
        title={muted ? 'Microfone silenciado. Clique para voltar a falar.' : 'Silenciar o microfone desta aba'}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border bg-background hover:bg-muted"
      >
        {muted ? (
          <MicOff className="h-4 w-4 text-amber-400" aria-hidden />
        ) : (
          <Mic className="h-4 w-4 text-emerald-400" aria-hidden />
        )}
      </button>
    );
  }

  if (dockInCall) {
    return (
      <button
        type="button"
        data-testid="dock-mic-unavailable"
        disabled
        aria-label="Silenciar microfone indisponível"
        title="Não há áudio desta aba para silenciar: a sessão ainda não conectou ou o provedor já encerrou."
        className="inline-flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-full border text-muted-foreground opacity-60"
      >
        <MicOff className="h-4 w-4" aria-hidden />
      </button>
    );
  }

  return (
    <span
      data-testid="dock-mic-status"
      className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground"
      title={webphoneReady ? 'Microfone desta aba pronto' : 'Microfone desta aba indisponível'}
    >
      {webphoneReady ? (
        <Mic className="h-4 w-4 text-emerald-600" aria-label="Microfone pronto" />
      ) : (
        <MicOff className="h-4 w-4" aria-label="Microfone indisponível" />
      )}
    </span>
  );
}
