'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Textarea } from '@/shared/components/ui/textarea';

import type { LossReasonRow } from '@/features/settings-prospecting/actions/loss-reasons-crud';

import { fetchLossReasons } from '../actions/lead-lifecycle';
import { bulkMarkLeadsLost } from '../actions/bulk-actions';

interface BulkMarkLeadsLostDialogProps {
  leadIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the server confirms the leads were marked as lost. */
  onSuccess?: () => void;
}

export function BulkMarkLeadsLostDialog({
  leadIds,
  open,
  onOpenChange,
  onSuccess,
}: BulkMarkLeadsLostDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [lossReasons, setLossReasons] = useState<LossReasonRow[]>([]);
  const [selectedReasonId, setSelectedReasonId] = useState<string | null>(null);
  const [lossNotes, setLossNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchLossReasons().then((result) => {
      if (cancelled) return;
      if (result.success) setLossReasons(result.data);
      else toast.error(result.error);
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
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const handleConfirm = useCallback(() => {
    if (!selectedReasonId) return;
    startTransition(async () => {
      const result = await bulkMarkLeadsLost(leadIds, selectedReasonId, lossNotes.trim() || undefined);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.count} lead(s) marcados como perdidos`);
      handleOpenChange(false);
      onSuccess?.();
    });
  }, [leadIds, selectedReasonId, lossNotes, handleOpenChange, onSuccess]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">
            Marcar {leadIds.length} lead(s) como perdidos
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Motivo da perda</Label>
            <Select value={selectedReasonId ?? undefined} onValueChange={setSelectedReasonId}>
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
            <p className="text-xs text-[var(--muted-foreground)]">
              O motivo selecionado será aplicado a todos os leads selecionados.
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Razão da desqualificação</Label>
            <Textarea
              placeholder="Escreva aqui o que te levou a desqualificar esses leads."
              value={lossNotes}
              onChange={(e) => setLossNotes(e.target.value)}
              rows={5}
            />
          </div>
        </div>
        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Fechar
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!selectedReasonId || isPending}
          >
            Marcar como perdido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
