'use client';

import { useMemo, useState } from 'react';

import { Calendar as CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Calendar } from '@/shared/components/ui/calendar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover';
import { Textarea } from '@/shared/components/ui/textarea';

import { callbackShortcuts, callbackWarnings, validateCallbackAt } from '../utils/callback-slots';

export type ScheduleCallbackFn = (input: { scheduledAt: Date; notes?: string }) => Promise<{ ok: true } | { ok: false; error: string }>;

interface MotorCallbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ausente (fixture /demo): confirmar só avisa que nada é registrado e fecha. */
  scheduleCallback?: ScheduleCallbackFn;
  /** Ligações do lead hoje, contando a atual (alimenta o aviso das 3 tentativas). */
  attemptsToday: number;
  simulated: boolean;
  /** Observação já digitada (Anotações do painel ou campo do desfecho). */
  initialNotes?: string;
  leadName?: string;
}

const BRT = 'America/Sao_Paulo';

function formatWhen(at: Date): string {
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: BRT, weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
  return f.format(at);
}

/** Data (do calendário, dia local) + "HH:mm" lidos como horário de Brasília. Vazio ou inválido: null. */
function brtFrom(date: Date | undefined, time: string): Date | null {
  if (!date || !/^\d{2}:\d{2}$/.test(time)) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  const at = new Date(`${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${time}:00-03:00`);
  return Number.isNaN(at.getTime()) ? null : at;
}

function CallbackForm({ onOpenChange, scheduleCallback, attemptsToday, simulated, initialNotes = '', leadName }: Omit<MotorCallbackDialogProps, 'open'>) {
  const [openedAt] = useState(() => new Date());
  const shortcuts = useMemo(() => callbackShortcuts(openedAt), [openedAt]);
  const [shortcutId, setShortcutId] = useState<string | null>(null);
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [customTime, setCustomTime] = useState('');
  const [notes, setNotes] = useState(initialNotes);
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const at = shortcutId ? (shortcuts.find((s) => s.id === shortcutId)?.at ?? null) : brtFrom(customDate, customTime);
  const validation = at ? validateCallbackAt(at, openedAt) : null;
  const warnings = at ? callbackWarnings(at, { now: openedAt, attemptsToday }) : [];
  const canConfirm = Boolean(at && validation?.ok) && !sending;

  async function confirm() {
    if (!at || !canConfirm) return;
    const text = notes.trim() || undefined;
    if (!scheduleCallback) {
      toast.message('Fixture de teste: nada é registrado.');
      onOpenChange(false);
      return;
    }
    setSending(true);
    setServerError(null);
    try {
      const r = await scheduleCallback({ scheduledAt: at, ...(text ? { notes: text } : {}) });
      if (r.ok) onOpenChange(false);
      else setServerError(r.error);
    } catch {
      setServerError('Não consegui agendar o retorno. Tente de novo.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <DialogHeader className="text-left">
        <DialogTitle className="text-base font-semibold">Ligar depois</DialogTitle>
        <DialogDescription className="text-sm">
          {leadName ? `Combine o retorno com ${leadName}.` : 'Combine o retorno com o lead.'} A discagem liga de novo neste horário.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Horários prontos">
          {shortcuts.map((s) => (
            <Button
              key={s.id}
              type="button"
              size="sm"
              variant={shortcutId === s.id ? 'default' : 'outline'}
              aria-pressed={shortcutId === s.id}
              data-testid={`motor-callback-shortcut-${s.id}`}
              onClick={() => setShortcutId(s.id)}
            >
              {s.label}
            </Button>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label className="text-muted-foreground text-xs">Escolher data e hora</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="justify-start font-normal" data-testid="motor-callback-date">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {customDate ? customDate.toLocaleDateString('pt-BR') : 'Selecionar data'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={customDate}
                  onSelect={(d) => {
                    setCustomDate(d);
                    setShortcutId(null);
                  }}
                  disabled={(d) => d < new Date(openedAt.getFullYear(), openedAt.getMonth(), openedAt.getDate())}
                />
              </PopoverContent>
            </Popover>
            <Input
              type="time"
              aria-label="Hora do retorno (Brasília)"
              className="h-8 w-28"
              value={customTime}
              data-testid="motor-callback-time"
              onChange={(e) => {
                setCustomTime(e.target.value);
                setShortcutId(null);
              }}
            />
            <span className="text-muted-foreground text-xs">horário de Brasília</span>
          </div>
        </div>

        {at && (
          <p className="text-sm font-medium" data-testid="motor-callback-when">
            Retorno: {formatWhen(at)}
          </p>
        )}
        {validation && !validation.ok && (
          <p className="text-destructive text-xs" role="alert" data-testid="motor-callback-invalid">
            {validation.error}
          </p>
        )}
        {warnings.map((w) => (
          <p key={w} className="rounded-md border border-amber-500/60 px-3 py-2 text-xs text-amber-700 dark:text-amber-400" data-testid="motor-callback-warning">
            {w}
          </p>
        ))}

        <div className="space-y-1.5">
          <Label htmlFor="motor-callback-notes" className="text-muted-foreground text-xs">
            Observação (opcional)
          </Label>
          <Textarea id="motor-callback-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16 text-xs" />
        </div>

        {simulated && (
          <p className="text-muted-foreground text-xs" data-testid="motor-callback-simulated">
            Simulado: nada é registrado.
          </p>
        )}
        {serverError && (
          <p className="text-destructive text-xs" role="alert" data-testid="motor-callback-error">
            {serverError}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={sending}>
          Cancelar
        </Button>
        <Button type="button" size="sm" onClick={() => void confirm()} disabled={!canConfirm} data-testid="motor-callback-confirm">
          {sending ? 'Agendando…' : 'Confirmar'}
        </Button>
      </DialogFooter>
    </>
  );
}

/** "Ligar depois" do motor: agenda o retorno e confirma o desfecho "Pediu para ligar depois" num único caminho (`scheduleCallback`). */
export function MotorCallbackDialog({ open, onOpenChange, ...rest }: MotorCallbackDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[480px] bg-background sm:max-w-[480px]" data-testid="motor-callback-dialog">
        {/* Monta só aberto: cada abertura recalcula os atalhos e zera a escolha. */}
        {open && <CallbackForm onOpenChange={onOpenChange} {...rest} />}
      </DialogContent>
    </Dialog>
  );
}
