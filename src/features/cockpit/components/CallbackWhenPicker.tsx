'use client';

import { useMemo, useState } from 'react';

import { Calendar as CalendarIcon } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Calendar } from '@/shared/components/ui/calendar';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover';

import { callbackShortcuts, type CallbackShortcutId } from '../utils/callback-slots';

/** Escolha de data e hora do retorno: o mesmo seletor para "Ligar depois" e "Indicou outra pessoa". */
const BRT = 'America/Sao_Paulo';

export function formatWhen(at: Date): string {
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

export function useCallbackWhen(initialShortcut: CallbackShortcutId | null = null) {
  const [openedAt] = useState(() => new Date());
  const shortcuts = useMemo(() => callbackShortcuts(openedAt), [openedAt]);
  const [shortcutId, setShortcutId] = useState<CallbackShortcutId | null>(initialShortcut);
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [customTime, setCustomTime] = useState('');
  const at = shortcutId ? (shortcuts.find((s) => s.id === shortcutId)?.at ?? null) : brtFrom(customDate, customTime);
  return {
    openedAt,
    shortcuts,
    shortcutId,
    customDate,
    customTime,
    at,
    pickShortcut: (id: CallbackShortcutId) => setShortcutId(id),
    pickDate: (d: Date | undefined) => {
      setCustomDate(d);
      setShortcutId(null);
    },
    pickTime: (time: string) => {
      setCustomTime(time);
      setShortcutId(null);
    },
  };
}

export function CallbackWhenPicker({
  when,
  testIdPrefix,
  disabled = false,
}: {
  when: ReturnType<typeof useCallbackWhen>;
  testIdPrefix: string;
  disabled?: boolean;
}) {
  const { openedAt, shortcuts, shortcutId, customDate, customTime } = when;
  return (
    <>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Horários prontos">
        {shortcuts.map((s) => (
          <Button
            key={s.id}
            type="button"
            size="sm"
            variant={shortcutId === s.id ? 'default' : 'outline'}
            aria-pressed={shortcutId === s.id}
            disabled={disabled}
            data-testid={`${testIdPrefix}-shortcut-${s.id}`}
            onClick={() => when.pickShortcut(s.id)}
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
              <Button type="button" variant="outline" size="sm" className="justify-start font-normal" disabled={disabled} data-testid={`${testIdPrefix}-date`}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {customDate ? customDate.toLocaleDateString('pt-BR') : 'Selecionar data'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={customDate}
                onSelect={when.pickDate}
                disabled={(d) => d < new Date(openedAt.getFullYear(), openedAt.getMonth(), openedAt.getDate())}
              />
            </PopoverContent>
          </Popover>
          <Input
            type="time"
            aria-label="Hora do retorno (Brasília)"
            className="h-8 w-28"
            value={customTime}
            disabled={disabled}
            data-testid={`${testIdPrefix}-time`}
            onChange={(e) => when.pickTime(e.target.value)}
          />
          <span className="text-muted-foreground text-xs">horário de Brasília</span>
        </div>
      </div>
    </>
  );
}
