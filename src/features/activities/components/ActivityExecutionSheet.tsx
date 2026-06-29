'use client';

import { useEffect, useTransition } from 'react';

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
  onLeadLost,
  dialerProvider,
  quickMode = false,
}: ActivityExecutionSheetProps) {
  const [isSending, startSendTransition] = useTransition();

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

  const isScheduled = activity?.enrollmentId.startsWith('scheduled:') ?? false;

  const handleSend = (subject: string, body: string, aiGenerated: boolean, phone?: string) => {
    if (!activity) return;

    const isWhatsApp = activity.channel === 'whatsapp';
    const resolvedEmail = (activity.lead.socios ?? [])
      .flatMap((s) => s.emails ?? [])
      .sort((a, b) => a.ranking - b.ranking)[0]?.email
      ?? activity.lead.email
      ?? '';
    const to = phone
      ?? (isWhatsApp
        ? (resolveWhatsAppPhone(activity.lead)?.formatted ?? '')
        : resolvedEmail);

    if (isScheduled) {
      startSendTransition(async () => {
        const result = await executeScheduledActivity({
          scheduledActivityId: activity.stepId,
          leadId: activity.lead.id,
          channel: activity.channel,
          to,
          subject,
          body,
          aiGenerated,
        });
        if (result.success) {
          toast.success(isWhatsApp ? 'WhatsApp enviado!' : 'Email enviado!', { icon: isWhatsApp ? '💬' : '📧' });
          advanceOrClose(activity.enrollmentId, activity.stepId);
        } else {
          toast.error(result.error);
        }
      });
      return;
    }

    if (!activity.cadenceCreatedBy) {
      toast.error('Cadência sem usuário criador — não é possível enviar');
      return;
    }

    startSendTransition(async () => {
      const result = await executeActivity({
        enrollmentId: activity.enrollmentId,
        cadenceId: activity.cadenceId,
        stepId: activity.stepId,
        leadId: activity.lead.id,
        orgId: activity.lead.org_id,
        cadenceCreatedBy: activity.cadenceCreatedBy!,
        channel: activity.channel,
        to,
        subject,
        body,
        aiGenerated,
        templateId: activity.templateId,
      });

      if (result.success) {
        toast.success(isWhatsApp ? 'WhatsApp enviado!' : 'Email enviado!', { icon: isWhatsApp ? '💬' : '📧' });
        advanceOrClose(activity.enrollmentId, activity.stepId);
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleMarkDone = (notes: string) => {
    if (!activity) return;

    startSendTransition(async () => {
      if (isScheduled) {
        const result = await executeScheduledActivity({
          scheduledActivityId: activity.stepId,
          leadId: activity.lead.id,
          channel: activity.channel,
          to: '',
          subject: '',
          body: notes,
          aiGenerated: false,
        });
        if (result.success) {
          toast.success('Atividade concluída!', { icon: '✅' });
          advanceOrClose(activity.enrollmentId, activity.stepId);
        } else {
          toast.error(result.error);
        }
        return;
      }

      const result = await executeActivity({
        enrollmentId: activity.enrollmentId,
        cadenceId: activity.cadenceId,
        stepId: activity.stepId,
        leadId: activity.lead.id,
        orgId: activity.lead.org_id,
        cadenceCreatedBy: activity.cadenceCreatedBy ?? '',
        channel: activity.channel,
        to: '',
        subject: '',
        body: notes,
        aiGenerated: false,
        templateId: null,
      });

      if (result.success) {
        toast.success('Atividade concluída!', { icon: '✅' });
        advanceOrClose(activity.enrollmentId, activity.stepId);
      } else {
        toast.error(result.error);
      }
    });
  };

  // Ligação via WhatsApp: a disposition (7.6) já avançou/reagendou a cadência,
  // então aqui só seguimos para a próxima atividade / fechamos — SEM executeActivity.
  const handleCallResolved = () => {
    if (!activity) return;
    advanceOrClose(activity.enrollmentId, activity.stepId);
  };

  const handleReportWhatsAppInvalid = () => {
    if (!activity) return;
    if (isScheduled) {
      toast.error('Atividades agendadas não suportam essa ação ainda');
      return;
    }

    startSendTransition(async () => {
      const result = await reportWhatsAppInvalid({
        enrollmentId: activity.enrollmentId,
        cadenceId: activity.cadenceId,
        stepId: activity.stepId,
        leadId: activity.lead.id,
        orgId: activity.lead.org_id,
      });

      if (result.success) {
        toast.success('Lead marcado como sem WhatsApp', { icon: '🚫' });
        advanceOrClose(activity.enrollmentId, activity.stepId);
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleSkip = () => {
    if (!activity) return;

    if (isScheduled) {
      startSendTransition(async () => {
        const { postponeScheduledActivity } = await import('../actions/complete-scheduled-activity');
        const result = await postponeScheduledActivity(activity.stepId);
        if (result.success) {
          toast.success('Atividade adiada em 2 horas');
          advanceOrClose(activity.enrollmentId, activity.stepId);
        } else {
          toast.error(result.error);
        }
      });
      return;
    }

    startSendTransition(async () => {
      const result = await skipActivity(activity.enrollmentId);

      if (result.success) {
        toast.success('Atividade adiada em 2 horas');
        advanceOrClose(activity.enrollmentId, activity.stepId);
      } else {
        toast.error(result.error);
      }
    });
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
                isSending={isSending}
                onSend={handleSend}
                onSkip={handleSkip}
                onMarkDone={handleMarkDone}
                onLeadLost={onLeadLost ? () => onLeadLost(activity) : undefined}
                onReportWhatsAppInvalid={handleReportWhatsAppInvalid}
                onCallResolved={handleCallResolved}
                dialerProvider={dialerProvider}
              />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
