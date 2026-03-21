'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ArrowLeft, ChevronDown, Save, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { Textarea } from '@/shared/components/ui/textarea';

import type { CadenceDetail, CadenceMetrics, CadenceStepWithTemplate, EnrollmentWithLead } from '../cadences.contract';
import type { CadenceOrigin, CadencePriority, ChannelType, MessageTemplateRow } from '../types';
import type { LossReasonOption } from '../actions/fetch-loss-reasons';
import { activateCadence, updateCadence } from '../actions/manage-cadences';
import { createCadence } from '../actions/manage-cadences';
import { saveTimelineSteps } from '../actions/save-timeline-steps';
import { ActivityTypeSidebar, channelConfig } from './ActivityTypeSidebar';
import { CadenceTimeline, type DayData, type TimelineStep } from './CadenceTimeline';
import { EnrollmentsList } from './EnrollmentsList';
import { StepEditorDialog } from './StepEditorDialog';

interface CadenceBuilderProps {
  cadence?: CadenceDetail;
  templates: MessageTemplateRow[];
  metrics?: CadenceMetrics;
  enrollments?: EnrollmentWithLead[];
  lossReasons?: LossReasonOption[];
}

// Convert existing steps (from DB) to DayData structure
function stepsToDays(steps: CadenceStepWithTemplate[]): DayData[] {
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
      activityName: step.activity_name,
      instructions: step.instructions,
    });
  }

  const sortedDays = [...dayMap.entries()].sort((a, b) => a[0] - b[0]);

  if (sortedDays.length === 0) {
    return [{ day: 1, steps: [] }];
  }

  return sortedDays.map(([day, daySteps]) => ({ day, steps: daySteps }));
}

// Convert DayData back to flat step inputs for saving
function daysToStepInputs(days: DayData[]) {
  const inputs: { channel: ChannelType; delay_days: number; step_order: number; template_id?: string | null; ai_personalization?: boolean; activity_name?: string | null; instructions?: string | null }[] = [];
  let globalOrder = 1;

  for (const day of days) {
    const delayDays = day.day - 1;
    for (const step of day.steps) {
      inputs.push({
        channel: step.channel,
        delay_days: delayDays,
        step_order: globalOrder,
        template_id: step.templateId,
        ai_personalization: step.aiPersonalization,
        activity_name: step.activityName,
        instructions: step.instructions,
      });
      globalOrder++;
    }
  }

  return inputs;
}

export function CadenceBuilder({ cadence, templates: _templates, metrics, enrollments = [], lossReasons = [] }: CadenceBuilderProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(cadence?.name ?? '');
  const [description, setDescription] = useState(cadence?.description ?? '');
  const [priority, setPriority] = useState<CadencePriority>(cadence?.priority ?? 'medium');
  const [origin, setOrigin] = useState<CadenceOrigin>(cadence?.origin ?? 'outbound');
  const [autoLossEnabled, setAutoLossEnabled] = useState(cadence?.auto_loss_after_days != null);
  const [autoLossAfterDays, setAutoLossAfterDays] = useState(cadence?.auto_loss_after_days ?? 30);
  const [autoLossReasonId, setAutoLossReasonId] = useState(cadence?.auto_loss_reason_id ?? '');
  const [generalCollapsed, setGeneralCollapsed] = useState(false);
  const [days, setDays] = useState<DayData[]>(() => stepsToDays(cadence?.steps ?? []));
  const [editingStep, setEditingStep] = useState<TimelineStep | null>(null);
  const [stepEditorOpen, setStepEditorOpen] = useState(false);

  const isEditing = !!cadence;
  const isEditable = !cadence || cadence.status === 'draft' || cadence.status === 'paused';
  const totalSteps = days.reduce((sum, d) => sum + d.steps.length, 0);

  function handleSave() {
    startTransition(async () => {
      const metadata = {
        name,
        description: description || null,
        priority,
        origin,
        auto_loss_after_days: autoLossEnabled ? autoLossAfterDays : null,
        auto_loss_reason_id: autoLossEnabled && autoLossReasonId ? autoLossReasonId : null,
      };

      if (isEditing) {
        const result = await updateCadence(cadence.id, metadata);
        if (!result.success) {
          toast.error(result.error);
          return;
        }

        // Save timeline steps
        const stepInputs = daysToStepInputs(days);
        const stepsResult = await saveTimelineSteps(cadence.id, stepInputs);
        if (stepsResult.success) {
          toast.success('Cadência atualizada');
          router.refresh();
        } else {
          toast.error(stepsResult.error);
        }
      } else {
        const result = await createCadence(metadata);
        if (result.success) {
          toast.success('Cadência criada');
          router.push(`/cadences/${result.data.id}`);
        } else {
          toast.error(result.error);
        }
      }
    });
  }

  function handleActivate() {
    if (!cadence) return;
    startTransition(async () => {
      // Save steps first
      const stepInputs = daysToStepInputs(days);
      const saveResult = await saveTimelineSteps(cadence.id, stepInputs);
      if (!saveResult.success) {
        toast.error(saveResult.error);
        return;
      }
      const result = await activateCadence(cadence.id);
      if (result.success) {
        toast.success('Cadência ativada');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleStepClick(step: TimelineStep) {
    setEditingStep(step);
    setStepEditorOpen(true);
  }

  function handleStepEditorSave(stepId: string, activityName: string | null, instructions: string | null) {
    setDays((prev) =>
      prev.map((d) => ({
        ...d,
        steps: d.steps.map((s) =>
          s.id === stepId ? { ...s, activityName, instructions } : s,
        ),
      })),
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push('/cadences')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <h1 className="text-2xl font-bold">
          {isEditing ? cadence.name : 'Nova Cadência'}
        </h1>
        {cadence && (
          <Badge variant="outline">
            {cadence.status === 'draft' ? 'Rascunho' : cadence.status === 'active' ? 'Ativa' : cadence.status === 'paused' ? 'Pausada' : 'Arquivada'}
          </Badge>
        )}
      </div>

      {/* Cadence info — table-style horizontal rows */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => setGeneralCollapsed(!generalCollapsed)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Geral</CardTitle>
            <ChevronDown className={cn('h-5 w-5 text-[var(--muted-foreground)] dark:text-[var(--foreground)] transition-transform', generalCollapsed && '-rotate-90')} />
          </div>
        </CardHeader>
        {!generalCollapsed && <CardContent className="space-y-0 divide-y">
          {/* Nome */}
          <div className="grid grid-cols-[180px_1fr] items-center gap-4 py-4 first:pt-0">
            <Label htmlFor="cadence-name" className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Nome:</Label>
            <Input
              id="cadence-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Follow Up Inicial"
              disabled={!isEditable}
            />
          </div>

          {/* Descrição */}
          <div className="grid grid-cols-[180px_1fr] items-start gap-4 py-4">
            <Label htmlFor="cadence-desc" className="pt-2 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Descrição:</Label>
            <Textarea
              id="cadence-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva o objetivo desta cadência..."
              rows={3}
              disabled={!isEditable}
            />
          </div>

          {/* Foco / Origem */}
          <div className="grid grid-cols-[180px_1fr] items-center gap-4 py-4">
            <Label className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Foco:</Label>
            <div className="flex flex-wrap gap-1">
              {([
                { value: 'inbound_active', label: 'Inbound ativo' },
                { value: 'inbound_passive', label: 'Inbound passivo' },
                { value: 'outbound', label: 'Outbound' },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!isEditable}
                  onClick={() => setOrigin(opt.value)}
                  className={cn(
                    'rounded-md border px-4 py-1.5 text-sm transition-colors',
                    origin === opt.value
                      ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                      : 'border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:bg-[var(--muted)]',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Prioridade */}
          <div className="grid grid-cols-[180px_1fr] items-center gap-4 py-4">
            <Label className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Prioridade:</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as CadencePriority)} disabled={!isEditable}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="medium">Média</SelectItem>
                <SelectItem value="low">Baixa</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Perda Automática por Inatividade */}
          <div className="py-4">
            <div className="grid grid-cols-[180px_1fr] items-center gap-4">
              <Label className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Perda automática por inatividade
              </Label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoLossEnabled}
                  onClick={() => setAutoLossEnabled(!autoLossEnabled)}
                  disabled={!isEditable}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${autoLossEnabled ? 'bg-[var(--primary)]' : 'bg-[var(--muted)]'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${autoLossEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <span className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  {autoLossEnabled ? 'Ativado' : 'Desativado'}
                </span>
              </div>
            </div>
            {autoLossEnabled && (
              <div className="mt-4 space-y-4 pl-[196px]">
                <div className="grid grid-cols-[180px_1fr] items-center gap-4">
                  <Label className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Dias de inatividade:</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={autoLossAfterDays}
                    onChange={(e) => setAutoLossAfterDays(parseInt(e.target.value) || 30)}
                    disabled={!isEditable}
                    className="w-[200px]"
                  />
                </div>
                <div className="grid grid-cols-[180px_1fr] items-center gap-4">
                  <Label className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Motivo de perda:</Label>
                  <Select value={autoLossReasonId} onValueChange={setAutoLossReasonId} disabled={!isEditable}>
                    <SelectTrigger className="w-[300px]">
                      <SelectValue placeholder="Selecione um motivo" />
                    </SelectTrigger>
                    <SelectContent>
                      {lossReasons.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            {isEditable && (
              <Button onClick={handleSave} disabled={isPending || !name}>
                <Save className="mr-2 h-4 w-4" />
                {isPending ? 'Salvando...' : isEditing ? 'Salvar' : 'Criar Cadência'}
              </Button>
            )}
            {cadence && cadence.status === 'draft' && totalSteps >= 2 && (
              <Button variant="outline" onClick={handleActivate} disabled={isPending}>
                <Zap className="mr-2 h-4 w-4" />
                Ativar
              </Button>
            )}
          </div>
        </CardContent>}
      </Card>

      {/* Timeline & Enrollments */}
      {isEditing && cadence.status === 'active' ? (
        <Tabs defaultValue="steps">
          <TabsList>
            <TabsTrigger value="steps">Passos ({totalSteps})</TabsTrigger>
            <TabsTrigger value="enrollments">Inscritos ({enrollments.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="steps">
            <div className="flex gap-6 overflow-auto">
              <CadenceTimeline days={days} onDaysChange={setDays} onStepClick={handleStepClick} />
            </div>
          </TabsContent>
          <TabsContent value="enrollments">
            <Card>
              <CardContent className="pt-6">
                <EnrollmentsList enrollments={enrollments} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : isEditing ? (
        <div className="flex gap-6 overflow-auto">
          <CadenceTimeline
            days={days}
            onDaysChange={setDays}
            sidebarSlot={isEditable ? <ActivityTypeSidebar /> : undefined}
            onStepClick={handleStepClick}
          />
        </div>
      ) : null}

      <StepEditorDialog
        open={stepEditorOpen}
        onOpenChange={setStepEditorOpen}
        step={editingStep}
        onSave={handleStepEditorSave}
      />

      {/* Metrics */}
      {metrics && metrics.total_enrolled > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Métricas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics.total_enrolled}</p>
                <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Inscritos</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics.in_progress}</p>
                <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Em progresso</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics.completed}</p>
                <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Completados</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics.replied}</p>
                <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Responderam</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics.bounced}</p>
                <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Bounce</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
