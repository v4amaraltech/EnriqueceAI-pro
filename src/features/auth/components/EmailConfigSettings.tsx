'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold,
  Italic,
  Link as LinkIcon,
  Mail,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';

import { getGmailAuthUrl, disconnectGmail } from '@/features/integrations/actions/manage-gmail';
import { saveCustomSignature } from '@/features/integrations/actions/manage-signature';
import type { GmailConnectionSafe } from '@/features/integrations/types';

interface EmailConfigSettingsProps {
  gmail: GmailConnectionSafe | null;
}

export function EmailConfigSettings({ gmail }: EmailConfigSettingsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
      }),
      LinkExtension.configure({ openOnClick: false }),
      Placeholder.configure({
        placeholder: 'Escreva sua assinatura de email...',
      }),
    ],
    content: gmail?.custom_signature ?? '',
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none min-h-[120px] px-3 py-2 focus:outline-none',
      },
    },
  });

  function handleConnect() {
    startTransition(async () => {
      const result = await getGmailAuthUrl('/settings/company/email');
      if (result.success) {
        window.location.href = result.data.url;
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDisconnect() {
    startTransition(async () => {
      const result = await disconnectGmail();
      if (result.success) {
        toast.success('Gmail desconectado');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleLink() {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('URL:', previousUrl ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: url })
      .run();
  }

  function handleSaveSignature() {
    if (!editor) return;
    const html = editor.getHTML();
    const isEmpty = editor.isEmpty;
    startTransition(async () => {
      const result = await saveCustomSignature(isEmpty ? null : html);
      if (result.success) {
        toast.success('Assinatura salva');
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
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Configurações de E-mail
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Gerencie sua conta de e-mail e assinatura.
        </p>
      </div>

      {/* Seção 1: Conta de E-mail */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
        <h2 className="mb-4 text-base font-semibold">Conta de E-mail</h2>

        {gmail ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)]">
                <Mail className="h-5 w-5 text-[var(--muted-foreground)]" />
              </div>
              <div>
                <p className="text-sm font-medium">{gmail.email_address}</p>
                <Badge variant="default" className="mt-0.5">
                  Conectado
                </Badge>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              disabled={isPending}
            >
              Desconectar
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Mail className="h-10 w-10 text-[var(--muted-foreground)]" />
            <div>
              <p className="text-sm font-medium">Nenhuma conta conectada</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Conecte seu Gmail para enviar e-mails pela plataforma.
              </p>
            </div>
            <Button onClick={handleConnect} disabled={isPending}>
              Conectar Gmail
            </Button>
          </div>
        )}
      </section>

      {/* Seção 2: Assinatura (só se conectado) */}
      {gmail && (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
          <h2 className="mb-4 text-base font-semibold">
            Assinatura de E-mail
          </h2>

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

          <div className="mt-4 flex items-center gap-2">
            {gmail.custom_signature && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRestoreGmail}
                disabled={isPending}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Usar assinatura do Gmail
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSaveSignature}
              disabled={isPending}
              className="ml-auto"
            >
              {isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
