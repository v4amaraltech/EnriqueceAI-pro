'use client';

import { useState } from 'react';

import {
  CalendarIcon,
  CalendarPlus,
  CalendarX,
  CheckCircle2,
  FileText,
  Loader2,
  PhoneMissed,
  PhoneCall,
  RotateCcw,
  ThumbsDown,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from '@/shared/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils/format';

import { CallOutcomeSelector } from '@/features/calls/components/CallOutcomeSelector';
import { mapDispositionToAction } from '@/features/calls/disposition';
import type { CallStatus } from '@/features/calls/types';

import { ScheduleMeetingModal } from '@/features/integrations/components/ScheduleMeetingModal';

export interface CallReturnSchedule {
  scheduledAt: string;
  channel: 'phone' | 'whatsapp' | 'email';
  /** 'whatsapp' quando o retorno é uma Ligação via WhatsApp (channel='phone'); senão null. */
  callProvider: 'whatsapp' | null;
}

/** Valor do dropdown "Canal" — "whatsapp_call" mapeia p/ phone + callProvider. */
type ReturnChannelOption = 'phone' | 'whatsapp' | 'whatsapp_call' | 'email';

const RETURN_CHANNEL_MAP: Record<
  ReturnChannelOption,
  { channel: CallReturnSchedule['channel']; callProvider: 'whatsapp' | null }
> = {
  phone: { channel: 'phone', callProvider: null },
  whatsapp: { channel: 'whatsapp', callProvider: null },
  whatsapp_call: { channel: 'phone', callProvider: 'whatsapp' },
  email: { channel: 'email', callProvider: null },
};

/**
 * Desfecho pré-selecionado a partir do sinal técnico — não perguntamos o que o
 * sistema já sabe. Atendeu → assume conversa; não atendeu → "Não atendeu".
 * O SDR só confirma (ou corrige) em 1 clique.
 */
function defaultOutcome(connected: boolean): CallStatus {
  return connected ? 'significant' : 'no_contact';
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
  /** Sinal técnico de atendimento — pré-seleciona o desfecho e o pill do topo. */
  connected: boolean;
  isSending?: boolean;
  /** Quando presente, mostra "Tentar novamente". Recebe as anotações atuais (o
   *  fluxo de ligação normal registra a tentativa com elas antes de re-discar). */
  onRetry?: (notes: string) => void;
  /** Quando presente, mostra "Perdido". */
  onLeadLost?: () => void;
  /** Quando presente, mostra "No-show". */
  onMarkNoShow?: () => void;
  /**
   * Conclui a atividade. `returnSchedule` != null quando o desfecho reagenda
   * (ocupado / não atendeu) — o consumidor decide encerrar a cadência e criar a
   * atividade de retorno. `outcome` é o desfecho informado pelo SDR.
   */
  onConclude: (args: {
    notes: string;
    returnSchedule: CallReturnSchedule | null;
    outcome: CallStatus;
  }) => void;
}

/**
 * Modal "Resultado da Ligação" — compartilhado entre a ligação normal (API4COM) e
 * a Ligação via WhatsApp. Captura o desfecho do SDR, anotações e o retorno, e
 * expõe os desfechos de negócio (Perdido / Agendar Reunião / Concluir). A lógica
 * de avanço/persistência fica no consumidor, que fornece os callbacks.
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
  connected,
  isSending = false,
  onRetry,
  onLeadLost,
  onMarkNoShow,
  onConclude,
}: CallResultModalProps) {
  const [notes, setNotes] = useState('');
  const [outcome, setOutcome] = useState<CallStatus>(() => defaultOutcome(connected));
  const [returnDate, setReturnDate] = useState<Date | undefined>(undefined);
  const [returnTime, setReturnTime] = useState('09:00');
  const [returnChannel, setReturnChannel] = useState<ReturnChannelOption>('phone');
  const [scheduleMeetingOpen, setScheduleMeetingOpen] = useState(false);

  // O modal não é remontado entre ligações — sem este reset, as anotações e o
  // desfecho da chamada anterior vazariam para a próxima.
  //
  // Ajuste durante o render (padrão oficial do React para "resetar estado quando
  // uma prop muda") em vez de useEffect: o React reexecuta o componente na hora,
  // sem pintar o estado velho e sem render em cascata.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setNotes('');
      setOutcome(defaultOutcome(connected));
      setReturnDate(undefined);
      setReturnTime('09:00');
      setReturnChannel('phone');
    }
  }

  const action = mapDispositionToAction(outcome);
  const needsReturn = action === 'reschedule';
  const missingReturnDate = needsReturn && !returnDate;

  function buildReturnSchedule(): CallReturnSchedule | null {
    if (!needsReturn || !returnDate) return null;
    const [hours, minutes] = returnTime.split(':').map(Number);
    const scheduledAt = new Date(returnDate);
    scheduledAt.setHours(hours ?? 9, minutes ?? 0, 0, 0);
    return { scheduledAt: scheduledAt.toISOString(), ...RETURN_CHANNEL_MAP[returnChannel] };
  }

  function handleConclude(extraNote?: string) {
    const finalNotes = extraNote ? (notes ? `${notes}\n\n${extraNote}` : extraNote) : notes;
    onConclude({ notes: finalNotes, returnSchedule: buildReturnSchedule(), outcome });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resultado da Ligação</DialogTitle>
            {/* Descrição obrigatória para leitores de tela — sem ela o Radix
                avisa e o usuário de leitor de tela abre o modal sem contexto. */}
            <DialogDescription>
              Registre o que aconteceu na ligação para {leadName} e conclua a atividade.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Resumo — a duração ganha significado no pill de status */}
            <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--muted)] px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{leadName}</p>
                <p className="truncate text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  {phoneLabel}
                </p>
              </div>
              <div
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                  connected
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                )}
              >
                {connected ? (
                  <PhoneCall className="h-3.5 w-3.5" />
                ) : (
                  <PhoneMissed className="h-3.5 w-3.5" />
                )}
                <span>{connected ? 'Atendida' : 'Não atendida'}</span>
                <span aria-hidden>·</span>
                <span className="font-mono tabular-nums">{formatDuration(durationSeconds)}</span>
              </div>
            </div>

            {/* Desfecho — o coração do modal */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                O que aconteceu?
              </Label>
              <CallOutcomeSelector value={outcome} onChange={setOutcome} disabled={isSending} />
            </div>

            {/* Retorno — aparece sozinho quando o desfecho reagenda */}
            {needsReturn && (
              <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-center gap-1.5">
                  <CalendarIcon className="h-3.5 w-3.5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                  <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                    Quando ligar de novo
                  </Label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Canal</Label>
                    <Select
                      value={returnChannel}
                      onValueChange={(v) => setReturnChannel(v as ReturnChannelOption)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="phone">Ligação</SelectItem>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                        <SelectItem value="whatsapp_call">WhatsApp Ligação</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Data</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            'h-8 w-full justify-start text-xs font-normal',
                            !returnDate && 'text-muted-foreground',
                          )}
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
                  {missingReturnDate
                    ? 'Escolha a data para concluir.'
                    : 'A cadência será encerrada e a atividade de retorno criada.'}
                </p>
              </div>
            )}

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
                className="min-h-[80px] resize-y"
              />
            </div>
          </div>

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {/* Esquerda: ações discretas — não competem com a primária */}
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={isSending}>
                Cancelar
              </Button>
              {onRetry && (
                <Button variant="ghost" size="sm" onClick={() => onRetry(notes)} disabled={isSending}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Tentar novamente
                </Button>
              )}
              {onMarkNoShow && (
                <Button variant="ghost" size="sm" onClick={onMarkNoShow} disabled={isSending}>
                  <CalendarX className="mr-1.5 h-3.5 w-3.5" />
                  No-show
                </Button>
              )}
              {onLeadLost && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onLeadLost}
                  disabled={isSending}
                  className="text-[var(--destructive)] hover:text-[var(--destructive)]"
                >
                  <ThumbsDown className="mr-1.5 h-3.5 w-3.5" />
                  Perdido
                </Button>
              )}
            </div>
            {/* Direita: uma primária clara + a alternativa de alto valor */}
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button
                variant="outline"
                onClick={() => setScheduleMeetingOpen(true)}
                disabled={isSending}
              >
                <CalendarPlus className="mr-2 h-4 w-4" />
                Agendar Reunião
              </Button>
              <Button onClick={() => handleConclude()} disabled={isSending || missingReturnDate}>
                {isSending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
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
