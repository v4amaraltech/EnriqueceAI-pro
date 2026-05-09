'use client';

import type { Editor } from '@tiptap/react';
import {
  Bold,
  Braces,
  FileText,
  Heading,
  Italic,
  Link,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { Separator } from '@/shared/components/ui/separator';

import {
  AVAILABLE_TEMPLATE_VARIABLES,
  VENDOR_TEMPLATE_VARIABLES,
} from '../cadence.schemas';

interface TipTapToolbarProps {
  editor: Editor | null;
  onInsertVariable: (variable: string) => void;
  onOpenAI: () => void;
  onLoadTemplate?: () => void;
  disabled?: boolean;
}

export function TipTapToolbar({
  editor,
  onInsertVariable,
  onOpenAI,
  onLoadTemplate,
  disabled,
}: TipTapToolbarProps) {
  if (!editor) return null;

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

  return (
    <div className="flex items-center gap-0.5 border-t px-2 py-1.5">
      {/* AI */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
        onClick={onOpenAI}
        disabled={disabled}
        title="Escrever com IA"
      >
        <Sparkles className="h-4 w-4" />
      </Button>

      {/* Load template */}
      {onLoadTemplate && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onLoadTemplate}
          disabled={disabled}
          title="Carregar template salvo"
        >
          <FileText className="h-4 w-4" />
        </Button>
      )}

      <Separator orientation="vertical" className="mx-1 h-5" />

      {/* Bold */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={`h-8 w-8 p-0 ${editor.isActive('bold') ? 'bg-[var(--accent)]' : ''}`}
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={disabled}
        title="Negrito"
      >
        <Bold className="h-4 w-4" />
      </Button>

      {/* Italic */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={`h-8 w-8 p-0 ${editor.isActive('italic') ? 'bg-[var(--accent)]' : ''}`}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={disabled}
        title="Itálico"
      >
        <Italic className="h-4 w-4" />
      </Button>

      {/* Heading dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={`h-8 w-8 p-0 ${
              editor.isActive('heading') ? 'bg-[var(--accent)]' : ''
            }`}
            disabled={disabled}
            title="Título"
          >
            <Heading className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            <span className="text-lg font-bold">Título 1</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <span className="text-base font-bold">Título 2</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            <span className="text-sm font-bold">Título 3</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Link */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={`h-8 w-8 p-0 ${editor.isActive('link') ? 'bg-[var(--accent)]' : ''}`}
        onClick={handleLink}
        disabled={disabled}
        title="Link"
      >
        <Link className="h-4 w-4" />
      </Button>

      <Separator orientation="vertical" className="mx-1 h-5" />

      {/* Variables dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2"
            disabled={disabled}
            title="Inserir variável"
          >
            <Braces className="h-4 w-4" />
            <span className="text-xs">Variáveis</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Lead
          </DropdownMenuLabel>
          {AVAILABLE_TEMPLATE_VARIABLES.map((v) => (
            <DropdownMenuItem key={v} onClick={() => onInsertVariable(v)}>
              <code className="text-xs text-red-600">{`{{${v}}}`}</code>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Vendedor
          </DropdownMenuLabel>
          {VENDOR_TEMPLATE_VARIABLES.map((v) => (
            <DropdownMenuItem key={v} onClick={() => onInsertVariable(v)}>
              <code className="text-xs text-red-600">{`{{${v}}}`}</code>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
