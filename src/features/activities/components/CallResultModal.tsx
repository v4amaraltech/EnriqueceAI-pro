'use client';

import { useState } from 'react';

import {
  CalendarIcon,
  CalendarPlus,
  CalendarX,
  CheckCircle2,
  FileText,
  Loader2,
  RotateCcw,
  ThumbsDown,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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
import { Calendar } from '@/shared/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover';
import { Switch } from '@/shared/components/ui/switch';
import { Textarea } from '@/shared/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils/format';

import { ScheduleMeetingModal } from '@/features/integrations/components/ScheduleMeetingModal';

export interface CallReturnSchedule {
  scheduledAt: string;
  channel: 'phone' | 'whatsapp';
}

export interface CallResultModalProps {
  open: boolean;
  onClose: () => void;
  leadName: string;
  leadId: string;
  leadEmail?: string | null;
  leadFirstName?: string | null;
  /** Número exibido no cabeçalho. */
  phoneLabel: string;
  durationSeconds: number;
  isSending?: boolean;
  /** Quando presente, mostra "Tentar novamente". */
  onRetry?: () => void;
  /** Quando presente, mostra "Perdido". */
  onLeadLost?: () => void;
  /** Quando presente, mostra "No-show". */
  onMarkNoShow?: () => void;
  /**
   * Conclui a atividade. `returnSchedule` != null quando "Agendar retorno" está
   * ativo — o consumidor decide encerrar a cadência e criar a atividade de retorno.
   */
  onConclude: (args: { notes: string; returnSchedule: CallReturnSchedule | null }) => void;
}

/**
 * Modal "Resultado da Ligação" — compartilhado entre a ligação normal e a Ligação
 * via WhatsApp. Encapsula anotações, agendar retorno e os desfechos (Perdido /
 * Agendar Reunião / Concluir). A lógica de avanço/persistência fica no consumidor,
 * que fornece os callbacks.
 */
export function CallResultModal({
  open,
  onClose,
  leadName,
  leadId,
  leadEmail,
  leadFirstName,
  phoneLabel,
  durationSeconds,
  isSending = false,
  onRetry,
  onLeadLost,
  onMarkNoShow,
  onConclude,
}: CallResultModalProps) {
  const [notes, setNotes] = useState('');
  const [scheduleReturn, setScheduleReturn] = useState(false);
  const [returnDate, setReturnDate] = useState<Date | undefined>(undefined);
  const [returnTime, setReturnTime] = useState('09:00');
  const [returnChannel, setReturnChannel] = useState<'phone' | 'whatsapp'>('phone');
  const [scheduleMeetingOpen, setScheduleMeetingOpen] = useState(false);

  function buildReturnSchedule(): CallReturnSchedule | null {
    if (!scheduleReturn || !returnDate) return null;
    const [hours, minutes] = returnTime.split(':').map(Number);
    const scheduledAt = new Date(returnDate);
    scheduledAt.setHours(hours ?? 9, minutes ?? 0, 0, 0);
    return { scheduledAt: scheduledAt.toISOString(), channel: returnChannel };
  }

  function handleConclude(extraNote?: string) {
    const finalNotes = extraNote ? (notes ? `${notes}\n\n${extraNote}` : extraNote) : notes;
    onConclude({ notes: finalNotes, returnSchedule: buildReturnSchedule() });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resultado da Ligação</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Resumo da ligação */}
            <div className="flex items-center justify-between rounded-lg bg-[var(--muted)] px-4 py-3">
              <div>
                <p className="text-sm font-medium">{leadName}</p>
                <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{phoneLabel}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm tabular-nums">{formatDuration(durationSeconds)}</p>
                <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Duração</p>
              </div>
            </div>

            {/* Anotações */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  Anotações
                </Label>
              </div>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Faça anotações sobre a ligação..."
                className="min-h-[100px] resize-y"
              />
            </div>

            {/* Agendar retorno */}
            <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Agendar retorno</Label>
                <Switch checked={scheduleReturn} onCheckedChange={setScheduleReturn} />
              </div>
              {scheduleReturn && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Canal</Label>
                      <Select value={returnChannel} onValueChange={(v) => setReturnChannel(v as 'phone' | 'whatsapp')}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="phone">Ligação</SelectItem>
                          <SelectItem value="whatsapp">WhatsApp</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Data</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn('h-8 w-full justify-start text-xs font-normal', !returnDate && 'text-muted-foreground')}
                          >
                            <CalendarIcon className="mr-1 h-3 w-3" />
                            {returnDate ? format(returnDate, 'dd/MM', { locale: ptBR }) : 'Data'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={returnDate}
                            onSelect={setReturnDate}
                            locale={ptBR}
                            disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Horário</Label>
                      <Select value={returnTime} onValueChange={setReturnTime}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 12 }, (_, i) => i + 8)
                            .flatMap((h) => [
                              `${h.toString().padStart(2, '0')}:00`,
                              `${h.toString().padStart(2, '0')}:30`,
                            ])
                            .map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    A cadência será encerrada e a atividade de retorno criada.
                  </p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {/* Esquerda: sair / repetir */}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={onClose} disabled={isSending}>
                Cancelar
              </Button>
              {onRetry && (
                <Button variant="secondary" onClick={onRetry} disabled={isSending}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Tentar novamente
                </Button>
              )}
            </div>
            {/* Direita: desfechos */}
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {onMarkNoShow && (
                <Button
                  onClick={onMarkNoShow}
                  disabled={isSending}
                  className="bg-amber-500 text-white hover:bg-amber-600"
                >
                  <CalendarX className="mr-2 h-4 w-4" />
                  No-show
                </Button>
              )}
              {onLeadLost && (
                <Button variant="destructive" onClick={onLeadLost} disabled={isSending}>
                  <ThumbsDown className="mr-2 h-4 w-4" />
                  Perdido
                </Button>
              )}
              <Button
                variant="default"
                onClick={() => setScheduleMeetingOpen(true)}
                disabled={isSending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <CalendarPlus className="mr-2 h-4 w-4" />
                Agendar Reunião
              </Button>
              <Button onClick={() => handleConclude()} disabled={isSending}>
                {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Concluir atividade
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ScheduleMeetingModal
        open={scheduleMeetingOpen}
        onOpenChange={setScheduleMeetingOpen}
        leadId={leadId}
        leadEmail={leadEmail ?? null}
        leadName={leadName}
        leadFirstName={leadFirstName}
        defaultTitle={`V4 Company + ${leadName}`}
        onScheduled={() => {
          setScheduleMeetingOpen(false);
          handleConclude('✅ Reunião agendada durante a ligação.');
        }}
      />
    </>
  );
}
