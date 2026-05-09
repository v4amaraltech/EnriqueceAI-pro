'use client';

import { useEffect, useState, useTransition } from 'react';
import { FileText, Loader2, Search } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';

import { fetchTemplates } from '@/features/templates/actions/fetch-templates';
import type { MessageTemplateRow } from '../types';

interface LoadTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: MessageTemplateRow) => void;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function LoadTemplateDialog({ open, onOpenChange, onSelect }: LoadTemplateDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [templates, setTemplates] = useState<MessageTemplateRow[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    startTransition(async () => {
      const result = await fetchTemplates({ channel: 'email', per_page: 100 });
      if (result.success) {
        setTemplates(result.data.data);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }, [open]);

  const term = search.trim().toLowerCase();
  const filtered = term
    ? templates.filter((t) =>
        t.name.toLowerCase().includes(term) ||
        (t.subject ?? '').toLowerCase().includes(term) ||
        stripHtml(t.body).toLowerCase().includes(term),
      )
    : templates;

  function handleSelect(template: MessageTemplateRow) {
    onSelect(template);
    onOpenChange(false);
    setSearch('');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-500" />
            Carregar template de email
          </DialogTitle>
          <DialogDescription>
            Selecione um template salvo para preencher o assunto e corpo deste step.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, assunto ou corpo..."
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="max-h-[400px] overflow-y-auto rounded-md border">
          {isPending ? (
            <div className="flex items-center justify-center py-12 text-sm text-[var(--muted-foreground)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando templates...
            </div>
          ) : error ? (
            <div className="py-12 text-center text-sm text-red-500">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
              {templates.length === 0
                ? 'Nenhum template de email cadastrado. Crie um em Prospecção → Templates.'
                : 'Nenhum template corresponde à busca.'}
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((template) => {
                const preview = stripHtml(template.body).slice(0, 120);
                return (
                  <li key={template.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(template)}
                      className="block w-full px-4 py-3 text-left transition-colors hover:bg-[var(--accent)]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{template.name}</span>
                        {template.is_system && (
                          <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                            Sistema
                          </span>
                        )}
                      </div>
                      {template.subject && (
                        <p className="mt-1 truncate text-xs text-[var(--muted-foreground)]">
                          <span className="font-medium">Assunto:</span> {template.subject}
                        </p>
                      )}
                      {preview && (
                        <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                          {preview}
                          {preview.length === 120 ? '…' : ''}
                        </p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
