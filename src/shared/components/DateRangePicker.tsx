'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarIcon, Check } from 'lucide-react';
import { differenceInDays, format, subDays } from 'date-fns';
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

const presets = [
  { label: 'Hoje', days: 0 },
  { label: 'Ontem', days: -1 },
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
] as const;

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

  // Clear pending range when popover opens so user starts fresh
  useEffect(() => {
    if (open) {
      setPendingRange(undefined);
    }
  }, [open]);

  const handlePreset = useCallback(
    (days: number) => {
      const end = new Date();
      let start: Date;
      if (days === -1) {
        start = subDays(end, 1);
        onChange(format(start, 'yyyy-MM-dd'), format(start, 'yyyy-MM-dd'));
      } else if (days === 0) {
        start = end;
        onChange(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
      } else {
        start = subDays(end, days);
        onChange(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
      }
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
                  key={p.days}
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => handlePreset(p.days)}
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
                  onSelect={setPendingRange}
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
