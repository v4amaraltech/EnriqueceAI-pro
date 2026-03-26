'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Rocket, Zap } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import { enrollLeads } from '@/features/cadences/actions/manage-cadences';
import { fetchActiveCadences } from '@/features/leads/actions/fetch-active-cadences';

interface ActiveCadence {
  id: string;
  name: string;
  total_steps: number;
}

interface StartProspectingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  remaining: number;
}

export function StartProspectingDialog({ open, onOpenChange, leadIds, remaining }: StartProspectingDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cadences, setCadences] = useState<ActiveCadence[]>([]);
  const [loaded, setLoaded] = useState(false);

  const leadsToEnroll = leadIds.slice(0, Math.max(remaining, 1));
  const enrollCount = leadsToEnroll.length;

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
      const result = await enrollLeads(cadenceId, leadsToEnroll);
      if (result.success) {
        if (result.data.enrolled > 0) {
          toast.success(
            `${result.data.enrolled} lead${result.data.enrolled > 1 ? 's' : ''} inscrito${result.data.enrolled > 1 ? 's' : ''} na cadência`,
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
            <Rocket className="h-5 w-5" />
            Iniciar Prospecções
          </DialogTitle>
          <DialogDescription>
            {leadIds.length === 0
              ? 'Nenhum lead disponível para prospecção.'
              : remaining <= 0
                ? 'Meta diária já atingida! Você ainda pode iniciar novas prospecções.'
                : `${leadIds.length} lead${leadIds.length > 1 ? 's' : ''} disponíve${leadIds.length > 1 ? 'is' : 'l'}, ${enrollCount} ser${enrollCount > 1 ? 'ão' : 'á'} inscrito${enrollCount > 1 ? 's' : ''}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 overflow-y-auto">
          {leadIds.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
              Todos os leads já estão inscritos em cadências ativas.
            </p>
          ) : isPending && !loaded ? (
            <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
              Carregando cadências...
            </p>
          ) : cadences.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
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
                  <Zap className="h-4 w-4 text-[var(--muted-foreground)]" />
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
