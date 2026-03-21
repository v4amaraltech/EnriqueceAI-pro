'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Zap } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import { enrollLeads } from '@/features/cadences/actions/manage-cadences';
import { fetchActiveCadences } from '../actions/fetch-active-cadences';

interface EnrollInCadenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
}

interface ActiveCadence {
  id: string;
  name: string;
  total_steps: number;
}

export function EnrollInCadenceDialog({ open, onOpenChange, leadIds }: EnrollInCadenceDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cadences, setCadences] = useState<ActiveCadence[]>([]);
  const [loaded, setLoaded] = useState(false);

  const count = leadIds.length;
  const isBulk = count > 1;

  // Load cadences when dialog becomes visible
  useEffect(() => {
    if (open && !loaded) {
      startTransition(async () => {
        const result = await fetchActiveCadences();
        if (result.success) {
          setCadences(result.data);
        }
        setLoaded(true);
      });
    }
  }, [open, loaded]);

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setLoaded(false);
      setCadences([]);
    }
  }

  function handleEnroll(cadenceId: string) {
    startTransition(async () => {
      const result = await enrollLeads(cadenceId, leadIds);
      if (result.success) {
        if (result.data.enrolled > 0) {
          toast.success(
            isBulk
              ? `${result.data.enrolled} lead${result.data.enrolled > 1 ? 's' : ''} inscrito${result.data.enrolled > 1 ? 's' : ''} na cadência`
              : 'Lead inscrito na cadência',
          );
          if (result.data.errors.length > 0) {
            toast.warning(`${result.data.errors.length} erro(s) ao inscrever`);
          }
        } else {
          toast.error(result.data.errors[0] ?? 'Erro ao inscrever');
        }
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            {isBulk ? `Atribuir ${count} leads a uma cadência` : 'Inscrever em Cadência'}
          </DialogTitle>
          <DialogDescription>
            {isBulk
              ? 'Selecione uma cadência ativa para inscrever os leads selecionados.'
              : 'Selecione uma cadência ativa para inscrever este lead.'}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 overflow-y-auto">
          {isPending && !loaded ? (
            <p className="py-8 text-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Carregando cadências...
            </p>
          ) : cadences.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Nenhuma cadência ativa encontrada.
            </p>
          ) : (
            <div className="space-y-2">
              {cadences.map((cadence) => (
                <button
                  key={cadence.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-md border p-3 text-left hover:bg-[var(--muted)] transition-colors"
                  disabled={isPending}
                  onClick={() => handleEnroll(cadence.id)}
                >
                  <div>
                    <p className="text-sm font-medium">
                      {cadence.name} ({cadence.total_steps} etapas)
                    </p>
                  </div>
                  <Zap className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
