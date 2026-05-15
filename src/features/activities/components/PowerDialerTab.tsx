'use client';

import { useCallback, useRef, useState, useTransition } from 'react';

import { Pause, Phone, SkipForward } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';

import type { DialerProvider } from '@/features/calls/types/dialer-provider';
import { initiateCall, hangupCall } from '@/features/calls/actions/initiate-call';
import { useCallHangupDetection } from '@/features/calls/hooks/use-call-hangup-detection';

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';
import type { DialerPreferences, DialerStats } from '../schemas/dialer-preferences.schemas';
import { completeDialerCall } from '../actions/complete-dialer-call';

import { DialerCallPanel, type CallState } from './DialerCallPanel';
import { DialerProgressBar } from './DialerProgressBar';
import { DialerQueueList, type DialerItemStatus } from './DialerQueueList';
import { PowerDialerIdleLayout } from './PowerDialerIdleLayout';

interface PowerDialerTabProps {
  initialQueue: DialerQueueItem[];
  stats: DialerStats;
  preferences: DialerPreferences;
  dialerProvider?: DialerProvider;
}

export function PowerDialerTab({ initialQueue, stats: initialStats, preferences: initialPreferences, dialerProvider = 'api4com' }: PowerDialerTabProps) {
  const [queue] = useState<DialerQueueItem[]>(initialQueue);
  const [currentPreferences, setCurrentPreferences] = useState<DialerPreferences>(initialPreferences);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [itemStatuses, setItemStatuses] = useState<Map<string, DialerItemStatus>>(new Map());
  const [isPending, startTransition] = useTransition();
  // Synchronous guard against double-clicks (see ActivityPhonePanel.tsx).
  const inFlightRef = useRef(false);

  const [callState, setCallState] = useState<CallState>('idle');
  const [providerCallId, setProviderCallId] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);

  const completedCount = [...itemStatuses.values()].filter((s) => s === 'completed').length;
  const skippedCount = [...itemStatuses.values()].filter((s) => s === 'skipped').length;

  const currentItem = queue[currentIndex];

  // Find next pending index from a given position
  const findNextPending = useCallback(
    (fromIndex: number, statuses: Map<string, DialerItemStatus>) => {
      for (let i = fromIndex + 1; i < queue.length; i++) {
        const item = queue[i];
        if (item && !statuses.has(item.enrollmentId)) return i;
      }
      return -1; // no more pending
    },
    [queue],
  );

  function resetCallState() {
    setCallState('idle');
    setCallId(null);
    setProviderCallId(null);
  }

  const isInCall = callState === 'calling' || callState === 'connected';

  const handleRemoteHangup = useCallback((_durationSeconds: number) => {
    setCallState('ended');
  }, []);

  useCallHangupDetection({
    callId,
    isActive: isInCall,
    onHangup: handleRemoteHangup,
  });

  function handleStart() {
    setIsActive(true);
    // If current is already done, find next pending
    if (currentItem && itemStatuses.has(currentItem.enrollmentId)) {
      const next = findNextPending(currentIndex - 1, itemStatuses);
      if (next >= 0) setCurrentIndex(next);
    }
  }

  function handlePause() {
    setIsActive(false);
  }

  function handleSkip() {
    if (!currentItem) return;
    const newStatuses = new Map(itemStatuses);
    newStatuses.set(currentItem.enrollmentId, 'skipped');
    setItemStatuses(newStatuses);
    resetCallState();

    const next = findNextPending(currentIndex, newStatuses);
    if (next >= 0) {
      setCurrentIndex(next);
    } else {
      setIsActive(false);
      toast.info('Fila de ligacoes concluida!');
    }
  }

  function handleInitiateCall(phone?: string) {
    const phoneToCall = phone ?? currentItem?.phone;
    if (!phoneToCall) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    startTransition(async () => {
      setCallState('calling');

      const result = await initiateCall({
        provider: dialerProvider,
        phone: phoneToCall,
        leadId: currentItem?.leadId ?? '',
      });

      if (!result.success) {
        if (result.error?.includes('ramal') || result.error?.includes('offline') || result.error?.includes('not registered') || result.error?.includes('503')) {
          toast.error('Abra a extensão API4COM (webphone) antes de ligar', { duration: 5000 });
        } else {
          toast.error(result.error);
        }
        setCallState('idle');
        inFlightRef.current = false;
        return;
      }

      setCallId(result.data.callId);
      setProviderCallId(result.data.providerCallId);
      setCallState('connected');
      inFlightRef.current = false;
    });
  }

  function handleRetry() {
    resetCallState();
  }

  function handleHangup() {
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

  function handleComplete(callStatus: string, notes: string, durationSeconds: number) {
    if (!currentItem) return;

    startTransition(async () => {
      const result = await completeDialerCall({
        enrollmentId: currentItem.enrollmentId,
        cadenceId: currentItem.cadenceId,
        stepId: currentItem.stepId,
        leadId: currentItem.leadId,
        phone: currentItem.phone ?? '',
        callStatus,
        notes,
        durationSeconds,
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      const newStatuses = new Map(itemStatuses);
      newStatuses.set(currentItem.enrollmentId, 'completed');
      setItemStatuses(newStatuses);
      resetCallState();

      const next = findNextPending(currentIndex, newStatuses);
      if (next >= 0) {
        setCurrentIndex(next);
      } else {
        setIsActive(false);
        toast.success('Todas as ligacoes foram concluidas!');
      }
    });
  }

  function handleSelectIndex(index: number) {
    setCurrentIndex(index);
    resetCallState();
    if (!isActive) setIsActive(true);
  }

  // Idle state: show Meetime-style layout
  if (!isActive) {
    return (
      <PowerDialerIdleLayout
        queue={queue}
        stats={initialStats}
        preferences={currentPreferences}
        onStart={handleStart}
        onPreferencesSaved={setCurrentPreferences}
        dialerProvider={dialerProvider}
      />
    );
  }

  // Active state: existing call flow
  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <DialerProgressBar completed={completedCount} skipped={skippedCount} total={queue.length} />

      {/* Controls */}
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex items-center gap-2">
          <Phone className="h-5 w-5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          <span className="text-sm font-medium">Fila de Discagem</span>
          <Badge variant="secondary" className="text-xs">{queue.length} leads</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={handlePause} aria-label="Pausar">
                <Pause className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Pausar</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={handleSkip} aria-label="Pular">
                <SkipForward className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Pular</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Main content: queue + call panel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left: Queue list */}
        <div className="lg:col-span-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
            <h3 className="mb-3 text-sm font-semibold text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Fila ({queue.length - completedCount - skippedCount} restantes)
            </h3>
            <DialerQueueList
              items={queue}
              itemStatuses={itemStatuses}
              currentIndex={currentIndex}
              isActive={isActive}
              onSelect={handleSelectIndex}
            />
          </div>
        </div>

        {/* Right: Call panel */}
        <div className="lg:col-span-8">
          {currentItem ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
              <DialerCallPanel
                item={currentItem}
                isSending={isPending}
                callState={callState}
                onComplete={handleComplete}
                onSkip={handleSkip}
                onInitiateCall={handleInitiateCall}
                onHangup={handleHangup}
                onRetry={handleRetry}
                dialerProvider={dialerProvider}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] p-12">
              <div className="text-center">
                <Phone className="mx-auto h-10 w-10 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                <p className="mt-3 text-sm font-medium">Selecione um lead na fila</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
