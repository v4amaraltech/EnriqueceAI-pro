'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarIcon, Check } from 'lucide-react';
import { differenceInDays, format, startOfWeek, startOfMonth, startOfYear, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { calculatePreviousPeriod, formatPeriodLabel } from '@/shared/utils/comparison';

import { Button } from '@/shared/components/ui/button';
import { Calendar } from '@/shared/components/ui/calendar';
import { Label } from '@/shared/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover';
import { Switch } from '@/shared/components/ui/switch';

const MAX_RANGE_DAYS = 365;

type PresetFn = () => { from: Date; to: Date };

const presets: Array<{ label: string; getRange: PresetFn }> = [
  { label: 'Hoje', getRange: () => { const d = new Date(); return { from: d, to: d }; } },
  { label: 'Ontem', getRange: () => { const d = subDays(new Date(), 1); return { from: d, to: d }; } },
  { label: 'Essa semana', getRange: () => ({ from: startOfWeek(new Date(), { weekStartsOn: 1 }), to: new Date() }) },
  { label: 'Últimos 7 dias', getRange: () => ({ from: subDays(new Date(), 7), to: new Date() }) },
  { label: 'Últimos 30 dias', getRange: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
  { label: 'Esse mês', getRange: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  { label: 'Esse ano', getRange: () => ({ from: startOfYear(new Date()), to: new Date() }) },
];

interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  compare?: boolean;
  onCompareChange?: (enabled: boolean) => void;
}

function toDate(isoDate: string): Date {
  return new Date(isoDate + 'T00:00:00');
}

export function DateRangePicker({ from, to, onChange, compare, onCompareChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const fromDate = toDate(from);
  const toDate_ = toDate(to);

  const [pendingRange, setPendingRange] = useState<DateRange | undefined>({
    from: fromDate,
    to: toDate_,
  });
  const [rangeComplete, setRangeComplete] = useState(false);

  // Clear pending range when popover opens so user starts fresh
  useEffect(() => {
    if (open) {
      setPendingRange(undefined); // eslint-disable-line react-hooks/set-state-in-effect
      setRangeComplete(false);
    }
  }, [open]);

  const handleCalendarSelect = useCallback((selected: DateRange | undefined) => {
    // If previous selection was a real range (from !== to), next click starts fresh
    if (rangeComplete && selected?.from) {
      setPendingRange({ from: selected.from, to: undefined });
      setRangeComplete(false);
      return;
    }
    setPendingRange(selected);
    // Only mark complete when from and to are different days (real range)
    if (selected?.from && selected?.to && selected.from.getTime() !== selected.to.getTime()) {
      setRangeComplete(true);
    }
  }, [rangeComplete]);

  const handlePreset = useCallback(
    (getRange: PresetFn) => {
      const { from: start, to: end } = getRange();
      onChange(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
      setOpen(false);
    },
    [onChange],
  );

  const handleApply = useCallback(() => {
    if (pendingRange?.from) {
      const rangeFrom = pendingRange.from;
      const rangeTo = pendingRange.to ?? pendingRange.from;
      const diff = differenceInDays(rangeTo, rangeFrom);
      if (diff > MAX_RANGE_DAYS || diff < 0) return;
      onChange(format(rangeFrom, 'yyyy-MM-dd'), format(rangeTo, 'yyyy-MM-dd'));
      setOpen(false);
    }
  }, [pendingRange, onChange]);

  const canApply = pendingRange?.from && pendingRange?.to;

  const pendingLabel = pendingRange?.from
    ? pendingRange.to
      ? `${format(pendingRange.from, 'dd MMM', { locale: ptBR })} — ${format(pendingRange.to, 'dd MMM', { locale: ptBR })}`
      : `${format(pendingRange.from, 'dd MMM', { locale: ptBR })} — ...`
    : null;

  const label = `${format(fromDate, 'dd MMM yyyy', { locale: ptBR })} — ${format(toDate_, 'dd MMM yyyy', { locale: ptBR })}`;

  const prevPeriod = compare ? calculatePreviousPeriod(from, to) : null;

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn('justify-start text-left font-normal')}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="flex">
            <div className="flex flex-col gap-1 border-r p-3">
              {presets.map((p) => (
                <Button
                  key={p.label}
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => handlePreset(p.getRange)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-col">
              <div className="relative p-3">
                <Calendar
                  mode="range"
                  selected={pendingRange}
                  onSelect={handleCalendarSelect}
                  numberOfMonths={2}
                  disabled={{ after: new Date() }}
                  locale={ptBR}
                />
              </div>
              <div className="flex items-center justify-between border-t px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  {pendingLabel}
                </span>
                <Button
                  size="sm"
                  disabled={!canApply}
                  onClick={handleApply}
                  className="gap-1.5"
                >
                  <Check className="h-3.5 w-3.5" />
                  Aplicar
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {onCompareChange && (
        <div className="flex items-center gap-1.5">
          <Switch
            id="compare-toggle"
            checked={compare ?? false}
            onCheckedChange={onCompareChange}
          />
          <Label htmlFor="compare-toggle" className="text-xs cursor-pointer whitespace-nowrap">
            Comparar
          </Label>
          {prevPeriod && (
            <span className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)] whitespace-nowrap">
              vs {formatPeriodLabel(prevPeriod.from, prevPeriod.to)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
