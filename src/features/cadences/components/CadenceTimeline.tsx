'use client';

import { useCallback, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

import type { ChannelType } from '../types';
import { channelConfig } from './ActivityTypeSidebar';

// ── Types ────────────────────────────────────────────────────────────────

export interface TimelineStep {
  id: string;
  channel: ChannelType;
  label: string;
  templateId?: string | null;
  aiPersonalization?: boolean;
  activityName?: string | null;
  instructions?: string | null;
}

export interface DayData {
  day: number;
  steps: TimelineStep[];
}

interface CadenceTimelineProps {
  days: DayData[];
  onDaysChange: (days: DayData[]) => void;
  sidebarSlot?: React.ReactNode;
  onStepClick?: (step: TimelineStep) => void;
}

// ── Helper: renumber steps globally ──────────────────────────────────────

export function getGlobalStepNumber(days: DayData[], dayIndex: number, stepIndex: number): number {
  let count = 0;
  for (let d = 0; d < dayIndex; d++) {
    count += days[d]!.steps.length;
  }
  return count + stepIndex + 1;
}

// ── Sortable Step Item ───────────────────────────────────────────────────

function SortableStepItem({
  step,
  globalNumber,
  onRemove,
  onStepClick,
}: {
  step: TimelineStep;
  globalNumber: number;
  onRemove: () => void;
  onStepClick?: (step: TimelineStep) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id, data: { type: 'timeline-step' } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const config = channelConfig[step.channel];
  const Icon = config.icon;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-md border bg-[var(--card)] px-3 py-2 ${isDragging ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        className="cursor-grab text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-[var(--foreground)]"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${config.bgColor}`}>
        <span className={`text-xs font-bold ${config.color}`}>{globalNumber}</span>
      </div>
      <button
        type="button"
        onClick={() => onStepClick?.(step)}
        className="flex flex-1 items-center gap-2 cursor-pointer rounded px-1 py-0.5 hover:bg-[var(--muted)] transition-colors text-left"
      >
        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${config.bgColor}`}>
          <Icon className={`h-3.5 w-3.5 ${config.color}`} />
        </div>
        <span className="flex-1 text-sm">{step.activityName || step.label}</span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-red-500"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Day Container (Drop Zone) ────────────────────────────────────────────

function DayContainer({
  dayData,
  dayIndex,
  days,
  collapsed,
  onToggle,
  onRemoveStep,
  onDayNumberChange,
  onStepClick,
}: {
  dayData: DayData;
  dayIndex: number;
  days: DayData[];
  collapsed: boolean;
  onToggle: () => void;
  onRemoveStep: (stepId: string) => void;
  onDayNumberChange: (newDay: number) => void;
  onStepClick?: (step: TimelineStep) => void;
}) {
  const { setNodeRef } = useSortable({
    id: `day-${dayData.day}`,
    data: { type: 'day-container', dayIndex },
    disabled: true,
  });

  return (
    <div ref={setNodeRef} className="rounded-lg border" data-testid={`day-${dayData.day}`}>
      <div className="flex w-full items-center gap-2 rounded-t-lg bg-[var(--muted)] px-4 py-2.5 text-sm font-medium">
        <button type="button" onClick={onToggle} className="hover:text-[var(--foreground)]">
          {collapsed ? (
            <ChevronRight className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          )}
        </button>
        <span>Dia</span>
        <input
          type="number"
          min={1}
          value={dayData.day}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (v > 0) onDayNumberChange(v);
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-12 rounded border bg-[var(--background)] px-1.5 py-0.5 text-center text-sm font-medium [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          aria-label={`Número do dia ${dayData.day}`}
        />
        <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          ({dayData.steps.length} {dayData.steps.length === 1 ? 'atividade' : 'atividades'})
        </span>
      </div>
      {!collapsed && (
        <div className="min-h-[48px] space-y-2 p-3">
          <SortableContext
            items={dayData.steps.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            {dayData.steps.map((step, stepIndex) => (
              <SortableStepItem
                key={step.id}
                step={step}
                globalNumber={getGlobalStepNumber(days, dayIndex, stepIndex)}
                onRemove={() => onRemoveStep(step.id)}
                onStepClick={onStepClick}
              />
            ))}
          </SortableContext>
          {dayData.steps.length === 0 && (
            <p className="py-2 text-center text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Arraste uma atividade aqui
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Drag Overlay Content ─────────────────────────────────────────────────

function DragOverlayContent({ channel, label }: { channel: ChannelType; label: string }) {
  const config = channelConfig[channel];
  const Icon = config.icon;
  return (
    <div className="flex items-center gap-2 rounded-md border bg-[var(--card)] px-3 py-2 shadow-lg">
      <Icon className={`h-4 w-4 ${config.color}`} />
      <span className="text-sm">{label}</span>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────

let nextStepId = 1;
function generateStepId(): string {
  return `step-${Date.now()}-${nextStepId++}`;
}

export function CadenceTimeline({ days, onDaysChange, sidebarSlot, onStepClick }: CadenceTimelineProps) {
  const [collapsedDays, setCollapsedDays] = useState<Record<number, boolean>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDragData, setActiveDragData] = useState<{ channel: ChannelType; label: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function toggleDay(day: number) {
    setCollapsedDays((prev) => ({ ...prev, [day]: !prev[day] }));
  }

  function addDay() {
    const nextDay = days.length > 0 ? Math.max(...days.map((d) => d.day)) + 1 : 1;
    onDaysChange([...days, { day: nextDay, steps: [] }]);
  }

  function changeDayNumber(dayIndex: number, newDay: number) {
    // Prevent duplicate day numbers
    if (days.some((d, i) => i !== dayIndex && d.day === newDay)) return;
    const updated = [...days];
    updated[dayIndex] = { ...updated[dayIndex]!, day: newDay };
    updated.sort((a, b) => a.day - b.day);
    onDaysChange(updated);
  }

  function removeStep(stepId: string) {
    const updated = days.map((d) => ({
      ...d,
      steps: d.steps.filter((s) => s.id !== stepId),
    }));
    onDaysChange(updated);
  }

  // Find which day a step belongs to
  const findDayIndex = useCallback(
    (stepId: string): number => {
      return days.findIndex((d) => d.steps.some((s) => s.id === stepId));
    },
    [days],
  );

  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    setActiveId(active.id as string);

    const data = active.data.current;
    if (data?.type === 'activity-type') {
      setActiveDragData({ channel: data.channel as ChannelType, label: data.label as string });
    } else if (data?.type === 'timeline-step') {
      // Find the step in days
      for (const day of days) {
        const step = day.steps.find((s) => s.id === active.id);
        if (step) {
          setActiveDragData({ channel: step.channel, label: step.label });
          break;
        }
      }
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;

    // Only handle timeline-step reordering during dragOver (not new items from sidebar)
    if (activeData?.type !== 'timeline-step') return;

    const activeStepId = active.id as string;
    const overId = over.id as string;

    const activeDayIndex = findDayIndex(activeStepId);
    if (activeDayIndex === -1) return;

    // Determine target day
    let overDayIndex: number;
    if (overId.startsWith('day-')) {
      overDayIndex = days.findIndex((d) => `day-${d.day}` === overId);
    } else {
      overDayIndex = findDayIndex(overId);
    }
    if (overDayIndex === -1) return;

    // Cross-container move
    if (activeDayIndex !== overDayIndex) {
      const updated = [...days];
      const activeDay = { ...updated[activeDayIndex]!, steps: [...updated[activeDayIndex]!.steps] };
      const overDay = { ...updated[overDayIndex]!, steps: [...updated[overDayIndex]!.steps] };

      const activeStepIndex = activeDay.steps.findIndex((s) => s.id === activeStepId);
      const [movedStep] = activeDay.steps.splice(activeStepIndex, 1);

      // Find insertion index in target day
      const overStepIndex = overDay.steps.findIndex((s) => s.id === overId);
      const insertIndex = overStepIndex >= 0 ? overStepIndex : overDay.steps.length;
      overDay.steps.splice(insertIndex, 0, movedStep!);

      updated[activeDayIndex] = activeDay;
      updated[overDayIndex] = overDay;
      onDaysChange(updated);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    setActiveDragData(null);

    if (!over) return;

    const activeData = active.data.current;
    const overId = over.id as string;

    // Handle new item from sidebar dropped onto timeline
    if (activeData?.type === 'activity-type') {
      const channel = activeData.channel as ChannelType;
      const label = activeData.label as string;
      const newStep: TimelineStep = {
        id: generateStepId(),
        channel,
        label,
      };

      // Find target day
      let targetDayIndex: number;
      if (overId.startsWith('day-')) {
        targetDayIndex = days.findIndex((d) => `day-${d.day}` === overId);
      } else {
        targetDayIndex = findDayIndex(overId);
      }

      if (targetDayIndex === -1) {
        // If dropped on timeline area but not a specific day, add to last day or create day 1
        if (days.length === 0) {
          onDaysChange([{ day: 1, steps: [newStep] }]);
        } else {
          const updated = [...days];
          const lastDay = { ...updated[updated.length - 1]!, steps: [...updated[updated.length - 1]!.steps, newStep] };
          updated[updated.length - 1] = lastDay;
          onDaysChange(updated);
        }
        return;
      }

      const updated = [...days];
      const targetDay = { ...updated[targetDayIndex]!, steps: [...updated[targetDayIndex]!.steps] };

      // Insert at end of target day
      const overStepIndex = targetDay.steps.findIndex((s) => s.id === overId);
      const insertIndex = overStepIndex >= 0 ? overStepIndex + 1 : targetDay.steps.length;
      targetDay.steps.splice(insertIndex, 0, newStep);
      updated[targetDayIndex] = targetDay;
      onDaysChange(updated);
      return;
    }

    // Handle reorder within same day
    if (activeData?.type === 'timeline-step') {
      const activeStepId = active.id as string;
      const dayIndex = findDayIndex(activeStepId);
      if (dayIndex === -1) return;

      const overDayIndex = overId.startsWith('day-')
        ? days.findIndex((d) => `day-${d.day}` === overId)
        : findDayIndex(overId);

      if (overDayIndex === -1 || dayIndex !== overDayIndex) return;

      const daySteps = [...days[dayIndex]!.steps];
      const oldIndex = daySteps.findIndex((s) => s.id === activeStepId);
      const newIndex = daySteps.findIndex((s) => s.id === overId);

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const updated = [...days];
        updated[dayIndex] = {
          ...updated[dayIndex]!,
          steps: arrayMove(daySteps, oldIndex, newIndex),
        };
        onDaysChange(updated);
      }
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {sidebarSlot}
      <div className="flex-1 space-y-3" data-testid="cadence-timeline">
        {days.map((dayData, dayIndex) => (
          <DayContainer
            key={dayIndex}
            dayData={dayData}
            dayIndex={dayIndex}
            days={days}
            collapsed={collapsedDays[dayData.day] ?? false}
            onToggle={() => toggleDay(dayData.day)}
            onRemoveStep={removeStep}
            onDayNumberChange={(newDay) => changeDayNumber(dayIndex, newDay)}
            onStepClick={onStepClick}
          />
        ))}

        <Button variant="outline" size="sm" onClick={addDay} className="w-full">
          <Plus className="mr-2 h-4 w-4" />
          Adicionar Dia
        </Button>
      </div>

      <DragOverlay>
        {activeId && activeDragData ? (
          <DragOverlayContent channel={activeDragData.channel} label={activeDragData.label} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
