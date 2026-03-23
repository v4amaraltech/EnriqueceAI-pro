'use client';

import { useTransition, useState } from 'react';
import { toast } from 'sonner';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import type { ChannelType } from '@/features/cadences/types';
import { createActivityTemplate, updateActivityTemplate } from '../actions/manage-activity-templates';
import type { ActivityTemplateRow } from '../types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: ChannelType;
  isSocialPoint: boolean;
  template?: ActivityTemplateRow;
  onSaved: (template: ActivityTemplateRow) => void;
}

export function ActivityTemplateDialog(props: Props) {
  if (!props.open) return null;

  // Key forces remount when switching between create/edit
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <ActivityTemplateDialogContent key={props.template?.id ?? 'new'} {...props} />
    </Dialog>
  );
}

function ActivityTemplateDialogContent({
  onOpenChange,
  channel,
  isSocialPoint,
  template,
  onSaved,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(template?.name ?? '');
  const [instructions, setInstructions] = useState(template?.instructions ?? '');
  const [socialChannel, setSocialChannel] = useState<'linkedin' | 'whatsapp'>(
    template?.channel === 'linkedin' || template?.channel === 'whatsapp'
      ? template.channel
      : 'linkedin',
  );

  const isEdit = !!template;

  function handleSubmit() {
    const resolvedChannel = isSocialPoint ? socialChannel : channel;

    startTransition(async () => {
      if (isEdit) {
        const result = await updateActivityTemplate(template.id, { name, instructions });
        if (result.success) {
          toast.success('Template atualizado');
          onSaved(result.data);
          onOpenChange(false);
        } else {
          toast.error(result.error);
        }
      } else {
        const result = await createActivityTemplate({ name, channel: resolvedChannel, instructions });
        if (result.success) {
          toast.success('Template criado');
          onSaved(result.data);
          onOpenChange(false);
        } else {
          toast.error(result.error);
        }
      }
    });
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Editar template' : 'Novo template'}</DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-4 py-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="at-name">Nome</Label>
          <Input
            id="at-name"
            placeholder="Ex: Ligação de follow-up"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {isSocialPoint && !isEdit && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="at-channel">Canal</Label>
            <Select value={socialChannel} onValueChange={(v) => setSocialChannel(v as 'linkedin' | 'whatsapp')}>
              <SelectTrigger id="at-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="linkedin">LinkedIn</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="at-instructions">Instruções</Label>
          <Textarea
            id="at-instructions"
            placeholder="Descreva o que o SDR deve fazer nesta atividade..."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={8}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
          Cancelar
        </Button>
        <Button onClick={handleSubmit} disabled={isPending || !name.trim()}>
          {isPending ? 'Salvando...' : isEdit ? 'Salvar' : 'Criar'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
