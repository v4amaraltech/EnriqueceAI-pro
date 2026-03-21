'use client';

import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';

import { AVAILABLE_TEMPLATE_VARIABLES, VENDOR_TEMPLATE_VARIABLES } from '../cadence.schemas';

interface VariableInsertBarProps {
  onInsert: (variable: string) => void;
  disabled?: boolean;
}

export function VariableInsertBar({ onInsert, disabled }: VariableInsertBarProps) {
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Variáveis do Lead</Label>
        <div className="mt-1 flex flex-wrap gap-1">
          {AVAILABLE_TEMPLATE_VARIABLES.map((v) => (
            <Button
              key={v}
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-1.5 font-mono text-[10px]"
              disabled={disabled}
              onClick={() => onInsert(v)}
            >
              {`{{${v}}}`}
            </Button>
          ))}
        </div>
      </div>
      <div>
        <Label className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Variáveis do Vendedor</Label>
        <div className="mt-1 flex flex-wrap gap-1">
          {VENDOR_TEMPLATE_VARIABLES.map((v) => (
            <Button
              key={v}
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-1.5 font-mono text-[10px]"
              disabled={disabled}
              onClick={() => onInsert(v)}
            >
              {`{{${v}}}`}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
