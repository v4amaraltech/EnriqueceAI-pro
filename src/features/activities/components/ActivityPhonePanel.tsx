'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { Clock, Phone, PhoneCall, PhoneOff, User } from 'lucide-react';
import Image from 'next/image';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import type { DialerProvider } from '@/features/calls/types/dialer-provider';
import { initiateCall, hangupCall } from '@/features/calls/actions/initiate-call';
import { classifyWebphoneCall } from '@/features/calls/actions/classify-webphone-call';
import { markMeetingNoShow } from '@/features/leads/actions/lead-noshow';
import { scheduleActivity } from '../actions/schedule-activity';
import { useCallHangupDetection } from '@/features/calls/hooks/use-call-hangup-detection';
import { CallResultModal, type CallReturnSchedule } from './CallResultModal';

import type { CallAttempt } from '../types/call-attempt';
import { MAX_CALL_ATTEMPTS, formatAggregatedNotes } from '../types/call-attempt';
import { formatDuration } from '@/lib/utils/format';

import type { ResolvedPhone } from '../utils/resolve-whatsapp-phone';

type CallState = 'idle' | 'calling' | 'connected' | 'ended';

interface ActivityPhonePanelProps {
  leadName: string;
  leadId: string;
  leadEmail?: string | null;
  leadFirstName?: string | null;
  phoneNumber: string | null;
  phones: ResolvedPhone[];
  isSending: boolean;
  onMarkDone: (notes: string) => void;
  onSkip: () => void;
  onLeadLost?: () => void;
  /** When true, shows a "No-show" button (lead has a scheduled meeting). */
  canMarkNoShow?: boolean;
  activityName?: string | null;
  callScript?: string | null;
  dialerProvider?: DialerProvider;
}

export function ActivityPhonePanel({
  leadName,
  leadId,
  leadEmail,
  leadFirstName,
  phoneNumber,
  phones,
  isSending,
  onMarkDone,
  onSkip,
  onLeadLost,
  canMarkNoShow,
  activityName,
  callScript,
  dialerProvider = 'api4com',
}: ActivityPhonePanelProps) {
  // Use first resolved phone or fallback to lead.telefone
  const initialPhone = phones[0]?.formatted ?? phoneNumber ?? '';
  const [selectedPhone, setSelectedPhone] = useState(initialPhone);
  const [availablePhones, setAvailablePhones] = useState(phones);
  const [callState, setCallState] = useState<CallState>('idle');
  const [providerCallId, setProviderCallId] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [callStatus, setCallStatus] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [callDuration, setCallDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isPending, startTransition] = useTransition();
  // Synchronous guard against double-clicks. useTransition's isPending only
  // flips on the next render, so two clicks fired before React reconciles
  // (~16ms apart) both pass disabled={isPending}=false. Rafael's ramal alone
  // produced 45 phantom duplicates this way in 7 days — calls separated by
  // <5s with both supposedly answered, which is physically impossible.
  const inFlightRef = useRef(false);
  const [attempts, setAttempts] = useState<CallAttempt[]>([]);

  const currentAttemptNumber = attempts.length + 1;
  const canRetry = currentAttemptNumber < MAX_CALL_ATTEMPTS;
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
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    setElapsed(0);
    startTransition(async () => {
      setCallState('calling');

      const result = await initiateCall({
        provider: dialerProvider,
        phone: selectedPhone,
        leadId,
      });

      if (!result.success) {
        // Show backend error if present, otherwise generic guidance
        const errorMsg = result.error || 'Verifique se a extensão API4COM está aberta e tente novamente.';
        console.error('[ActivityPhonePanel] initiateCall failed:', result.error);
        toast.error(errorMsg, { duration: 8000 });
        setCallState('idle');
        inFlightRef.current = false;
        return;
      }

      setCallId(result.data.callId);
      setProviderCallId(result.data.providerCallId);
      setCallState('connected');
      inFlightRef.current = false;

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

    if (!providerCallId) {
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

  function buildCurrentAttempt(attemptNotes: string): CallAttempt {
    return {
      attemptNumber: currentAttemptNumber,
      phone: selectedPhone,
      status: callStatus,
      notes: attemptNotes,
      durationSeconds: callDuration,
    };
  }

  function handleRetryAttempt(attemptNotes: string) {
    const attempt = buildCurrentAttempt(attemptNotes);

    // Persist notes + duration. Call status (significant/not_connected/etc)
    // is owned by the API4COM webhook now — we don't pass it here.
    if (callId) {
      classifyWebphoneCall({
        callId,
        clientDurationSeconds: callDuration,
        notes: attemptNotes || undefined,
        leadId,
      }).catch((err: unknown) => console.error('[ActivityPhonePanel] classifyWebphoneCall failed:', err));
    }

    // Re-fetch lead phones in case new ones were added during the call
    import('@/features/leads/actions/fetch-lead-phones').then(({ fetchLeadPhones }) =>
      fetchLeadPhones(leadId).then((result) => {
        if (result.success && result.data.length > 0) {
          setAvailablePhones(result.data);
        }
      }),
    ).catch(() => {});

    setAttempts((prev) => [...prev, attempt]);
    setCallStatus('');
    setCallState('idle');
    setCallId(null);
    setProviderCallId(null);
    setElapsed(0);
    setCallDuration(0);
  }

  function handleSubmitResult(resultNotes: string, returnSchedule: CallReturnSchedule | null) {
    const allAttempts = [...attempts, buildCurrentAttempt(resultNotes)];
    const aggregatedNotes = formatAggregatedNotes(allAttempts);

    // Persist notes + duration. Call status (significant/not_connected/etc)
    // is owned by the API4COM webhook now — we don't pass it here.
    if (callId) {
      classifyWebphoneCall({
        callId,
        clientDurationSeconds: callDuration,
        notes: resultNotes || undefined,
        leadId,
      }).catch((err: unknown) => console.error('[ActivityPhonePanel] classifyWebphoneCall failed:', err));
    }

    // Schedule return activity if requested
    if (returnSchedule) {
      scheduleActivity({
        leadId,
        channel: returnSchedule.channel,
        callProvider: returnSchedule.callProvider,
        scheduledAt: returnSchedule.scheduledAt,
        notes: resultNotes ? `Retorno: ${resultNotes}` : undefined,
        completeEnrollments: true,
      }).catch((err) => console.error('[ActivityPhonePanel] scheduleActivity failed:', err));
    }

    onMarkDone(aggregatedNotes);
    setCallStatus('');
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
    setCallId(null);
    setProviderCallId(null);
    setElapsed(0);
    setCallDuration(0);
  }

  function handleMarkNoShow() {
    startTransition(async () => {
      const result = await markMeetingNoShow(leadId);
      if (result.success) {
        toast.success('No-show registrado — follow-up criado na fila do SDR');
        handleDismissModal();
      } else {
        toast.error(result.error);
      }
    });
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
      {/* API4COM webphone reminder */}
      {dialerProvider === 'api4com' && callState === 'idle' && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
          <Image src="/logos/api4com-logo.png" alt="API4COM" width={24} height={24} className="shrink-0 rounded" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Certifique-se de que a <strong>extensão API4COM (webphone)</strong> está aberta no navegador antes de ligar.
          </p>
        </div>
      )}

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
      {availablePhones.length > 0 && (availablePhones.length > 1 || attempts.length > 0) && (
        <div className="mt-4 space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Selecionar telefone
          </Label>
          <Select value={selectedPhone} onValueChange={setSelectedPhone} disabled={isInCall}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um telefone..." />
            </SelectTrigger>
            <SelectContent>
              {availablePhones.map((p) => (
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
                {formatDuration(elapsed)}
              </p>
            )}

            {/* Call action buttons */}
            <div className="mt-3 flex items-center gap-4">
              {callState === 'idle' && (
                <button
                  onClick={handleInitiateCall}
                  disabled={isPending}
                  className={`flex h-16 w-16 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 ${dialerProvider === 'api4com' ? 'bg-gradient-to-br from-cyan-400 to-blue-600' : 'bg-green-600 text-white hover:bg-green-500'}`}
                  title="Ligar via API4COM"
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
              {callState === 'idle' && 'Clique para ligar via API4COM'}
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

      {/* Post-call result modal — shared component (também usado na Ligação WhatsApp) */}
      <CallResultModal
        open={callState === 'ended'}
        onClose={handleDismissModal}
        leadName={leadName}
        leadId={leadId}
        leadEmail={leadEmail}
        leadFirstName={leadFirstName}
        phoneLabel={selectedPhone}
        durationSeconds={callDuration}
        isSending={isSending || isPending}
        onRetry={canRetry ? handleRetryAttempt : undefined}
        onMarkNoShow={canMarkNoShow ? handleMarkNoShow : undefined}
        onLeadLost={
          onLeadLost
            ? () => {
                handleDismissModal();
                onLeadLost();
              }
            : undefined
        }
        onConclude={({ notes, returnSchedule }) => handleSubmitResult(notes, returnSchedule)}
      />
    </div>
  );
}
