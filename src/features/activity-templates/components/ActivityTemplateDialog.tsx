'use client';

import { useTransition, useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { toast } from 'sonner';

import {
  Bold,
  Braces,
  Facebook,
  Globe,
  Heading,
  Info,
  Instagram,
  Italic,
  Link,
  Linkedin,
  List,
  ListOrdered,
  MessageCircle,
  Twitter,
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

import type { ChannelType } from '@/features/cadences/types';
import { createActivityTemplate, updateActivityTemplate } from '../actions/manage-activity-templates';
import { TEMPLATE_VARIABLES } from '../constants/template-variables';
import type { ActivityTemplateRow } from '../types';

const SOCIAL_NETWORKS = [
  { key: 'linkedin', label: 'LinkedIn', icon: Linkedin },
  { key: 'facebook', label: 'Facebook', icon: Facebook },
  { key: 'twitter', label: 'Twitter', icon: Twitter },
  { key: 'instagram', label: 'Instagram', icon: Instagram },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { key: 'outro', label: 'Outro', icon: Globe },
] as const;

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
  const [socialChannel, setSocialChannel] = useState<string>(
    template?.channel === 'linkedin' || template?.channel === 'whatsapp'
      ? template.channel
      : 'linkedin',
  );

  const isEdit = !!template;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      LinkExtension.configure({
        openOnClick: false,
      }),
      Placeholder.configure({
        placeholder: 'Fala, {{primeiro_nome}}! Como estão as coisas por aí?\n\nMe chamo {{nome_vendedor}}, sou assessor na V4 Company...',
      }),
    ],
    content: template?.instructions
      ? template.instructions.replace(/\n/g, '<br/>')
      : '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none min-h-[200px] px-4 py-3 focus:outline-none',
      },
    },
  });

  const insertVariable = useCallback((placeholder: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(placeholder).run();
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

  function handleSubmit() {
    const html = editor?.getHTML() ?? '';
    // Convert HTML to plain text for storage (strip tags)
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

    const resolvedChannel = isSocialPoint ? socialChannel : channel;

    startTransition(async () => {
      if (isEdit) {
        const result = await updateActivityTemplate(template.id, { name, instructions: plainText });
        if (result.success) {
          toast.success('Template atualizado');
          onSaved(result.data);
          onOpenChange(false);
        } else {
          toast.error(result.error);
        }
      } else {
        const result = await createActivityTemplate({ name, channel: resolvedChannel as ChannelType, instructions: plainText });
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

        {/* Instruções com Rich Text Editor */}
        <div className="space-y-3">
          <h4 className="font-semibold">Instruções</h4>

          <div className="rounded-lg border bg-[var(--card)] overflow-hidden">
            {/* Editor content */}
            <EditorContent editor={editor} className="min-h-[200px]" />

            {/* Toolbar bottom */}
            {editor && (
              <div className="flex flex-wrap items-center gap-0.5 border-t px-2 py-1.5 bg-[var(--muted)]/30">
                {/* Bold */}
                <Button
                  type="button" variant="ghost" size="sm"
                  className={cn('h-7 w-7 p-0', editor.isActive('bold') && 'bg-[var(--accent)]')}
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  title="Negrito"
                >
                  <Bold className="h-3.5 w-3.5" />
                </Button>
                {/* Italic */}
                <Button
                  type="button" variant="ghost" size="sm"
                  className={cn('h-7 w-7 p-0', editor.isActive('italic') && 'bg-[var(--accent)]')}
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                  title="Itálico"
                >
                  <Italic className="h-3.5 w-3.5" />
                </Button>
                {/* Underline - use strike as fallback since underline needs extension */}
                <Button
                  type="button" variant="ghost" size="sm"
                  className={cn('h-7 w-7 p-0', editor.isActive('strike') && 'bg-[var(--accent)]')}
                  onClick={() => editor.chain().focus().toggleStrike().run()}
                  title="Tachado"
                >
                  <UnderlineIcon className="h-3.5 w-3.5" />
                </Button>

                <Separator orientation="vertical" className="mx-1 h-4" />

                {/* Heading */}
                <Button
                  type="button" variant="ghost" size="sm"
                  className={cn('h-7 w-7 p-0', editor.isActive('heading') && 'bg-[var(--accent)]')}
                  onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                  title="Título"
                >
                  <Heading className="h-3.5 w-3.5" />
                </Button>
                {/* Bullet list */}
                <Button
                  type="button" variant="ghost" size="sm"
                  className={cn('h-7 w-7 p-0', editor.isActive('bulletList') && 'bg-[var(--accent)]')}
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                  title="Lista"
                >
                  <List className="h-3.5 w-3.5" />
                </Button>
                {/* Ordered list */}
                <Button
                  type="button" variant="ghost" size="sm"
                  className={cn('h-7 w-7 p-0', editor.isActive('orderedList') && 'bg-[var(--accent)]')}
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}
                  title="Lista numerada"
                >
                  <ListOrdered className="h-3.5 w-3.5" />
                </Button>

                <Separator orientation="vertical" className="mx-1 h-4" />

                {/* Link */}
                <Button
                  type="button" variant="ghost" size="sm"
                  className={cn('h-7 w-7 p-0', editor.isActive('link') && 'bg-[var(--accent)]')}
                  onClick={handleLink}
                  title="Link"
                >
                  <Link className="h-3.5 w-3.5" />
                </Button>
                {/* Variables */}
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

        {/* Rede preferencial (social point only) */}
        {isSocialPoint && !isEdit && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h4 className="font-semibold">Rede preferencial</h4>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-[200px] text-xs">
                      Selecione a rede social preferencial para esta atividade.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="flex flex-wrap gap-2">
                {SOCIAL_NETWORKS.map((net) => {
                  const Icon = net.icon;
                  const isActive = socialChannel === net.key;
                  return (
                    <Button
                      key={net.key}
                      type="button"
                      variant="outline"
                      size="sm"
                      className={cn(
                        'gap-2 px-4',
                        isActive && 'border-primary bg-primary/10 text-primary',
                      )}
                      onClick={() => setSocialChannel(net.key)}
                    >
                      <Icon className="h-4 w-4" />
                      {net.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
          Cancelar
        </Button>
        <Button onClick={handleSubmit} disabled={isPending || !name.trim()}>
          {isPending ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Criar'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
