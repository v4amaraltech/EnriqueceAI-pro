'use client';

import { useEffect } from 'react';

import { ChevronLeft, ChevronRight, X, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/shared/components/ui/sheet';

import type { DialerProvider } from '@/features/calls/types/dialer-provider';

import { executeActivity } from '../actions/execute-activity';
import { executeScheduledActivity } from '../actions/execute-scheduled-activity';
import { reportWhatsAppInvalid } from '../actions/report-whatsapp-invalid';
import { skipActivity } from '../actions/skip-activity';
import type { PendingActivity } from '../types';
import { resolveWhatsAppPhone } from '../utils/resolve-whatsapp-phone';

import { ActivityLeadContext } from './ActivityLeadContext';
import { ActivityExecutionSheetContent } from './ActivityExecutionSheetContent';

interface ActivityExecutionSheetProps {
  activities: PendingActivity[];
  selectedKey: string | null;
  onClose: () => void;
  onNavigate: (key: string) => void;
  onActivityDone: (enrollmentId: string, stepId: string) => void;
  onActivityRestore: (activity: PendingActivity) => void;
  onLeadLost?: (activity: PendingActivity) => void;
  dialerProvider?: DialerProvider;
  quickMode?: boolean;
}

const keyOf = (a: PendingActivity) => `${a.enrollmentId}:${a.stepId}`;

export function ActivityExecutionSheet({
  activities,
  selectedKey,
  onClose,
  onNavigate,
  onActivityDone,
  onActivityRestore,
  onLeadLost,
  dialerProvider,
  quickMode = false,
}: ActivityExecutionSheetProps) {

  const selectedIndex = selectedKey !== null
    ? activities.findIndex((a) => keyOf(a) === selectedKey)
    : -1;
  const activity = selectedIndex >= 0 ? activities[selectedIndex] : null;

  // Defensive guard: when selectedKey points to an activity that no longer
  // exists (markLeadAsLost / scheduleActivity completes every enrollment for
  // the lead at once, so the next item the sheet tried to advance to may also
  // have vanished), close the sheet instead of rendering an empty SheetContent
  // that looks like a "black screen" on dark theme.
  useEffect(() => {
    if (selectedKey !== null && activity === null) {
      onClose();
    }
  }, [selectedKey, activity, onClose]);

  // Advance to next activity or close if last. Resolves the next activity by key
  // BEFORE the parent removes the completed one, so subsequent re-renders (RSC
  // revalidation, server reordering) cannot misalign the selection.
  function advanceOrClose(enrollmentId: string, stepId: string) {
    const currentIdx = activities.findIndex(
      (a) => a.enrollmentId === enrollmentId && a.stepId === stepId,
    );
    const nextActivity = currentIdx >= 0 ? activities[currentIdx + 1] : undefined;

    onActivityDone(enrollmentId, stepId);

    const remaining = activities.length - 1;

    if (nextActivity) {
      toast.success(
        remaining <= 3
          ? `Quase lá! ${remaining} restante${remaining > 1 ? 's' : ''}`
          : `Feito! (${currentIdx + 1}/${activities.length})`,
      );
      onNavigate(keyOf(nextActivity));
    } else {
      toast('Todas as atividades concluídas!', {
        icon: '🎉',
        duration: 4000,
      });
      onClose();
    }
  }

  // Optimistic completion: the caller advances the UI immediately, then hands
  // the server work here to run in the background. The persistence (create
  // interaction + advance enrollment) is idempotent, so moving on before it
  // finishes is safe. If it fails, put the activity back on the queue with a
  // clear error so the SDR never silently loses a step.
  function persistInBackground(
    act: PendingActivity,
    persist: () => Promise<{ success: boolean; error?: string }>,
    onSuccess?: () => void,
  ) {
    void persist()
      .then((result) => {
        if (result.success) {
          onSuccess?.();
        } else {
          onActivityRestore(act);
          toast.error(result.error ?? 'Não foi possível registrar — atividade devolvida à fila');
        }
      })
      .catch((err) => {
        console.error('[ActivityExecutionSheet] background persist failed:', err);
        onActivityRestore(act);
        toast.error('Não foi possível registrar — atividade devolvida à fila');
      });
  }

  const isScheduled = activity?.enrollmentId.startsWith('scheduled:') ?? false;

  const handleSend = (subject: string, body: string, aiGenerated: boolean, phone?: string) => {
    if (!activity) return;
    const act = activity;

    const isWhatsApp = act.channel === 'whatsapp';
    const resolvedEmail = (act.lead.socios ?? [])
      .flatMap((s) => s.emails ?? [])
      .sort((a, b) => a.ranking - b.ranking)[0]?.email
      ?? act.lead.email
      ?? '';
    const to = phone
      ?? (isWhatsApp
        ? (resolveWhatsAppPhone(act.lead)?.formatted ?? '')
        : resolvedEmail);

    // Hard precondition — block before advancing, since without a creator we
    // can't attribute the send.
    if (!isScheduled && !act.cadenceCreatedBy) {
      toast.error('Cadência sem usuário criador — não é possível enviar');
      return;
    }

    // Advance immediately; the actual send confirms/rolls back in the background.
    // The "enviado" toast fires on success (a real send can fail — no credit,
    // bounce), so we don't claim it sent before it did.
    advanceOrClose(act.enrollmentId, act.stepId);

    const persist = isScheduled
      ? () => executeScheduledActivity({
          scheduledActivityId: act.stepId,
          leadId: act.lead.id,
          channel: act.channel,
          to,
          subject,
          body,
          aiGenerated,
        })
      : () => executeActivity({
          enrollmentId: act.enrollmentId,
          cadenceId: act.cadenceId,
          stepId: act.stepId,
          leadId: act.lead.id,
          orgId: act.lead.org_id,
          cadenceCreatedBy: act.cadenceCreatedBy!,
          channel: act.channel,
          to,
          subject,
          body,
          aiGenerated,
          templateId: act.templateId,
        });

    persistInBackground(act, persist, () =>
      toast.success(isWhatsApp ? 'WhatsApp enviado!' : 'Email enviado!', { icon: isWhatsApp ? '💬' : '📧' }),
    );
  };

  const handleMarkDone = (notes: string) => {
    if (!activity) return;
    const act = activity;

    // Manual conclude (phone/research/task) just logs + advances the enrollment —
    // near-zero failure and idempotent — so we confirm and advance immediately.
    toast.success('Atividade concluída!', { icon: '✅' });
    advanceOrClose(act.enrollmentId, act.stepId);

    const persist = isScheduled
      ? () => executeScheduledActivity({
          scheduledActivityId: act.stepId,
          leadId: act.lead.id,
          channel: act.channel,
          to: '',
          subject: '',
          body: notes,
          aiGenerated: false,
        })
      : () => executeActivity({
          enrollmentId: act.enrollmentId,
          cadenceId: act.cadenceId,
          stepId: act.stepId,
          leadId: act.lead.id,
          orgId: act.lead.org_id,
          cadenceCreatedBy: act.cadenceCreatedBy ?? '',
          channel: act.channel,
          to: '',
          subject: '',
          body: notes,
          aiGenerated: false,
          templateId: null,
        });

    persistInBackground(act, persist);
  };

  // Ligação via WhatsApp: a disposition (7.6) já avançou/reagendou a cadência,
  // então aqui só seguimos para a próxima atividade / fechamos — SEM executeActivity.
  const handleCallResolved = () => {
    if (!activity) return;
    advanceOrClose(activity.enrollmentId, activity.stepId);
  };

  const handleReportWhatsAppInvalid = () => {
    if (!activity) return;
    const act = activity;
    if (isScheduled) {
      toast.error('Atividades agendadas não suportam essa ação ainda');
      return;
    }

    toast.success('Lead marcado como sem WhatsApp', { icon: '🚫' });
    advanceOrClose(act.enrollmentId, act.stepId);

    persistInBackground(act, () =>
      reportWhatsAppInvalid({
        enrollmentId: act.enrollmentId,
        cadenceId: act.cadenceId,
        stepId: act.stepId,
        leadId: act.lead.id,
        orgId: act.lead.org_id,
      }),
    );
  };

  const handleSkip = () => {
    if (!activity) return;
    const act = activity;

    toast.success('Atividade adiada em 2 horas');
    advanceOrClose(act.enrollmentId, act.stepId);

    const persist = isScheduled
      ? async () => {
          const { postponeScheduledActivity } = await import('../actions/complete-scheduled-activity');
          return postponeScheduledActivity(act.stepId);
        }
      : () => skipActivity(act.enrollmentId);

    persistInBackground(act, persist);
  };

  const hasPrev = selectedIndex > 0;
  const hasNext = selectedIndex >= 0 && selectedIndex < activities.length - 1;
  const prevActivity = hasPrev ? activities[selectedIndex - 1] : undefined;
  const nextActivity = hasNext ? activities[selectedIndex + 1] : undefined;

  // Keyboard shortcuts: ← → to navigate, Escape to close
  useEffect(() => {
    if (selectedIndex < 0) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when typing in inputs/textareas/editors
      const tag = (e.target as HTMLElement).tagName;
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable;
      if (isEditable) return;

      if (e.key === 'ArrowLeft' && prevActivity) {
        e.preventDefault();
        onNavigate(keyOf(prevActivity));
      } else if (e.key === 'ArrowRight' && nextActivity) {
        e.preventDefault();
        onNavigate(keyOf(nextActivity));
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex, prevActivity, nextActivity, onNavigate]);

  return (
    <Sheet open={selectedKey !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="sm:max-w-full w-full p-0 flex flex-col" showCloseButton={false}>
        <SheetTitle className="sr-only">Executar Atividade</SheetTitle>

        {/* Split layout — key forces remount when activity changes */}
        {activity && (
          <div className="flex flex-1 overflow-hidden">
            {/* Left — Lead Context with tabs (refreshKey triggers timeline refetch silently on activity change) */}
            <div className="w-[400px] shrink-0 border-r border-[var(--border)] overflow-y-auto p-4">
              <ActivityLeadContext
                lead={activity.lead}
                cadenceName={activity.cadenceName}
                stepOrder={activity.stepOrder}
                totalSteps={activity.totalSteps}
                refreshKey={activity.stepId}
              />
            </div>

            {/* Right — Activity panel (adapts by type) */}
            <div className="relative flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-14">
              {/* Top controls — prev/next stay centered, close pinned right.
                  Laid out as one flex row with equal spacers so the X can never
                  overlap the next arrow when the panel gets narrow. */}
              <div className="absolute top-3 inset-x-3 z-10 flex items-center gap-2">
                <div className="flex-1" />
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={!prevActivity}
                    onClick={() => prevActivity && onNavigate(keyOf(prevActivity))}
                    title="Anterior (←)"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm tabular-nums text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                    {selectedIndex >= 0 ? selectedIndex + 1 : 0} de {activities.length}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={!nextActivity}
                    onClick={() => nextActivity && onNavigate(keyOf(nextActivity))}
                    title="Próxima (→)"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-1 justify-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={onClose}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {quickMode && (
                <div className="absolute top-3 left-4 z-10 flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-900/30 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                  <Zap className="h-3 w-3" />
                  Modo rápido
                </div>
              )}

              <ActivityExecutionSheetContent
                key={`${activity.enrollmentId}:${activity.stepId}`}
                activity={activity}
                isSending={false}
                onSend={handleSend}
                onSkip={handleSkip}
                onMarkDone={handleMarkDone}
                onLeadLost={onLeadLost ? () => onLeadLost(activity) : undefined}
                onReportWhatsAppInvalid={handleReportWhatsAppInvalid}
                onCallResolved={handleCallResolved}
                dialerProvider={dialerProvider}
                quickMode={quickMode}
              />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
