'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Calendar } from '@/shared/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Label } from '@/shared/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Switch } from '@/shared/components/ui/switch';
import { Textarea } from '@/shared/components/ui/textarea';

import type { LossReasonRow } from '@/features/settings-prospecting/actions/loss-reasons-crud';

import { fetchActiveCadences, type ActiveCadence } from '../actions/fetch-active-cadences';
import {
  fetchLossReasons,
  markLeadAsLost,
  scheduleNewProspection,
} from '../actions/lead-lifecycle';

interface MarkLeadLostDialogProps {
  leadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the server confirms the lead was marked as lost. */
  onSuccess?: () => void;
}

export function MarkLeadLostDialog({
  leadId,
  open,
  onOpenChange,
  onSuccess,
}: MarkLeadLostDialogProps) {
  const [isPending, startTransition] = useTransition();

  const [lossReasons, setLossReasons] = useState<LossReasonRow[]>([]);
  const [selectedReasonId, setSelectedReasonId] = useState<string | null>(null);
  const [lossNotes, setLossNotes] = useState('');

  const [cadences, setCadences] = useState<ActiveCadence[]>([]);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>(undefined);
  const [scheduleCadenceId, setScheduleCadenceId] = useState<string | null>(null);

  // Load reference data whenever the dialog opens. Form state is reset on close
  // (see handleOpenChange) so the next open starts fresh without setting state
  // synchronously inside this effect.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    Promise.all([fetchLossReasons(), fetchActiveCadences()]).then(([reasonsResult, cadencesResult]) => {
      if (cancelled) return;
      if (reasonsResult.success) {
        setLossReasons(reasonsResult.data);
      } else {
        toast.error(reasonsResult.error);
      }
      if (cadencesResult.success) {
        setCadences(cadencesResult.data);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setSelectedReasonId(null);
        setLossNotes('');
        setScheduleEnabled(false);
        setScheduleDate(undefined);
        setScheduleCadenceId(null);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const handleConfirm = useCallback(() => {
    if (!selectedReasonId) return;
    startTransition(async () => {
      const result = await markLeadAsLost(leadId, selectedReasonId, lossNotes.trim() || undefined);
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      if (scheduleEnabled && scheduleDate && scheduleCadenceId) {
        const schedResult = await scheduleNewProspection(
          leadId,
          scheduleCadenceId,
          scheduleDate.toISOString(),
        );
        if (schedResult.success) {
          toast.success(`Prospecção agendada para ${format(scheduleDate, 'dd/MM/yyyy')}`);
        } else {
          toast.error(schedResult.error);
        }
      } else {
        toast.success('Lead marcado como perdido');
      }

      handleOpenChange(false);
      onSuccess?.();
    });
  }, [
    leadId,
    selectedReasonId,
    lossNotes,
    scheduleEnabled,
    scheduleDate,
    scheduleCadenceId,
    handleOpenChange,
    onSuccess,
  ]);

  const confirmDisabled =
    !selectedReasonId ||
    isPending ||
    (scheduleEnabled && (!scheduleDate || !scheduleCadenceId));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Desqualificar lead</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Motivo da perda</Label>
            <Select
              value={selectedReasonId ?? undefined}
              onValueChange={setSelectedReasonId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione o motivo" />
              </SelectTrigger>
              <SelectContent>
                {lossReasons.map((reason) => (
                  <SelectItem key={reason.id} value={reason.id}>
                    {reason.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Razão da desqualificação</Label>
            <Textarea
              placeholder="Escreva aqui o que te levou a desqualificar esse lead."
              value={lossNotes}
              onChange={(e) => setLossNotes(e.target.value)}
              rows={6}
            />
          </div>

          {/* Schedule new prospection */}
          <div className="space-y-3 rounded-lg border border-[var(--border)] p-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="schedule-toggle" className="text-sm font-semibold cursor-pointer">
                Agendar nova prospecção
              </Label>
              <Switch
                id="schedule-toggle"
                checked={scheduleEnabled}
                onCheckedChange={setScheduleEnabled}
              />
            </div>

            {scheduleEnabled && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[var(--muted-foreground)]">Data de início</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start text-left font-normal"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {scheduleDate
                            ? format(scheduleDate, 'dd/MM/yyyy')
                            : 'Selecionar data'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={scheduleDate}
                          onSelect={setScheduleDate}
                          disabled={(date) => date < new Date()}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[var(--muted-foreground)]">Cadência</Label>
                    <Select
                      value={scheduleCadenceId ?? undefined}
                      onValueChange={setScheduleCadenceId}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecionar cadência" />
                      </SelectTrigger>
                      <SelectContent>
                        {cadences.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Uma nova prospecção será iniciada na data e cadência especificada e você permanecerá como o responsável pelo lead.
                </p>
              </>
            )}
          </div>
        </div>
        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Fechar
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={confirmDisabled}
          >
            Marcar como perdido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
