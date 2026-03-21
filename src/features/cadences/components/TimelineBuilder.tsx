'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';

import type { CadenceDetail, CadenceStepWithTemplate } from '../cadences.contract';
import type { ChannelType } from '../types';
import { activateCadence } from '../actions/manage-cadences';
import { saveTimelineSteps } from '../actions/save-timeline-steps';
import { ActivityTypeSidebar, channelConfig } from './ActivityTypeSidebar';
import { CadenceTimeline, type DayData, type TimelineStep } from './CadenceTimeline';

interface TimelineBuilderProps {
  cadence: CadenceDetail;
}

// Convert existing steps (from DB) to DayData structure
function stepsTodays(steps: CadenceStepWithTemplate[]): DayData[] {
  const dayMap = new Map<number, TimelineStep[]>();

  for (const step of steps) {
    const dayNum = step.delay_days + 1; // delay_days=0 → Dia 1
    if (!dayMap.has(dayNum)) {
      dayMap.set(dayNum, []);
    }
    const config = channelConfig[step.channel as ChannelType];
    dayMap.get(dayNum)!.push({
      id: step.id,
      channel: step.channel as ChannelType,
      label: config?.label ?? step.channel,
      templateId: step.template_id,
      aiPersonalization: step.ai_personalization,
    });
  }

  // Sort by day number and order steps by step_order
  const sortedDays = [...dayMap.entries()].sort((a, b) => a[0] - b[0]);

  // If no steps, start with Day 1
  if (sortedDays.length === 0) {
    return [{ day: 1, steps: [] }];
  }

  return sortedDays.map(([day, daySteps]) => ({
    day,
    steps: daySteps,
  }));
}

// Convert DayData back to flat step inputs for saving
function daysToStepInputs(days: DayData[]) {
  const inputs: { channel: ChannelType; delay_days: number; step_order: number; template_id?: string | null; ai_personalization?: boolean }[] = [];
  let globalOrder = 1;

  for (const day of days) {
    const delayDays = day.day - 1; // Dia 1 → delay_days=0
    for (const step of day.steps) {
      inputs.push({
        channel: step.channel,
        delay_days: delayDays,
        step_order: globalOrder,
        template_id: step.templateId,
        ai_personalization: step.aiPersonalization,
      });
      globalOrder++;
    }
  }

  return inputs;
}

export function TimelineBuilder({ cadence }: TimelineBuilderProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [days, setDays] = useState<DayData[]>(() => stepsTodays(cadence.steps));

  const totalSteps = days.reduce((sum, d) => sum + d.steps.length, 0);
  const isEditable = cadence.status === 'draft' || cadence.status === 'paused';

  function handleSave() {
    startTransition(async () => {
      const stepInputs = daysToStepInputs(days);
      const result = await saveTimelineSteps(cadence.id, stepInputs);
      if (result.success) {
        toast.success(`${result.data.saved} passos salvos`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleActivate() {
    startTransition(async () => {
      const stepInputs = daysToStepInputs(days);
      const saveResult = await saveTimelineSteps(cadence.id, stepInputs);
      if (!saveResult.success) {
        toast.error(saveResult.error);
        return;
      }
      const activateResult = await activateCadence(cadence.id);
      if (activateResult.success) {
        toast.success('Cadência ativada com sucesso!');
        router.push(`/cadences/${cadence.id}`);
      } else {
        toast.error(activateResult.error);
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Main area: Sidebar + Timeline (both inside DndContext) */}
      <div className="flex flex-1 gap-6 overflow-auto p-6">
        <CadenceTimeline
          days={days}
          onDaysChange={setDays}
          sidebarSlot={isEditable ? <ActivityTypeSidebar /> : undefined}
        />
      </div>

      {/* Bottom Bar */}
      <div className="flex items-center justify-between border-t bg-[var(--card)] px-6 py-3">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/cadences/${cadence.id}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <div>
            <p className="text-sm font-medium">{cadence.name}</p>
            <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              {totalSteps} {totalSteps === 1 ? 'passo' : 'passos'} em {days.length} {days.length === 1 ? 'dia' : 'dias'}
            </p>
          </div>
        </div>
        {isEditable && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleSave} disabled={isPending}>
              <Save className="mr-2 h-4 w-4" />
              {isPending ? 'Salvando...' : 'Salvar Passos'}
            </Button>
            {cadence.status === 'draft' && totalSteps >= 2 && (
              <Button onClick={handleActivate} disabled={isPending}>
                <Zap className="mr-2 h-4 w-4" />
                {isPending ? 'Ativando...' : 'Salvar e Ativar'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
