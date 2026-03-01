'use client';

import { useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';

import type { ChannelType } from '../types';
import { channelConfig } from './ActivityTypeSidebar';
import type { TimelineStep } from './CadenceTimeline';

const channelInstructions: Record<ChannelType, { label: string; placeholder: string }> = {
  email: {
    label: 'Instruções / Roteiro',
    placeholder: 'Descreva como abordar o lead neste e-mail...',
  },
  phone: {
    label: 'Roteiro da Ligação',
    placeholder: 'Script: 1. Apresentação 2. Contexto 3. Proposta...',
  },
  whatsapp: {
    label: 'Mensagem / Instruções',
    placeholder: 'Mensagem modelo ou instruções de abordagem...',
  },
  linkedin: {
    label: 'Instruções de Abordagem',
    placeholder: 'Como abordar: 1. Enviar convite 2. Mensagem de apresentação...',
  },
  research: {
    label: 'O que pesquisar',
    placeholder: 'Itens: Site da empresa, LinkedIn do contato, notícias recentes...',
  },
};

interface StepEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: TimelineStep | null;
  onSave: (stepId: string, activityName: string | null, instructions: string | null) => void;
}

function StepEditorForm({
  step,
  onSave,
  onCancel,
}: {
  step: TimelineStep;
  onSave: (stepId: string, activityName: string | null, instructions: string | null) => void;
  onCancel: () => void;
}) {
  const [activityName, setActivityName] = useState(step.activityName ?? '');
  const [instructions, setInstructions] = useState(step.instructions ?? '');

  const config = channelConfig[step.channel];
  const Icon = config.icon;
  const instrConfig = channelInstructions[step.channel];

  function handleSave() {
    onSave(
      step.id,
      activityName.trim() || null,
      instructions.trim() || null,
    );
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <div className={`flex h-6 w-6 items-center justify-center rounded ${config.bgColor}`}>
            <Icon className={`h-3.5 w-3.5 ${config.color}`} />
          </div>
          Editar atividade de {config.label}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label htmlFor="step-activity-name">Nome da Atividade</Label>
          <Input
            id="step-activity-name"
            value={activityName}
            onChange={(e) => setActivityName(e.target.value)}
            placeholder={config.label}
            maxLength={200}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="step-instructions">{instrConfig.label}</Label>
          <Textarea
            id="step-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={instrConfig.placeholder}
            rows={5}
            maxLength={5000}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button onClick={handleSave}>
          Salvar
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function StepEditorDialog({ open, onOpenChange, step, onSave }: StepEditorDialogProps) {
  if (!step) return null;

  function handleSave(stepId: string, activityName: string | null, instructions: string | null) {
    onSave(stepId, activityName, instructions);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <StepEditorForm
        key={step.id}
        step={step}
        onSave={handleSave}
        onCancel={() => onOpenChange(false)}
      />
    </Dialog>
  );
}
