'use client';

import { useTransition, useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
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
import { Separator } from '@/shared/components/ui/separator';
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
import { TEMPLATE_VARIABLES, renderTemplatePreview } from '../constants/template-variables';
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isEdit = !!template;

  const insertVariable = useCallback((placeholder: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = instructions.slice(0, start);
    const after = instructions.slice(end);
    const newValue = before + placeholder + after;

    setInstructions(newValue);

    requestAnimationFrame(() => {
      const cursorPos = start + placeholder.length;
      textarea.focus();
      textarea.setSelectionRange(cursorPos, cursorPos);
    });
  }, [instructions]);

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

  const preview = instructions.trim() ? renderTemplatePreview(instructions) : '';

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Editar template' : 'Novo template'}</DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-6 py-2">
        {/* Informações básicas */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Informações básicas</h4>
          <div className={isSocialPoint && !isEdit ? 'grid grid-cols-2 gap-4' : ''}>
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
          </div>
        </div>

        <Separator />

        {/* Campos dinâmicos */}
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-medium">Campos dinâmicos</h4>
            <p className="text-muted-foreground text-xs mt-1">
              Clique ou arraste para inserir no texto de instruções.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground mr-1">Lead:</span>
              {TEMPLATE_VARIABLES.filter((v) => v.category === 'lead').map((v) => (
                <Badge
                  key={v.key}
                  variant="outline"
                  className="cursor-pointer select-none text-xs hover:bg-primary/10 hover:border-primary/30"
                  onClick={() => insertVariable(v.placeholder)}
                >
                  {v.label}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground mr-1">Vendedor:</span>
              {TEMPLATE_VARIABLES.filter((v) => v.category === 'vendedor').map((v) => (
                <Badge
                  key={v.key}
                  variant="outline"
                  className="cursor-pointer select-none text-xs hover:bg-primary/10 hover:border-primary/30"
                  onClick={() => insertVariable(v.placeholder)}
                >
                  {v.label}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <Separator />

        {/* Instruções */}
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-medium">Instruções</h4>
            <p className="text-muted-foreground text-xs mt-1">
              Descreva o que o SDR deve fazer nesta atividade.
            </p>
          </div>

          <Textarea
            ref={textareaRef}
            id="at-instructions"
            placeholder="Descreva o que o SDR deve fazer nesta atividade..."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={8}
            className="min-h-[160px]"
          />
        </div>

        {/* Preview */}
        {preview && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Preview</Label>
            <div className="bg-muted rounded-lg p-4 text-sm whitespace-pre-wrap">
              {highlightVariables(preview)}
            </div>
          </div>
        )}
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

function highlightVariables(text: string): React.ReactNode {
  const highlights: Array<{ key: string; value: string }> = [];
  let remaining = text;
  let keyIndex = 0;

  for (const v of TEMPLATE_VARIABLES) {
    const segments = remaining.split(v.sampleValue);
    if (segments.length <= 1) continue;

    remaining = '';
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg !== undefined) {
        remaining += seg;
      }
      if (i < segments.length - 1) {
        const key = `hl-${String(keyIndex)}`;
        remaining += `\x00${key}\x00`;
        highlights.push({ key, value: v.sampleValue });
        keyIndex++;
      }
    }
  }

  if (highlights.length === 0) return text;

  const finalParts: React.ReactNode[] = [];
  const pattern = new RegExp(`\x00(hl-\\d+)\x00`);
  const tokens = remaining.split(pattern);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) continue;

    if (i % 2 === 0) {
      if (token) finalParts.push(token);
    } else {
      const match = highlights.find((h) => h.key === token);
      if (match) {
        finalParts.push(
          <span key={match.key} className="font-semibold text-primary">
            {match.value}
          </span>,
        );
      }
    }
  }

  return finalParts;
}
