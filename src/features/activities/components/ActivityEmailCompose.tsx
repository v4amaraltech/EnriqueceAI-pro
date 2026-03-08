'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import LinkExtension from '@tiptap/extension-link';
import { sanitizeHtml } from '@/lib/security/sanitize-html';
import {
  Bold,
  Braces,
  Clock,
  Heading,
  Italic,
  Link as LinkIcon,
  Loader2,
  Send,
  Sparkles,
} from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import {
  AVAILABLE_TEMPLATE_VARIABLES,
  VENDOR_TEMPLATE_VARIABLES,
} from '@/features/cadences/cadence.schemas';

interface ActivityEmailComposeProps {
  to: string;
  subject: string;
  body: string;
  signature?: string;
  aiPersonalized: boolean;
  isLoading: boolean;
  isSending: boolean;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onSend: () => void;
  onSkip: () => void;
}

export function ActivityEmailCompose({
  to,
  subject,
  body,
  signature,
  aiPersonalized,
  isLoading,
  isSending,
  onSubjectChange,
  onBodyChange,
  onSend,
  onSkip,
}: ActivityEmailComposeProps) {
  // Track last body value set from parent to avoid editor ↔ state loops
  const lastExternalBody = useRef(body);
  // Track which field was last focused (subject or body) for variable insertion
  const [focusedField, setFocusedField] = useState<'subject' | 'body'>('body');
  const subjectRef = useRef<HTMLInputElement>(null);
  // Save cursor position so we can restore it when inserting variables from the dropdown
  const savedSelection = useRef<{ from: number; to: number } | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Escreva o corpo do email...',
      }),
      LinkExtension.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 underline cursor-pointer',
        },
      }),
    ],
    content: body,
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      lastExternalBody.current = html;
      onBodyChange(html);
    },
    onFocus: () => setFocusedField('body'),
    onSelectionUpdate: ({ editor: e }) => {
      savedSelection.current = { from: e.state.selection.from, to: e.state.selection.to };
    },
    onBlur: ({ editor: e }) => {
      savedSelection.current = { from: e.state.selection.from, to: e.state.selection.to };
    },
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none min-h-[200px] p-3 focus:outline-none [&_p]:my-1',
      },
    },
  });

  // Sync body from parent when it changes externally (e.g. prepareActivityEmail resolves)
  useEffect(() => {
    if (editor && body !== lastExternalBody.current) {
      lastExternalBody.current = body;
      editor.commands.setContent(body);
    }
  }, [editor, body]);

  const handleInsertVariable = useCallback(
    (variable: string) => {
      const insertion = `{{${variable}}}`;

      if (focusedField === 'subject' && subjectRef.current) {
        const input = subjectRef.current;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        const newValue = input.value.slice(0, start) + insertion + input.value.slice(end);
        onSubjectChange(newValue);
        requestAnimationFrame(() => {
          input.focus();
          input.setSelectionRange(start + insertion.length, start + insertion.length);
        });
      } else if (editor) {
        const sel = savedSelection.current;
        if (sel) {
          editor.chain().setTextSelection(sel).insertContent(insertion).focus().run();
        } else {
          editor.chain().focus().insertContent(insertion).run();
        }
      }
    },
    [focusedField, editor, onSubjectChange],
  );

  const handleLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('URL:', previousUrl ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const bodyHasContent = editor ? !editor.isEmpty : body.replace(/<[^>]*>/g, '').trim().length > 0;
  const canSend = !isSending && !isLoading && to && subject.trim() && bodyHasContent;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Compor Email
        </h3>
        <div className="flex items-center gap-2">
          {aiPersonalized && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Sparkles className="h-3 w-3" />
              Personalizado por IA
            </Badge>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
          <span className="ml-2 text-sm text-[var(--muted-foreground)]">Preparando email...</span>
        </div>
      ) : (
        <>
          <div className="mt-3 flex-1 space-y-3">
            {/* To field (read-only) */}
            <div className="space-y-1">
              <Label className="text-xs">Para</Label>
              <Input
                value={to}
                readOnly
                className="bg-[var(--muted)]"
                placeholder={!to ? 'Lead sem email cadastrado' : undefined}
              />
            </div>

            {/* Subject */}
            <div className="space-y-1">
              <Label className="text-xs">Assunto</Label>
              <Input
                ref={subjectRef}
                value={subject}
                onChange={(e) => onSubjectChange(e.target.value)}
                onFocus={() => setFocusedField('subject')}
                placeholder="Assunto do email"
              />
            </div>

            {/* Body — TipTap rich text editor */}
            <div className="flex flex-1 flex-col space-y-1">
              <Label className="text-xs">Mensagem</Label>
              <div className="flex flex-1 flex-col rounded-md border focus-within:ring-1 focus-within:ring-[var(--ring)]">
                <EditorContent editor={editor} className="flex-1" />

                {/* Gmail signature inline (read-only, inside editor box) */}
                {signature && (
                  <div
                    className="border-t border-dashed border-[var(--border)] px-3 py-2 text-sm opacity-70"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(signature) }}
                  />
                )}

                {/* Formatting toolbar */}
                <div className="flex items-center gap-0.5 border-t px-2 py-1.5">
                  {/* Bold */}
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

                  {/* Italic */}
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

                  {/* Heading dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={`h-8 w-8 p-0 ${editor?.isActive('heading') ? 'bg-[var(--accent)]' : ''}`}
                        title="Título"
                      >
                        <Heading className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onClick={() =>
                          editor?.chain().focus().toggleHeading({ level: 1 }).run()
                        }
                      >
                        <span className="text-lg font-bold">Título 1</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          editor?.chain().focus().toggleHeading({ level: 2 }).run()
                        }
                      >
                        <span className="text-base font-bold">Título 2</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          editor?.chain().focus().toggleHeading({ level: 3 }).run()
                        }
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
                    className={`h-8 w-8 p-0 ${editor?.isActive('link') ? 'bg-[var(--accent)]' : ''}`}
                    onClick={handleLink}
                    title="Link"
                  >
                    <LinkIcon className="h-4 w-4" />
                  </Button>

                  {/* Variables dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        title="Inserir variável"
                      >
                        <Braces className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuLabel className="text-xs text-[var(--muted-foreground)]">
                        Lead
                      </DropdownMenuLabel>
                      {AVAILABLE_TEMPLATE_VARIABLES.map((v) => (
                        <DropdownMenuItem
                          key={v}
                          onClick={() => handleInsertVariable(v)}
                        >
                          <code className="text-xs text-purple-500">{`{{${v}}}`}</code>
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs text-[var(--muted-foreground)]">
                        Vendedor
                      </DropdownMenuLabel>
                      {VENDOR_TEMPLATE_VARIABLES.map((v) => (
                        <DropdownMenuItem
                          key={v}
                          onClick={() => handleInsertVariable(v)}
                        >
                          <code className="text-xs text-purple-500">{`{{${v}}}`}</code>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>

          </div>

          {/* Actions */}
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button variant="outline" onClick={onSkip} disabled={isSending}>
              <Clock className="mr-2 h-4 w-4" />
              Pular
            </Button>
            <Button onClick={onSend} disabled={!canSend}>
              {isSending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Enviar Email
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
