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
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import { SKIP_NOTE_MAX, SWITCH_REASONS, type SwitchReason } from '@/features/activities/constants/skip-reasons';
import { enrollLeads, switchLeadsCadence } from '@/features/cadences/actions/manage-cadences';
import { notifyEnrollErrors } from '@/features/cadences/utils/enroll-errors';
import { fetchActiveCadences } from '../actions/fetch-active-cadences';

interface EnrollInCadenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  /** 'enroll' adds to cadence (default), 'switch' removes from current + adds to new */
  mode?: 'enroll' | 'switch';
  /** Called after the server confirms the enroll/switch. */
  onSuccess?: () => void;
}

interface ActiveCadence {
  id: string;
  name: string;
  total_steps: number;
}

export function EnrollInCadenceDialog({ open, onOpenChange, leadIds, mode = 'enroll', onSuccess }: EnrollInCadenceDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cadences, setCadences] = useState<ActiveCadence[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [enrollingId, setEnrollingId] = useState<string | null>(null);
  // Trocar cadência exige motivo (1 clique). Sem ele a lista fica bloqueada.
  const [reason, setReason] = useState<SwitchReason | null>(null);
  const [note, setNote] = useState('');

  const count = leadIds.length;
  const isBulk = count > 1;
  const isSwitch = mode === 'switch';
  const needsReason = isSwitch && !reason;

  // Load cadences when dialog becomes visible. No modo switch o servidor já
  // filtra pelas cadências que o SDR pode usar (sdr_switch_allowed).
  useEffect(() => {
    if (open && !loaded) {
      startTransition(async () => {
        const result = await fetchActiveCadences(isSwitch ? { forSwitch: true } : {});
        if (result.success) {
          setCadences(result.data);
        }
        setLoaded(true);
      });
    }
  }, [open, loaded, isSwitch]);

  function handleOpenChange(nextOpen: boolean) {
    if (enrollingId) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setLoaded(false);
      setCadences([]);
      setEnrollingId(null);
      setReason(null);
      setNote('');
    }
  }

  function handleEnroll(cadenceId: string) {
    if (needsReason) return;
    setEnrollingId(cadenceId);
    startTransition(async () => {
      const result = isSwitch
        ? await switchLeadsCadence(cadenceId, leadIds, { reason: reason ?? undefined, note: note.trim() || undefined })
        : await enrollLeads(cadenceId, leadIds);
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
          notifyEnrollErrors(result.data.enrolled, result.data.errors, 'Erro ao processar');
          onSuccess?.();
        } else {
          notifyEnrollErrors(0, result.data.errors, 'Erro ao processar');
          if (result.data.errors.length === 0) toast.error('Erro ao processar');
        }
        handleOpenChange(false);
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

        {isSwitch && (
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Motivo da troca</Label>
            <Select value={reason ?? undefined} onValueChange={(v) => setReason(v as SwitchReason)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione o motivo" />
              </SelectTrigger>
              <SelectContent>
                {SWITCH_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {reason === 'other' && (
              <Input
                value={note}
                maxLength={SKIP_NOTE_MAX}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Descreva em poucas palavras (opcional)"
              />
            )}
          </div>
        )}

        <div className="max-h-64 overflow-y-auto">
          {isPending && !loaded ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Carregando cadências...
            </p>
          ) : cadences.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {isSwitch
                ? 'Nenhuma cadência disponível para troca. Fale com o gestor.'
                : 'Nenhuma cadência ativa encontrada.'}
            </p>
          ) : (
            <div className="space-y-2">
              {needsReason && (
                <p className="text-xs text-[var(--muted-foreground)]">Escolha o motivo para liberar a lista.</p>
              )}
              {cadences.map((cadence) => {
                const isEnrolling = enrollingId === cadence.id;
                return (
                  <button
                    key={cadence.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border p-3 text-left hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
                    disabled={!!enrollingId || needsReason}
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
