'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import {
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Phone,
  PhoneCall,
  PhoneOff,
  RotateCcw,
  User,
} from 'lucide-react';
import Image from 'next/image';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Textarea } from '@/shared/components/ui/textarea';

import type { CallStatus } from '@/features/calls/types';
import type { DialerProvider } from '@/features/calls/types/dialer-provider';
import { initiateCall, hangupCall } from '@/features/calls/actions/initiate-call';
import { classifyWebphoneCall } from '@/features/calls/actions/classify-webphone-call';
import { useCallHangupDetection } from '@/features/calls/hooks/use-call-hangup-detection';

import type { CallAttempt } from '../types/call-attempt';
import { MAX_CALL_ATTEMPTS, formatAggregatedNotes } from '../types/call-attempt';
import type { ResolvedPhone } from '../utils/resolve-whatsapp-phone';

type CallState = 'idle' | 'calling' | 'connected' | 'ended';

// Map dialer UI status to calls table status (same as complete-dialer-call.ts)
const uiStatusToCallStatus: Record<string, CallStatus> = {
  connected: 'significant',
  gatekeeper: 'significant',
  meeting_scheduled: 'significant',
  voicemail: 'not_connected',
  no_answer: 'no_contact',
  busy: 'busy',
  wrong_number: 'not_connected',
};

interface ActivityPhonePanelProps {
  leadName: string;
  leadId: string;
  phoneNumber: string | null;
  phones: ResolvedPhone[];
  isSending: boolean;
  onMarkDone: (notes: string) => void;
  onSkip: () => void;
  activityName?: string | null;
  callScript?: string | null;
  dialerProvider?: DialerProvider;
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function ActivityPhonePanel({
  leadName,
  leadId,
  phoneNumber,
  phones,
  isSending,
  onMarkDone,
  onSkip,
  activityName,
  callScript,
  dialerProvider = 'api4com',
}: ActivityPhonePanelProps) {
  // Use first resolved phone or fallback to lead.telefone
  const initialPhone = phones[0]?.formatted ?? phoneNumber ?? '';
  const [selectedPhone, setSelectedPhone] = useState(initialPhone);
  const [callState, setCallState] = useState<CallState>('idle');
  const [providerCallId, setProviderCallId] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [callStatus, setCallStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [callDuration, setCallDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isPending, startTransition] = useTransition();
  const [attempts, setAttempts] = useState<CallAttempt[]>([]);

  const currentAttemptNumber = attempts.length + 1;
  const canRetry = currentAttemptNumber < MAX_CALL_ATTEMPTS;
  const hasMultiplePhones = phones.length > 1;
  const hasAnyPhone = selectedPhone !== '';

  // Timer for call duration
  useEffect(() => {
    if (callState === 'calling' || callState === 'connected') {
      const id = setInterval(() => setElapsed((prev) => prev + 1), 1000);
      timerRef.current = id;
      return () => clearInterval(id);
    }
    return undefined;
  }, [callState]);

  function handleInitiateCall() {
    if (!selectedPhone) return;

    setElapsed(0);
    startTransition(async () => {
      setCallState('calling');

      const result = await initiateCall({
        provider: dialerProvider,
        phone: selectedPhone,
        leadId,
      });

      if (!result.success) {
        toast.error(result.error);
        setCallState('idle');
        return;
      }

      setCallId(result.data.callId);
      setProviderCallId(result.data.providerCallId);
      setCallState('connected');

      // Notify the webphone about the call context for classification
      window.dispatchEvent(
        new CustomEvent('webphone:call-context', {
          detail: { callRecordId: result.data.callId, leadId },
        }),
      );
    });
  }

  function handleHangup() {
    setCallDuration(elapsed);

    if (!providerCallId && dialerProvider !== 'threecplus') {
      setCallState('ended');
      return;
    }

    startTransition(async () => {
      const result = await hangupCall(dialerProvider, providerCallId ?? undefined);
      if (!result.success) {
        toast.error(result.error);
      }
      setCallState('ended');
    });
  }

  function buildCurrentAttempt(): CallAttempt {
    return {
      attemptNumber: currentAttemptNumber,
      phone: selectedPhone,
      status: callStatus,
      notes,
      durationSeconds: callDuration,
    };
  }

  function handleRetryAttempt() {
    const attempt = buildCurrentAttempt();

    // Update the call record status for this attempt before retrying
    if (callId && callStatus) {
      const mappedStatus = uiStatusToCallStatus[callStatus] ?? 'not_connected';
      classifyWebphoneCall({
        callId,
        status: mappedStatus,
        clientDurationSeconds: callDuration,
        notes: notes || undefined,
        leadId,
      }).catch(() => {});
    }

    setAttempts((prev) => [...prev, attempt]);
    setCallStatus('');
    setNotes('');
    setCallState('idle');
    setCallId(null);
    setProviderCallId(null);
    setElapsed(0);
    setCallDuration(0);
  }

  function handleSubmitResult() {
    const allAttempts = [...attempts, buildCurrentAttempt()];
    const aggregatedNotes = formatAggregatedNotes(allAttempts);

    // Update the call record status in the calls table
    if (callId && callStatus) {
      const mappedStatus = uiStatusToCallStatus[callStatus] ?? 'not_connected';
      classifyWebphoneCall({
        callId,
        status: mappedStatus,
        clientDurationSeconds: callDuration,
        notes: notes || undefined,
        leadId,
      }).catch(() => {});
    }

    onMarkDone(aggregatedNotes);
    setCallStatus('');
    setNotes('');
    setCallState('idle');
    setCallId(null);
    setProviderCallId(null);
    setElapsed(0);
    setCallDuration(0);
    setAttempts([]);
  }

  function handleDismissModal() {
    // Keep previous attempts when dismissing (user might want to retry)
    setCallState('idle');
    setCallStatus('');
    setNotes('');
    setCallId(null);
    setProviderCallId(null);
    setElapsed(0);
    setCallDuration(0);
  }

  const isInCall = callState === 'calling' || callState === 'connected';

  const handleRemoteHangup = useCallback((durationSeconds: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setCallDuration(durationSeconds);
    setCallState('ended');
  }, []);

  useCallHangupDetection({
    callId,
    isActive: isInCall,
    onHangup: handleRemoteHangup,
  });

  return (
    <div className="flex h-full flex-col">
      {/* Origem / Destino header */}
      <div className="flex items-start justify-between rounded-lg border border-[var(--border)] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--muted)]">
            <User className="h-5 w-5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          </div>
          <div>
            <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Origem</p>
            <p className="text-sm font-medium">Sua linha</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div>
            <p className="text-right text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Destino</p>
            <p className="text-sm font-medium">{leadName}</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10">
            <PhoneCall className="h-5 w-5 text-green-500" />
          </div>
        </div>
      </div>

      {/* Phone selector — show when multiple phones or retrying */}
      {phones.length > 0 && (hasMultiplePhones || attempts.length > 0) && (
        <div className="mt-4 space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Selecionar telefone
          </Label>
          <Select value={selectedPhone} onValueChange={setSelectedPhone} disabled={isInCall}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um telefone..." />
            </SelectTrigger>
            <SelectContent>
              {phones.map((p) => (
                <SelectItem key={p.raw} value={p.formatted}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Call script / Roteiro */}
      {callScript && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/50 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            {activityName ?? 'Roteiro da Ligação'}
          </p>
          <p className="whitespace-pre-wrap text-sm">{callScript}</p>
        </div>
      )}

      {/* Previous attempts summary */}
      {attempts.length > 0 && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-amber-500/5 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            Tentativas anteriores ({attempts.length})
          </p>
          {attempts.map((a) => (
            <p key={a.attemptNumber} className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              #{a.attemptNumber} — {a.phone} — [{a.status}] {a.notes ? `${a.notes} ` : ''}({a.durationSeconds}s)
            </p>
          ))}
        </div>
      )}

      {/* Call section — centered */}
      <div className="flex flex-1 flex-col items-center justify-center py-8">
        {hasAnyPhone ? (
          <>
            {/* Attempt indicator */}
            <p className="mb-2 text-xs font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Tentativa {currentAttemptNumber} de {MAX_CALL_ATTEMPTS}
            </p>

            <p className="mb-1 text-2xl font-bold tabular-nums tracking-wide">
              {selectedPhone}
            </p>

            {/* Timer display during call */}
            {isInCall && (
              <p className="mb-2 font-mono text-lg tabular-nums text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                {formatTimer(elapsed)}
              </p>
            )}

            {/* Call action buttons */}
            <div className="mt-3 flex items-center gap-4">
              {callState === 'idle' && (
                <button
                  onClick={handleInitiateCall}
                  disabled={isPending}
                  className={`flex h-16 w-16 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 ${dialerProvider === 'api4com' ? 'bg-gradient-to-br from-cyan-400 to-blue-600' : 'bg-green-600 text-white hover:bg-green-500'}`}
                  title={dialerProvider === 'threecplus' ? 'Ligar via 3CPlus' : 'Ligar via API4COM'}
                >
                  {dialerProvider === 'api4com' ? (
                    <Image src="/logos/api4com-logo.png" alt="API4COM" width={40} height={40} className="rounded-full brightness-0 invert" />
                  ) : (
                    <Phone className="h-7 w-7" />
                  )}
                </button>
              )}

              {callState === 'calling' && (
                <>
                  <div className={`flex h-16 w-16 animate-pulse items-center justify-center rounded-full shadow-lg ${dialerProvider === 'api4com' ? 'bg-gradient-to-br from-cyan-400 to-blue-600' : 'bg-yellow-500 text-white'}`}>
                    {dialerProvider === 'api4com' ? (
                      <Image src="/logos/api4com-logo.png" alt="API4COM" width={40} height={40} className="rounded-full brightness-0 invert" />
                    ) : (
                      <Phone className="h-7 w-7" />
                    )}
                  </div>
                  <button
                    onClick={handleHangup}
                    disabled={isPending}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white shadow transition-transform hover:scale-105 hover:bg-red-500 active:scale-95"
                    title="Desligar"
                  >
                    <PhoneOff className="h-5 w-5" />
                  </button>
                </>
              )}

              {callState === 'connected' && (
                <button
                  onClick={handleHangup}
                  disabled={isPending}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition-transform hover:scale-105 hover:bg-red-500 active:scale-95"
                  title="Desligar"
                >
                  <PhoneOff className="h-7 w-7" />
                </button>
              )}
            </div>

            <p className="mt-2 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              {callState === 'idle' && (dialerProvider === 'threecplus' ? 'Clique para ligar via 3CPlus' : 'Clique para ligar via API4COM')}
              {callState === 'calling' && 'Chamando...'}
              {callState === 'connected' && 'Em chamada'}
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Sem telefone cadastrado para este lead.
          </p>
        )}
      </div>

      {/* Actions — skip only (result is handled via modal) */}
      <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
        <Button variant="outline" onClick={onSkip} disabled={isSending || isInCall}>
          <Clock className="mr-2 h-4 w-4" />
          Pular
        </Button>
      </div>

      {/* Post-call result modal */}
      <Dialog open={callState === 'ended'} onOpenChange={(open) => !open && handleDismissModal()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Resultado da Ligação</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Call duration summary */}
            <div className="flex items-center justify-between rounded-lg bg-[var(--muted)] px-4 py-3">
              <div>
                <p className="text-sm font-medium">{leadName}</p>
                <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{selectedPhone}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm tabular-nums">{formatTimer(callDuration)}</p>
                <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Duração</p>
              </div>
            </div>

            {/* Call status */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Status da Ligação
              </Label>
              <Select value={callStatus} onValueChange={setCallStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o resultado..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="connected">Conectou — conversou com decisor</SelectItem>
                  <SelectItem value="gatekeeper">Conectou — falou com intermediário</SelectItem>
                  <SelectItem value="voicemail">Caixa postal</SelectItem>
                  <SelectItem value="no_answer">Não atendeu</SelectItem>
                  <SelectItem value="busy">Ocupado</SelectItem>
                  <SelectItem value="wrong_number">Número errado</SelectItem>
                  <SelectItem value="meeting_scheduled">Reunião agendada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  Anotações
                </Label>
              </div>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Faça anotações sobre a ligação..."
                className="min-h-[100px] resize-y"
              />
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={handleDismissModal}>
              Cancelar
            </Button>
            {canRetry && (
              <Button variant="secondary" onClick={handleRetryAttempt} disabled={!callStatus}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Tentar novamente
              </Button>
            )}
            <Button onClick={handleSubmitResult} disabled={isSending || !callStatus}>
              {isSending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Concluir atividade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
