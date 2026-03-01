'use client';

import { useTransition } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Italic, Link as LinkIcon, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import { saveCustomSignature } from '../actions/manage-signature';

interface SignatureEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSignature: string | null;
  onSaved: () => void;
}

export function SignatureEditor({
  open,
  onOpenChange,
  currentSignature,
  onSaved,
}: SignatureEditorProps) {
  const [isPending, startTransition] = useTransition();

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, blockquote: false }),
      LinkExtension.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Escreva sua assinatura de email...' }),
    ],
    content: currentSignature ?? '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none min-h-[120px] px-3 py-2 focus:outline-none',
      },
    },
  });

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
    if (!editor) return;
    const html = editor.getHTML();
    const isEmpty = editor.isEmpty;
    startTransition(async () => {
      const result = await saveCustomSignature(isEmpty ? null : html);
      if (result.success) {
        toast.success('Assinatura salva');
        onSaved();
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleRestoreGmail() {
    startTransition(async () => {
      const result = await saveCustomSignature(null);
      if (result.success) {
        editor?.commands.clearContent();
        toast.success('Assinatura do Gmail será usada');
        onSaved();
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assinatura de Email</DialogTitle>
          <DialogDescription>
            Personalize sua assinatura. Se vazia, será usada a assinatura do Gmail.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border">
          {/* Toolbar */}
          <div className="flex items-center gap-0.5 border-b px-2 py-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`h-8 w-8 p-0 ${editor?.isActive('bold') ? 'bg-[var(--accent)]' : ''}`}
              onClick={() => editor?.chain().focus().toggleBold().run()}
              title="Negrito"
            >
              <Bold className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`h-8 w-8 p-0 ${editor?.isActive('italic') ? 'bg-[var(--accent)]' : ''}`}
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              title="Itálico"
            >
              <Italic className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`h-8 w-8 p-0 ${editor?.isActive('link') ? 'bg-[var(--accent)]' : ''}`}
              onClick={handleLink}
              title="Link"
            >
              <LinkIcon className="h-4 w-4" />
            </Button>
          </div>

          {/* Editor */}
          <EditorContent editor={editor} />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {currentSignature && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRestoreGmail}
              disabled={isPending}
              className="mr-auto"
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Usar assinatura do Gmail
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
