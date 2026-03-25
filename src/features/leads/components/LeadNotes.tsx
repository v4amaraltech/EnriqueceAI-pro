'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Loader2, Send, StickyNote } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Textarea } from '@/shared/components/ui/textarea';

import { addLeadNote, type LeadNote } from '../actions/add-lead-note';
import { fetchLeadNotes } from '../actions/fetch-lead-notes';

interface LeadNotesProps {
  leadId: string;
  notes: string | null;
}

const NOTE_COLLAPSE_LINES = 4;

function shouldCollapse(text: string): boolean {
  return text.split('\n').length > NOTE_COLLAPSE_LINES || text.length > 200;
}

function truncateText(text: string): string {
  const lines = text.split('\n');
  if (lines.length > NOTE_COLLAPSE_LINES) {
    return lines.slice(0, NOTE_COLLAPSE_LINES).join('\n');
  }
  return text.slice(0, 200);
}

function NoteContent({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = shouldCollapse(text);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  return (
    <>
      <p className="whitespace-pre-line break-words text-sm text-[var(--foreground)]">
        {collapsible && !expanded ? truncateText(text) + '…' : text}
      </p>
      {collapsible && (
        <button
          type="button"
          onClick={toggle}
          className="mt-1 flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" />
              Ver menos
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              Ver mais
            </>
          )}
        </button>
      )}
    </>
  );
}

function formatNoteDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LeadNotes({ leadId }: LeadNotesProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState('');
  const [savedNotes, setSavedNotes] = useState<LeadNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch existing notes on mount
  useEffect(() => {
    let cancelled = false;
    fetchLeadNotes(leadId).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setSavedNotes(result.data);
      }
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [leadId]);

  function handleSave() {
    if (!value.trim()) return;

    startTransition(async () => {
      const result = await addLeadNote(leadId, value);
      if (result.success) {
        toast.success('Anotação salva');
        setSavedNotes((prev) => [result.data, ...prev]);
        setValue('');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <StickyNote className="h-4 w-4" />
          Anotações
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* New note input */}
        <div className="space-y-2">
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Adicione uma anotação sobre este lead..."
            rows={3}
            className="resize-y"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSave();
              }
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Ctrl+Enter para salvar
            </span>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isPending || !value.trim()}
            >
              {isPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-2 h-3.5 w-3.5" />
              )}
              Salvar
            </Button>
          </div>
        </div>

        {/* Notes list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          </div>
        ) : savedNotes.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Nenhuma anotação registrada.
          </p>
        ) : (
          <div className="space-y-3">
            {savedNotes.map((note) => (
              <div
                key={note.id}
                className="min-w-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-3"
              >
                <NoteContent text={note.text} />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  <span>{formatNoteDate(note.created_at)}</span>
                  {note.author_email && (
                    <>
                      <span>-</span>
                      <span>{note.author_email}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
