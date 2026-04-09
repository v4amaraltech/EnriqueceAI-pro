'use client';

import { useTransition, useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';

import { Info, Linkedin, MessageCircle } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/lib/utils';
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';

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

  const channelLabels: Record<string, string> = {
    phone: 'ligação', email: 'e-mail', whatsapp: 'WhatsApp',
    linkedin: 'social point', research: 'pesquisa',
  };
  const resolvedChannel = isSocialPoint ? socialChannel : channel;
  const channelLabel = channelLabels[resolvedChannel] ?? resolvedChannel;

  return (
    <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          {isEdit ? `Editar atividade de ${channelLabel}` : `Nova atividade de ${channelLabel}`}
        </DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-5 py-2">
        {/* Dados Gerais */}
        <div className="space-y-1">
          <h4 className="font-semibold">Dados Gerais</h4>
          <p className="text-muted-foreground text-xs">
            Estas informações não são exibidas para seu cliente.
          </p>
        </div>

        <div className="space-y-3">
          <Label htmlFor="at-name">Nome da atividade:</Label>
          <Input
            id="at-name"
            placeholder={`Ex: Mensagem de ${channelLabel}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <Separator />

        {/* Campos dinâmicos */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold">Campos dinâmicos</h4>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[250px] text-xs">
                  Clique nos campos para inserir variáveis dinâmicas no texto de instruções. Elas serão substituídas pelos dados reais do lead e vendedor.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="text-muted-foreground text-xs">
            Clique ou arraste para inserir.
          </p>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground mr-1">Lead:</span>
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
              <span className="text-xs font-semibold text-muted-foreground mr-1">Vendedor:</span>
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
          <h4 className="font-semibold">Instruções</h4>
          <Textarea
            ref={textareaRef}
            id="at-instructions"
            placeholder={`Ex: Fala, {{primeiro_nome}}! Como estão as coisas por aí?\n\nMe chamo {{nome_vendedor}}, sou assessor na V4 Company...`}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={10}
            className="min-h-[200px]"
          />
        </div>

        {/* Rede preferencial (social point only) */}
        {isSocialPoint && !isEdit && (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="font-semibold">Rede preferencial</h4>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    'gap-2',
                    socialChannel === 'linkedin' && 'border-primary bg-primary/10 text-primary',
                  )}
                  onClick={() => setSocialChannel('linkedin')}
                >
                  <Linkedin className="h-4 w-4" />
                  LinkedIn
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    'gap-2',
                    socialChannel === 'whatsapp' && 'border-primary bg-primary/10 text-primary',
                  )}
                  onClick={() => setSocialChannel('whatsapp')}
                >
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </Button>
              </div>
            </div>
          </>
        )}

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
