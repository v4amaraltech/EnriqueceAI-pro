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
    label: 'Instruções',
    placeholder: 'Descreva como abordar o lead neste e-mail. Ex: Esse e-mail é o e-mail de interesse. É o primeiro e-mail da cadência de 4 disparos.',
  },
  phone: {
    label: 'Roteiro da Ligação',
    placeholder: 'Script de abordagem:\n1. Apresentação — quem você é e por que está ligando\n2. Contexto — referência ao e-mail/interação anterior\n3. Proposta de valor — como pode ajudar\n4. Próximos passos — agendar reunião',
  },
  whatsapp: {
    label: 'Mensagem / Instruções',
    placeholder: 'Mensagem modelo ou instruções de abordagem via WhatsApp...',
  },
  linkedin: {
    label: 'Instruções de Abordagem',
    placeholder: 'Como abordar:\n1. Enviar convite com nota personalizada\n2. Mensagem de apresentação após aceite\n3. Follow-up com conteúdo relevante',
  },
  research: {
    label: 'O que pesquisar',
    placeholder: 'Itens a pesquisar:\n• Site da empresa\n• LinkedIn do contato\n• Notícias recentes\n• Concorrentes\n• Dores do segmento',
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
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3 text-lg">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${config.bgColor}`}>
            <Icon className={`h-5 w-5 ${config.color}`} />
          </div>
          Editar atividade de {config.label.toLowerCase()}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-6 py-2">
        {/* Dados Gerais section */}
        <div>
          <h3 className="text-sm font-semibold">Dados Gerais</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            Estas informações não são exibidas para seu cliente.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="step-activity-name" className="text-sm font-semibold">
            Nome da atividade:
          </Label>
          <Input
            id="step-activity-name"
            value={activityName}
            onChange={(e) => setActivityName(e.target.value)}
            placeholder={step.label || config.label}
            maxLength={200}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="step-instructions" className="text-sm font-semibold">
            {instrConfig.label}
          </Label>
          <Textarea
            id="step-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={instrConfig.placeholder}
            rows={8}
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
