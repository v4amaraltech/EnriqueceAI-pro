'use client';

import { useEffect, useState } from 'react';

import { Building2, Search } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';

import { ScheduleActivityForm } from '@/features/activities/components/ScheduleActivityForm';
import { fetchLeads } from '@/features/leads/actions/fetch-leads';

interface LeadOption {
  id: string;
  name: string;
  detail: string;
}

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Busca só entre os leads deste SDR. */
  assignedTo: string;
}

/** "Nova tarefa": escolhe um lead do SDR e agenda um retorno (mesmo fluxo do lead). */
export function NewTaskDialog({ open, onOpenChange, assignedTo }: NewTaskDialogProps) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<LeadOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [lead, setLead] = useState<LeadOption | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuery('');
      setOptions([]);
      setLead(null);
    }
    onOpenChange(next);
  }

  const term = query.trim();
  const canSearch = term.length >= 2;

  useEffect(() => {
    if (!canSearch) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      void fetchLeads({ search: term, assigned_to: assignedTo, per_page: 8 }).then((res) => {
        if (cancelled) return;
        setLoading(false);
        setOptions(
          res.success
            ? res.data.data.map((l) => ({
                id: l.id,
                name: l.nome_fantasia ?? l.razao_social ?? l.cnpj ?? 'Lead sem nome',
                detail: [l.first_name, l.last_name].filter(Boolean).join(' ') || (l.telefone ?? ''),
              }))
            : [],
        );
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, canSearch, assignedTo]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova tarefa</DialogTitle>
          <DialogDescription>
            Agende um retorno para um lead. Um retorno novo substitui o retorno pendente que o lead já tiver.
          </DialogDescription>
        </DialogHeader>

        {lead ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{lead.name}</div>
                {lead.detail && <div className="text-muted-foreground truncate text-xs">{lead.detail}</div>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setLead(null)}>
                Trocar
              </Button>
            </div>
            <ScheduleActivityForm leadId={lead.id} />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar lead por empresa, contato, CNPJ ou telefone"
                className="pl-8"
                aria-label="Buscar lead"
              />
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {canSearch && loading && <p className="text-muted-foreground px-1 py-2 text-xs">Buscando…</p>}
              {!loading && canSearch && options.length === 0 && (
                <p className="text-muted-foreground px-1 py-2 text-xs">Nenhum lead encontrado na carteira.</p>
              )}
              {canSearch && options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setLead(o)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--accent)]"
                >
                  <Building2 className="text-muted-foreground h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate text-sm">{o.name}</div>
                    {o.detail && <div className="text-muted-foreground truncate text-xs">{o.detail}</div>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
