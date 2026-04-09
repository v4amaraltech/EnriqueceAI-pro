'use client';

import { useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';

import {
  Bold,
  Braces,
  Heading,
  Info,
  Italic,
  Link,
  List,
  ListOrdered,
  Underline as UnderlineIcon,
} from 'lucide-react';

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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';

import { TEMPLATE_VARIABLES } from '@/features/activity-templates/constants/template-variables';
import type { ChannelType } from '../types';
import { channelConfig } from './ActivityTypeSidebar';
import type { TimelineStep } from './CadenceTimeline';

const channelPlaceholders: Record<ChannelType, string> = {
  email: 'Descreva como abordar o lead neste e-mail...',
  phone: 'Script de abordagem:\n1. Apresentação\n2. Contexto\n3. Proposta de valor\n4. Próximos passos',
  whatsapp: 'Mensagem modelo ou instruções de abordagem via WhatsApp...',
  linkedin: 'Como abordar:\n1. Enviar convite com nota personalizada\n2. Mensagem de apresentação',
  research: 'Itens a pesquisar:\n• Site da empresa\n• LinkedIn do contato\n• Notícias recentes',
};

const channelInstructionLabels: Record<ChannelType, string> = {
  email: 'Instruções',
  phone: 'Roteiro da Ligação',
  whatsapp: 'Mensagem / Instruções',
  linkedin: 'Instruções de Abordagem',
  research: 'O que pesquisar',
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

  const config = channelConfig[step.channel];
  const Icon = config.icon;
  const placeholder = channelPlaceholders[step.channel];
  const instrLabel = channelInstructionLabels[step.channel];

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      LinkExtension.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
    ],
    content: step.instructions ? step.instructions.replace(/\n/g, '<br/>') : '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none min-h-[180px] px-4 py-3 focus:outline-none',
      },
    },
  });

  const insertVariable = useCallback((varPlaceholder: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(varPlaceholder).run();
  }, [editor]);

  function handleLink() {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('URL:', previousUrl ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  function handleSave() {
    const html = editor?.getHTML() ?? '';
    const plainText = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    onSave(
      step.id,
      activityName.trim() || null,
      plainText || null,
    );
  }

  return (
    <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3 text-lg">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${config.bgColor}`}>
            <Icon className={`h-5 w-5 ${config.color}`} />
          </div>
          Editar atividade de {config.label.toLowerCase()}
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
                  Clique nos campos para inserir variáveis dinâmicas no texto. Elas serão substituídas pelos dados reais do lead e vendedor.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="text-muted-foreground text-xs">Clique ou arraste para inserir.</p>

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

        {/* Instruções com Rich Text Editor */}
        <div className="space-y-3">
          <h4 className="font-semibold">{instrLabel}</h4>

          <div className="rounded-lg border bg-[var(--card)] overflow-hidden">
            <EditorContent editor={editor} className="min-h-[180px]" />

            {editor && (
              <div className="flex flex-wrap items-center gap-0.5 border-t px-2 py-1.5 bg-[var(--muted)]/30">
                <Button
                  type="button" variant="ghost" size="sm"
                  className={cn('h-7 w-7 p-0', editor.isActive('bold') && 'bg-[var(--accent)]')}
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  title="Negrito"
                >
                  <Bold className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button" variant="ghost" size="sm"
                  className={cn('h-7 w-7 p-0', editor.isActive('italic') && 'bg-[var(--accent)]')}
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                  title="Itálico"
                >
                  <Italic className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button" variant="ghost" size="sm"
                  className={cn('h-7 w-7 p-0', editor.isActive('strike') && 'bg-[var(--accent)]')}
                  onClick={() => editor.chain().focus().toggleStrike().run()}
                  title="Tachado"
                >
                  <UnderlineIcon className="h-3.5 w-3.5" />
                </Button>

                <Separator orientation="vertical" className="mx-1 h-4" />

                <Button
                  type="button" variant="ghost" size="sm"
                  className={cn('h-7 w-7 p-0', editor.isActive('heading') && 'bg-[var(--accent)]')}
                  onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                  title="Título"
                >
                  <Heading className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button" variant="ghost" size="sm"
                  className={cn('h-7 w-7 p-0', editor.isActive('bulletList') && 'bg-[var(--accent)]')}
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                  title="Lista"
                >
                  <List className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button" variant="ghost" size="sm"
                  className={cn('h-7 w-7 p-0', editor.isActive('orderedList') && 'bg-[var(--accent)]')}
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}
                  title="Lista numerada"
                >
                  <ListOrdered className="h-3.5 w-3.5" />
                </Button>

                <Separator orientation="vertical" className="mx-1 h-4" />

                <Button
                  type="button" variant="ghost" size="sm"
                  className={cn('h-7 w-7 p-0', editor.isActive('link') && 'bg-[var(--accent)]')}
                  onClick={handleLink}
                  title="Link"
                >
                  <Link className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button" variant="ghost" size="sm"
                  className="h-7 gap-1 px-2"
                  onClick={() => insertVariable('{{primeiro_nome}}')}
                  title="Inserir variável"
                >
                  <Braces className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
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
