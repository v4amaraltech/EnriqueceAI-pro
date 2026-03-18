'use client';

import { useCallback, useState } from 'react';
import { CalendarIcon } from 'lucide-react';
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

  const handlePreset = useCallback(
    (days: number) => {
      const end = new Date();
      const start = days === 0 ? end : subDays(end, days);
      onChange(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
      setPendingRange({ from: start, to: end });
      setOpen(false);
    },
    [onChange],
  );

  const handleRangeSelect = useCallback(
    (selected: DateRange | undefined) => {
      setPendingRange(selected);
      if (selected?.from && selected?.to) {
        const diff = differenceInDays(selected.to, selected.from);
        if (diff > MAX_RANGE_DAYS || diff < 0) return;
        onChange(format(selected.from, 'yyyy-MM-dd'), format(selected.to, 'yyyy-MM-dd'));
        setOpen(false);
      }
    },
    [onChange],
  );

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
            <div className="p-3">
              <Calendar
                mode="range"
                selected={pendingRange}
                onSelect={handleRangeSelect}
                numberOfMonths={2}
                disabled={{ after: new Date() }}
                locale={ptBR}
              />
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
            <span className="text-xs text-[var(--muted-foreground)] whitespace-nowrap">
              vs {formatPeriodLabel(prevPeriod.from, prevPeriod.to)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
