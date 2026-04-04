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
  Eye,
  Heading,
  Italic,
  Link as LinkIcon,
  Loader2,
  Pencil,
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
  draftKey?: string;
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
  draftKey,
  onSubjectChange,
  onBodyChange,
  onSend,
  onSkip,
}: ActivityEmailComposeProps) {
  // Track last body value set from parent to avoid editor ↔ state loops
  const lastExternalBody = useRef(body);
  // Track which field was last focused (subject or body) for variable insertion
  const [focusedField, setFocusedField] = useState<'subject' | 'body'>('body');
  // Preview mode toggle
  const [previewMode, setPreviewMode] = useState(false);
  // Auto-save status indicator
  const [draftStatus, setDraftStatus] = useState<'saved' | 'saving' | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  // Restore draft from localStorage on mount
  const draftRestored = useRef(false);
  useEffect(() => {
    if (!draftKey || isLoading || draftRestored.current) return;
    draftRestored.current = true;
    try {
      const raw = localStorage.getItem(`email-draft:${draftKey}`);
      if (!raw) return;
      const draft = JSON.parse(raw) as { subject?: string; body?: string };
      if (draft.subject && draft.subject !== subject) onSubjectChange(draft.subject);
      if (draft.body && draft.body !== body) onBodyChange(draft.body);
      setDraftStatus('saved');
    } catch { /* ignore corrupt drafts */ }
  }, [draftKey, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save draft to localStorage on changes (debounced 2s)
  useEffect(() => {
    if (!draftKey || isLoading) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    setDraftStatus('saving');
    draftTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(`email-draft:${draftKey}`, JSON.stringify({ subject, body }));
        setDraftStatus('saved');
      } catch { /* storage full */ }
    }, 2000);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [draftKey, subject, body, isLoading]);

  // Clear draft after successful send
  const originalOnSend = onSend;
  const handleSendAndClearDraft = useCallback(() => {
    if (draftKey) {
      try { localStorage.removeItem(`email-draft:${draftKey}`); } catch {}
    }
    setDraftStatus(null);
    originalOnSend();
  }, [draftKey, originalOnSend]);
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
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          {previewMode ? 'Pré-visualização' : 'Compor Email'}
        </h3>
        <div className="flex items-center gap-2">
          {aiPersonalized && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Sparkles className="h-3 w-3" />
              Personalizado por IA
            </Badge>
          )}
          {draftStatus === 'saved' && (
            <span className="text-[10px] text-[var(--muted-foreground)]">Rascunho salvo</span>
          )}
          {draftStatus === 'saving' && (
            <span className="text-[10px] text-[var(--muted-foreground)] animate-pulse">Salvando...</span>
          )}
          {!isLoading && (
            <Button
              type="button"
              variant={previewMode ? 'default' : 'outline'}
              size="sm"
              className="gap-1.5"
              onClick={() => setPreviewMode(!previewMode)}
            >
              {previewMode ? (
                <>
                  <Pencil className="h-3.5 w-3.5" />
                  Editar
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" />
                  Pré-visualizar
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          <span className="ml-2 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Preparando email...</span>
        </div>
      ) : previewMode ? (
        <>
          <div className="mt-3 flex-1 overflow-auto rounded-lg border bg-white dark:bg-[var(--card)]">
            {/* Email header */}
            <div className="border-b px-6 py-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-[var(--muted-foreground)]">Para:</span>
                <span>{to || 'Sem email'}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-[var(--muted-foreground)]">Assunto:</span>
                <span className="font-semibold">{subject || '(sem assunto)'}</span>
              </div>
            </div>
            {/* Email body */}
            <div className="px-6 py-4">
              <div
                className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(body) }}
              />
              {signature && (
                <div
                  className="mt-4 border-t border-dashed border-[var(--border)] pt-3 text-sm opacity-70"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(signature) }}
                />
              )}
            </div>
          </div>
          {/* Actions */}
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button variant="outline" onClick={onSkip} disabled={isSending}>
              <Clock className="mr-2 h-4 w-4" />
              Pular
            </Button>
            <Button onClick={handleSendAndClearDraft} disabled={!canSend}>
              {isSending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Enviar Email
            </Button>
          </div>
        </>
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
                      <DropdownMenuLabel className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
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
                      <DropdownMenuLabel className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
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
            <Button onClick={handleSendAndClearDraft} disabled={!canSend}>
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
