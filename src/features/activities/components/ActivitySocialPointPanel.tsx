'use client';

import { useState } from 'react';

import { CheckCircle2, ExternalLink, Linkedin, Loader2, MessageSquare } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Textarea } from '@/shared/components/ui/textarea';
import { Label } from '@/shared/components/ui/label';

interface ActivitySocialPointPanelProps {
  leadName: string;
  isSending: boolean;
  onMarkDone: (notes: string) => void;
  onSkip: () => void;
}

export function ActivitySocialPointPanel({ leadName, isSending, onMarkDone, onSkip }: ActivitySocialPointPanelProps) {
  const [notes, setNotes] = useState('');

  const linkedinSearchUrl = `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(leadName)}`;

  return (
    <div className="flex h-full flex-col">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Social Point
      </h3>

      <div className="mt-4 space-y-4 flex-1">
        {/* LinkedIn link */}
        <a
          href={linkedinSearchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-4 transition-colors hover:bg-[var(--accent)]/50"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10">
            <Linkedin className="h-5 w-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Procurar {leadName} no LinkedIn</p>
            <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Conecte-se, curta ou comente em uma publicação</p>
          </div>
          <ExternalLink className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
        </a>

        {/* WhatsApp link (if applicable) */}
        <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-4 opacity-60">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
            <MessageSquare className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Interação via WhatsApp</p>
            <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Envie uma mensagem rápida para iniciar contato</p>
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1">
          <Label className="text-xs">Anotações</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="O que você fez? (ex: conectei no LinkedIn, curti publicação...)"
            className="min-h-[100px] resize-none"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
        <Button variant="outline" onClick={onSkip} disabled={isSending}>
          Pular
        </Button>
        <Button onClick={() => onMarkDone(notes)} disabled={isSending}>
          {isSending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          Marcar como feita
        </Button>
      </div>
    </div>
  );
}
