'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ArrowDown, ArrowLeft, ChevronDown, Mail, Pencil, Play, Plus, Save, Timer } from 'lucide-react';
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
import { Textarea } from '@/shared/components/ui/textarea';


import type { CadenceDetail, CadenceMetrics } from '../cadences.contract';
import type { AutoEmailStep } from '../cadence.schemas';
import type { CadenceOrigin, CadencePriority } from '../types';
import type { LossReasonOption } from '../actions/fetch-loss-reasons';
import { activateCadence, createCadence, updateCadence } from '../actions/manage-cadences';
import { saveAutoEmailSteps } from '../actions/save-auto-email-steps';
import { AutoEmailStepEditor } from './AutoEmailStepEditor';

interface AutoEmailBuilderProps {
  cadence?: CadenceDetail;
  metrics?: CadenceMetrics;
  lossReasons?: LossReasonOption[];
}

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: 'Rascunho', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  active: { label: 'Ativa', className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  paused: { label: 'Pausada', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' },
  archived: { label: 'Arquivada', className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
};

function buildInitialSteps(cadence?: CadenceDetail): AutoEmailStep[] {
  if (!cadence?.steps.length) {
    return [{ subject: '', body: '', delay_days: 0, delay_hours: 0, ai_personalization: false, reply_type: 'new_conversation' as const, ab_enabled: false, ab_distribution: 50, subject_b: '', body_b: '' }];
  }
  return cadence.steps.map((s) => ({
    subject: s.template?.subject ?? '',
    body: s.template?.body ?? '',
    delay_days: s.delay_days,
    delay_hours: s.delay_hours,
    ai_personalization: s.ai_personalization,
    reply_type: s.reply_type ?? ('new_conversation' as const),
    ab_enabled: s.ab_enabled,
    ab_distribution: s.ab_distribution,
    subject_b: s.template_b?.subject ?? '',
    body_b: s.template_b?.body ?? '',
  }));
}

function getDelayLabel(step: AutoEmailStep, isFirst: boolean): string {
  if (isFirst || (step.delay_days === 0 && step.delay_hours === 0)) return 'Enviar email imediatamente';
  const parts: string[] = [];
  if (step.delay_days > 0) parts.push(`${step.delay_days} dia${step.delay_days !== 1 ? 's' : ''}`);
  if (step.delay_hours > 0) parts.push(`${step.delay_hours} hora${step.delay_hours !== 1 ? 's' : ''}`);
  return `Enviar e-mail em ${parts.join(' e ')}`;
}

export function AutoEmailBuilder({ cadence, metrics, lossReasons = [] }: AutoEmailBuilderProps) {
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
  const [steps, setSteps] = useState<AutoEmailStep[]>(buildInitialSteps(cadence));
  const [editingDelayIndex, setEditingDelayIndex] = useState<number | null>(null);

  const isEditing = !!cadence;
  const isEditable = !cadence || cadence.status === 'draft' || cadence.status === 'paused';
  const statusCfg = cadence ? statusConfig[cadence.status] : null;

  function updateStep(index: number, updated: AutoEmailStep) {
    setSteps((prev) => prev.map((s, i) => (i === index ? updated : s)));
  }

  function removeStep(index: number) {
    if (steps.length <= 1) {
      toast.error('A cadência precisa ter pelo menos 1 step');
      return;
    }
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function addStep() {
    setSteps((prev) => [
      ...prev,
      { subject: '', body: '', delay_days: 2, delay_hours: 0, ai_personalization: false, reply_type: 'new_conversation' as const, ab_enabled: false, ab_distribution: 50, subject_b: '', body_b: '' },
    ]);
  }

  function handleSave() {
    if (!name.trim()) {
      toast.error('Nome da cadência é obrigatório');
      return;
    }

    // Validate steps
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      if (s.reply_type !== 'reply' && !s.subject.trim()) {
        toast.error(`Step ${i + 1}: Assunto é obrigatório`);
        return;
      }
      if (!s.body.trim()) {
        toast.error(`Step ${i + 1}: Corpo do email é obrigatório`);
        return;
      }
      if (s.ab_enabled) {
        if (s.reply_type !== 'reply' && !(s.subject_b ?? '').trim()) {
          toast.error(`Step ${i + 1}: Assunto da Variante B é obrigatório`);
          return;
        }
        if (!(s.body_b ?? '').trim()) {
          toast.error(`Step ${i + 1}: Corpo da Variante B é obrigatório`);
          return;
        }
      }
    }

    startTransition(async () => {
      let cadenceId = cadence?.id;

      const metadata = {
        name,
        description: description || null,
        priority,
        origin,
        auto_loss_after_days: autoLossEnabled ? autoLossAfterDays : null,
        auto_loss_reason_id: autoLossEnabled && autoLossReasonId ? autoLossReasonId : null,
      };

      if (!isEditing) {
        // Create cadence first
        const createResult = await createCadence({
          ...metadata,
          type: 'auto_email',
        });
        if (!createResult.success) {
          toast.error(createResult.error);
          return;
        }
        cadenceId = createResult.data.id;
      } else {
        // Update cadence metadata
        const updateResult = await updateCadence(cadence.id, metadata);
        if (!updateResult.success) {
          toast.error(updateResult.error);
          return;
        }
      }

      // Save steps
      const saveResult = await saveAutoEmailSteps({
        cadence_id: cadenceId!,
        steps,
      });

      if (!saveResult.success) {
        toast.error(saveResult.error);
        return;
      }

      toast.success(isEditing ? 'Cadência atualizada' : 'Cadência criada');
      if (!isEditing) {
        router.push(`/cadences/${cadenceId}`);
      } else {
        router.refresh();
      }
    });
  }

  function handleActivate() {
    if (!cadence) return;
    if (steps.length < 2) {
      toast.error('Cadência precisa de no mínimo 2 steps para ser ativada');
      return;
    }
    startTransition(async () => {
      const result = await activateCadence(cadence.id);
      if (result.success) {
        toast.success('Cadência ativada');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push('/cadences?type=auto_email')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-red-500" />
          <h1 className="text-2xl font-bold">
            {isEditing ? 'Editar E-mail Automático' : 'Novo E-mail Automático'}
          </h1>
        </div>
        {statusCfg && (
          <Badge variant="outline" className={statusCfg.className}>
            {statusCfg.label}
          </Badge>
        )}
      </div>

      {/* Configuração — table-style horizontal rows */}
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
              placeholder="Ex: Prospecção Outbound Q1"
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

          {/* Metrics inline (edit mode only) */}
          {metrics && (
            <div className="flex items-center gap-6 py-4 text-sm">
              <div>
                <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Inscritos</span>
                <p className="text-lg font-semibold">{metrics.total_enrolled}</p>
              </div>
              <div>
                <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Em progresso</span>
                <p className="text-lg font-semibold">{metrics.in_progress}</p>
              </div>
              <div>
                <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Responderam</span>
                <p className="text-lg font-semibold text-green-600">{metrics.replied}</p>
              </div>
              <div>
                <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Completaram</span>
                <p className="text-lg font-semibold">{metrics.completed}</p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-4">
            {isEditable && (
              <Button onClick={handleSave} disabled={isPending}>
                <Save className="mr-2 h-4 w-4" />
                {isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            )}
            {isEditing && cadence.status === 'draft' && (
              <Button variant="outline" onClick={handleActivate} disabled={isPending}>
                <Play className="mr-2 h-4 w-4" />
                Ativar Cadência
              </Button>
            )}
          </div>
        </CardContent>}
      </Card>

      {/* Steps — full width */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Sequência de Emails ({steps.length} step{steps.length !== 1 ? 's' : ''})
          </h2>
        </div>

        <div className="flex flex-col items-center">
          {steps.map((step, index) => (
            <div key={index} className="w-full">
              {/* Timing pill above step */}
              <div className="flex flex-col items-center">
                {/* Connector from previous step */}
                {index > 0 && (
                  <>
                    <div className="h-2 w-2 rounded-full border-2 border-[var(--muted-foreground)]/40 bg-[var(--background)]" />
                    <div className="h-5 w-px bg-[var(--border)]" />
                    <ArrowDown className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]/60" />
                    <div className="h-2" />
                  </>
                )}

                {/* Timing pill */}
                <button
                  type="button"
                  onClick={() => {
                    if (index > 0) setEditingDelayIndex(editingDelayIndex === index ? null : index);
                  }}
                  className={cn(
                    'mb-3 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition-colors',
                    index > 0
                      ? 'cursor-pointer border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)] hover:border-[var(--primary)]/40 hover:bg-[var(--accent)]'
                      : 'cursor-default border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)] dark:text-[var(--foreground)]',
                  )}
                >
                  <Timer className="h-4 w-4" />
                  <span>{getDelayLabel(step, index === 0)}</span>
                  {index > 0 && <Pencil className="h-3 w-3 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />}
                </button>

                {/* Inline delay editor */}
                {editingDelayIndex === index && (
                  <div className="mb-3 flex items-center gap-3 rounded-lg border bg-[var(--background)] px-4 py-3 shadow-sm">
                    <span className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Esperar</span>
                    <Input
                      type="number"
                      min={0}
                      value={step.delay_days}
                      onChange={(e) => updateStep(index, { ...step, delay_days: parseInt(e.target.value, 10) || 0 })}
                      className="w-16 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">dias</span>
                    <Input
                      type="number"
                      min={0}
                      max={23}
                      value={step.delay_hours}
                      onChange={(e) => updateStep(index, { ...step, delay_hours: parseInt(e.target.value, 10) || 0 })}
                      className="w-16 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">horas</span>
                  </div>
                )}
              </div>

              {/* Step editor card */}
              <AutoEmailStepEditor
                step={step}
                stepNumber={index + 1}
                isFirst={index === 0}
                hideDelay
                onChange={(updated) => updateStep(index, updated)}
                onRemove={() => removeStep(index)}
                cadenceId={cadence?.id}
                stepId={cadence?.steps[index]?.id}
              />
            </div>
          ))}
        </div>

        {isEditable && (
          <Button variant="outline" className="mt-4 w-full" onClick={addStep}>
            <Plus className="mr-2 h-4 w-4" />
            Adicionar Step
          </Button>
        )}
      </div>
    </div>
  );
}
