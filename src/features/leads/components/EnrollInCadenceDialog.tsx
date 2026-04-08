'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightLeft, Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import { enrollLeads, switchLeadsCadence } from '@/features/cadences/actions/manage-cadences';
import { fetchActiveCadences } from '../actions/fetch-active-cadences';

interface EnrollInCadenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  /** 'enroll' adds to cadence (default), 'switch' removes from current + adds to new */
  mode?: 'enroll' | 'switch';
}

interface ActiveCadence {
  id: string;
  name: string;
  total_steps: number;
}

export function EnrollInCadenceDialog({ open, onOpenChange, leadIds, mode = 'enroll' }: EnrollInCadenceDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cadences, setCadences] = useState<ActiveCadence[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [enrollingId, setEnrollingId] = useState<string | null>(null);

  const count = leadIds.length;
  const isBulk = count > 1;
  const isSwitch = mode === 'switch';

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
    if (enrollingId) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setLoaded(false);
      setCadences([]);
      setEnrollingId(null);
    }
  }

  function handleEnroll(cadenceId: string) {
    setEnrollingId(cadenceId);
    startTransition(async () => {
      const action = isSwitch ? switchLeadsCadence : enrollLeads;
      const result = await action(cadenceId, leadIds);
      setEnrollingId(null);
      if (result.success) {
        if (result.data.enrolled > 0) {
          const verb = isSwitch ? 'movido' : 'inscrito';
          const verbPlural = isSwitch ? 'movidos' : 'inscritos';
          toast.success(
            isBulk
              ? `${result.data.enrolled} lead${result.data.enrolled > 1 ? 's' : ''} ${result.data.enrolled > 1 ? verbPlural : verb} na cadência`
              : `Lead ${verb} na cadência`,
          );
          if (result.data.errors.length > 0) {
            toast.warning(`${result.data.errors.length} erro(s)`);
          }
        } else {
          toast.error(result.data.errors[0] ?? 'Erro ao processar');
        }
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const Icon = isSwitch ? ArrowRightLeft : Zap;
  const title = isSwitch
    ? (isBulk ? `Trocar cadência de ${count} leads` : 'Trocar Cadência')
    : (isBulk ? `Atribuir ${count} leads a uma cadência` : 'Inscrever em Cadência');
  const description = isSwitch
    ? (isBulk
      ? 'Os leads serão removidos da cadência atual e inscritos na selecionada.'
      : 'O lead será removido da cadência atual e inscrito na selecionada.')
    : (isBulk
      ? 'Selecione uma cadência ativa para inscrever os leads selecionados.'
      : 'Selecione uma cadência ativa para inscrever este lead.');

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="max-h-64 overflow-y-auto">
          {isPending && !loaded ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Carregando cadências...
            </p>
          ) : cadences.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma cadência ativa encontrada.
            </p>
          ) : (
            <div className="space-y-2">
              {cadences.map((cadence) => {
                const isEnrolling = enrollingId === cadence.id;
                return (
                  <button
                    key={cadence.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border p-3 text-left hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
                    disabled={!!enrollingId}
                    onClick={() => handleEnroll(cadence.id)}
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {cadence.name} ({cadence.total_steps} etapas)
                      </p>
                      {isEnrolling && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {isSwitch ? 'Trocando' : 'Inscrevendo'} {count} lead{count > 1 ? 's' : ''}...
                        </p>
                      )}
                    </div>
                    {isEnrolling ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
