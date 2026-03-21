'use client';

import { useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';

const PRESETS = [
  { label: '1 MIN', minutes: 1 },
  { label: '5 MIN', minutes: 5 },
  { label: '30 MIN', minutes: 30 },
  { label: '1H', minutes: 60 },
  { label: '3H', minutes: 180 },
  { label: '5H', minutes: 300 },
] as const;

interface TimeIntervalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentMinutes: number;
  onConfirm: (minutes: number) => void;
}

export function TimeIntervalModal({
  open,
  onOpenChange,
  currentMinutes,
  onConfirm,
}: TimeIntervalModalProps) {
  const [selected, setSelected] = useState(currentMinutes);
  const [customValue, setCustomValue] = useState('');

  function handlePreset(minutes: number) {
    setSelected(minutes);
    setCustomValue('');
  }

  function handleCustomChange(value: string) {
    setCustomValue(value);
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed) && parsed > 0) {
      setSelected(parsed);
    }
  }

  function handleConfirm() {
    onConfirm(selected);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Intervalo de Tempo de Resposta</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Defina o intervalo de tempo para calcular a % de leads abordados.
          </p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.minutes}
                variant={selected === p.minutes && !customValue ? 'default' : 'outline'}
                size="sm"
                onClick={() => handlePreset(p.minutes)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              placeholder="Minutos custom"
              value={customValue}
              onChange={(e) => handleCustomChange(e.target.value)}
              className="w-40"
            />
            <span className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">minutos</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm}>Aplicar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
