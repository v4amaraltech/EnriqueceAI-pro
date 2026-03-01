'use client';

import { useEffect, useRef, useState } from 'react';

import {
  CheckCircle2,
  FileText,
  Loader2,
  Phone,
  PhoneCall,
  PhoneOff,
  SkipForward,
  User,
} from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Textarea } from '@/shared/components/ui/textarea';

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';

export type CallState = 'idle' | 'calling' | 'connected' | 'ended';

interface DialerCallPanelProps {
  item: DialerQueueItem;
  isSending: boolean;
  callState: CallState;
  onComplete: (callStatus: string, notes: string, durationSeconds: number) => void;
  onSkip: () => void;
  onInitiateCall: () => void;
  onHangup: () => void;
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function DialerCallPanel({
  item,
  isSending,
  callState,
  onComplete,
  onSkip,
  onInitiateCall,
  onHangup,
}: DialerCallPanelProps) {
  const [callStatus, setCallStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timer for call duration — starts on calling/connected, resets on idle
  useEffect(() => {
    if (callState === 'calling' || callState === 'connected') {
      const id = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
      timerRef.current = id;
      return () => clearInterval(id);
    }
    // Reset elapsed via timeout to avoid sync setState in effect body
    const resetId = setTimeout(() => setElapsed(0), 0);
    return () => clearTimeout(resetId);
  }, [callState]);

  function handleComplete() {
    onComplete(callStatus, notes, elapsed);
    setCallStatus('');
    setNotes('');
    setElapsed(0);
  }

  const isInCall = callState === 'calling' || callState === 'connected';

  return (
    <div className="flex h-full flex-col">
      {/* Origem / Destino header */}
      <div className="flex items-start justify-between rounded-lg border border-[var(--border)] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--muted)]">
            <User className="h-5 w-5 text-[var(--muted-foreground)]" />
          </div>
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">Origem</p>
            <p className="text-sm font-medium">Sua linha</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div>
            <p className="text-right text-xs text-[var(--muted-foreground)]">Destino</p>
            <p className="text-sm font-medium">{item.leadName}</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10">
            <PhoneCall className="h-5 w-5 text-green-500" />
          </div>
        </div>
      </div>

      {/* Cadence context */}
      <div className="mt-3 flex items-center gap-2">
        <Badge variant="secondary" className="text-xs">
          {item.cadenceName}
        </Badge>
        <span className="text-xs text-[var(--muted-foreground)]">
          Passo {item.stepOrder} de {item.totalSteps}
          {item.activityName ? ` · ${item.activityName}` : ''}
        </span>
      </div>

      {/* Call script / Roteiro */}
      {item.callScript && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/50 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Roteiro da Ligação
          </p>
          <p className="whitespace-pre-wrap text-sm">{item.callScript}</p>
        </div>
      )}

      {/* Call section — centered */}
      <div className="flex flex-col items-center py-6">
        {item.phone ? (
          <>
            <p className="mb-1 text-2xl font-bold tabular-nums tracking-wide">
              {item.phone}
            </p>

            {/* Timer display during call */}
            {isInCall && (
              <p className="mb-2 text-lg font-mono tabular-nums text-[var(--muted-foreground)]">
                {formatTimer(elapsed)}
              </p>
            )}

            {/* Call action buttons */}
            <div className="mt-3 flex items-center gap-4">
              {callState === 'idle' && (
                <button
                  onClick={onInitiateCall}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-green-600 text-white shadow-lg transition-transform hover:scale-105 hover:bg-green-500 active:scale-95"
                  title="Ligar via API4COM"
                >
                  <Phone className="h-7 w-7" />
                </button>
              )}

              {callState === 'calling' && (
                <>
                  <div className="flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-yellow-500 text-white shadow-lg">
                    <Phone className="h-7 w-7" />
                  </div>
                  <button
                    onClick={onHangup}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white shadow transition-transform hover:scale-105 hover:bg-red-500 active:scale-95"
                    title="Desligar"
                  >
                    <PhoneOff className="h-5 w-5" />
                  </button>
                </>
              )}

              {callState === 'connected' && (
                <button
                  onClick={onHangup}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition-transform hover:scale-105 hover:bg-red-500 active:scale-95"
                  title="Desligar"
                >
                  <PhoneOff className="h-7 w-7" />
                </button>
              )}

              {callState === 'ended' && (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--muted)]">
                  <Phone className="h-7 w-7 text-[var(--muted-foreground)]" />
                </div>
              )}
            </div>

            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              {callState === 'idle' && 'Clique para ligar via API4COM'}
              {callState === 'calling' && 'Chamando...'}
              {callState === 'connected' && 'Em chamada'}
              {callState === 'ended' && 'Chamada encerrada — selecione o resultado'}
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">
            Sem telefone cadastrado para este lead.
          </p>
        )}
      </div>

      {/* Call status */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Status da Ligacao
        </Label>
        <Select value={callStatus} onValueChange={setCallStatus}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione o resultado..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="connected">Conectou — conversou com decisor</SelectItem>
            <SelectItem value="gatekeeper">Conectou — falou com intermediario</SelectItem>
            <SelectItem value="voicemail">Caixa postal</SelectItem>
            <SelectItem value="no_answer">Nao atendeu</SelectItem>
            <SelectItem value="busy">Ocupado</SelectItem>
            <SelectItem value="wrong_number">Numero errado</SelectItem>
            <SelectItem value="meeting_scheduled">Reuniao agendada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Notes */}
      <div className="mt-4 flex-1 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Bloco de Notas
          </Label>
        </div>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Faca anotacoes que possam auxiliar a sua comunicacao com o cliente."
          className="min-h-[100px] resize-y"
        />
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
        <Button variant="outline" onClick={onSkip} disabled={isSending || isInCall}>
          <SkipForward className="mr-2 h-4 w-4" />
          Pular
        </Button>
        <Button onClick={handleComplete} disabled={isSending || !callStatus || isInCall}>
          {isSending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          Concluir e avancar
        </Button>
      </div>
    </div>
  );
}
