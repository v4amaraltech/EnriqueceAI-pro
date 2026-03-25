'use client';

import { useCallback, useState, useTransition } from 'react';
import { CheckCircle2, Loader2, Phone } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Textarea } from '@/shared/components/ui/textarea';

import type { CallStatus } from '../types';
import { classifyWebphoneCall } from '../actions/classify-webphone-call';

interface ClassificationOption {
  status: CallStatus;
  label: string;
}

const CLASSIFICATION_OPTIONS: ClassificationOption[] = [
  { status: 'significant', label: 'Significativa' },
  { status: 'not_significant', label: 'Não Significativa' },
  { status: 'no_contact', label: 'Sem Contato' },
  { status: 'busy', label: 'Ocupado' },
  { status: 'not_connected', label: 'Não Conectada' },
];

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

interface PostCallClassificationDialogProps {
  open: boolean;
  phone: string;
  /** Call duration in milliseconds (pre-computed when call ended) */
  durationMs: number;
  /** DB call record ID */
  callRecordId?: string;
  /** Lead ID for interaction record */
  leadId?: string;
  onClose: () => void;
}

export function PostCallClassificationDialog({
  open,
  phone,
  durationMs,
  callRecordId,
  leadId,
  onClose,
}: PostCallClassificationDialogProps) {
  const [selectedStatus, setSelectedStatus] = useState<CallStatus | null>(null);
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();

  const clientDurationSeconds = Math.max(0, Math.floor(durationMs / 1000));

  const handleSubmit = useCallback(() => {
    if (!selectedStatus || !callRecordId) {
      onClose();
      return;
    }

    startTransition(async () => {
      const result = await classifyWebphoneCall({
        callId: callRecordId,
        status: selectedStatus,
        clientDurationSeconds,
        notes: notes || undefined,
        leadId: leadId || undefined,
      });

      if (result.success) {
        toast.success('Ligação classificada');
      } else {
        toast.error(result.error);
      }

      setSelectedStatus(null);
      setNotes('');
      onClose();
    });
  }, [selectedStatus, callRecordId, clientDurationSeconds, notes, leadId, onClose]);

  const handleDismiss = useCallback(() => {
    setSelectedStatus(null);
    setNotes('');
    onClose();
  }, [onClose]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleDismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4" />
            Classificar Ligação
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Call info */}
          <div className="flex items-center justify-between rounded-lg bg-[var(--muted)] px-4 py-3">
            <span className="text-sm font-medium">{phone}</span>
            <span className="font-mono text-sm tabular-nums text-[var(--muted-foreground)]">
              {formatDuration(durationMs)}
            </span>
          </div>

          {/* Status buttons */}
          <div className="space-y-1.5">
            {CLASSIFICATION_OPTIONS.map((option) => (
              <button
                key={option.status}
                type="button"
                onClick={() => setSelectedStatus(option.status)}
                className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                  selectedStatus === option.status
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'border-[var(--border)] hover:bg-[var(--accent)]'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    selectedStatus === option.status ? 'bg-primary' : 'bg-[var(--muted-foreground)]/30'
                  }`}
                />
                {option.label}
              </button>
            ))}
          </div>

          {/* Notes */}
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anotações (opcional)..."
            className="min-h-[60px] resize-y"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleDismiss} disabled={isPending}>
            Pular
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !selectedStatus}>
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
