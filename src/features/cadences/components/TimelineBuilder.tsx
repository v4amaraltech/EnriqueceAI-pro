'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';

import type { CadenceDetail, CadenceStepWithTemplate } from '../cadences.contract';
import type { ChannelType } from '../types';
import { activateCadence } from '../actions/manage-cadences';
import { saveTimelineSteps, type TimelineStepInput } from '../actions/save-timeline-steps';
import { ActivityTypeSidebar, channelConfig } from './ActivityTypeSidebar';
import { CadenceTimeline, type DayData } from './CadenceTimeline';
import { groupStepsByDay, relativeDelaysForDays } from '../utils/timeline-days';

interface TimelineBuilderProps {
  cadence: CadenceDetail;
}

// Convert existing steps (from DB) to DayData structure
function stepsTodays(steps: CadenceStepWithTemplate[]): DayData[] {
  // delay_days é atraso relativo ao passo anterior; o "Dia N" é o acumulado.
  const ordered = [...steps].sort((a, b) => a.step_order - b.step_order);
  const groups = groupStepsByDay(ordered);

  if (groups.length === 0) {
    return [{ day: 1, steps: [] }];
  }

  return groups.map(({ day, steps: daySteps }) => ({
    day,
    steps: daySteps.map((step) => {
      const config = channelConfig[step.channel as ChannelType];
      return {
        id: step.id,
        channel: step.channel as ChannelType,
        label: config?.label ?? step.channel,
        templateId: step.template_id,
        aiPersonalization: step.ai_personalization,
      };
    }),
  }));
}

// Convert DayData back to flat step inputs for saving.
// O `id` viaja junto para o passo existente ser atualizado no lugar (ID preservado).
function daysToStepInputs(days: DayData[]): TimelineStepInput[] {
  const inputs: TimelineStepInput[] = [];
  let globalOrder = 1;

  const delays = relativeDelaysForDays(days.map((d) => ({ day: d.day, stepCount: d.steps.length })));

  days.forEach((day, dayIndex) => {
    day.steps.forEach((step, stepIndex) => {
      inputs.push({
        id: step.id,
        channel: step.channel,
        delay_days: delays[dayIndex]![stepIndex]!,
        step_order: globalOrder,
        template_id: step.templateId,
        ai_personalization: step.aiPersonalization,
      });
      globalOrder++;
    });
  });

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
