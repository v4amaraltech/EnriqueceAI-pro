'use client';

import { useState, useTransition } from 'react';

import { Bot, CheckCircle2, Loader2, Search } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { toast } from 'sonner';

import { deepResearchLead } from '../actions/deep-research';

interface ActivityResearchPanelProps {
  leadName: string;
  isSending: boolean;
  onMarkDone: (notes: string) => void;
  onSkip: () => void;
}

export function ActivityResearchPanel({ leadName, isSending, onMarkDone, onSkip }: ActivityResearchPanelProps) {
  const [notes, setNotes] = useState('');
  const [isResearching, startResearch] = useTransition();

  function handleDeepResearch() {
    startResearch(async () => {
      const result = await deepResearchLead(leadName);
      if (result.success) {
        setNotes(result.data.dossie);
        toast.success('Deep Research concluído!');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Pesquisa — {leadName}
        </h3>
      </div>

      <div className="mt-4 space-y-4 flex-1">
        {/* Deep Research AI Button */}
        <Button
          onClick={handleDeepResearch}
          disabled={isResearching}
          className="w-full gap-2 bg-[#e63027] hover:bg-[#cc2920] text-white"
          size="lg"
        >
          {isResearching ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Pesquisando com IA... (~30s)
            </>
          ) : (
            <>
              <Bot className="h-5 w-5" />
              Deep Research com IA
            </>
          )}
        </Button>

        {/* Notes / Dossiê */}
        <div className="space-y-1">
          <Label className="text-xs">Anotações da Pesquisa</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Clique em 'Deep Research com IA' para pesquisar automaticamente ou escreva manualmente..."
            className="min-h-[200px] resize-y font-mono text-xs"
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
