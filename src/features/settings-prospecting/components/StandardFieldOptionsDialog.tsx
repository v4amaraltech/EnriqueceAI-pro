'use client';

import { useState } from 'react';

import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';

interface StandardFieldOptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fieldLabel: string;
  initialOptions: string[];
  onSave: (options: string[]) => void;
  isPending: boolean;
}

export function StandardFieldOptionsDialog({
  open,
  onOpenChange,
  fieldLabel,
  initialOptions,
  onSave,
  isPending,
}: StandardFieldOptionsDialogProps) {
  const [optionsList, setOptionsList] = useState<string[]>(
    initialOptions.length > 0 ? [...initialOptions] : [''],
  );

  function handleSave() {
    const cleaned = optionsList.map((o) => o.trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    onSave(cleaned);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar opções — {fieldLabel}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <label className="text-sm font-medium">Opções</label>
          {optionsList.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="w-6 text-right text-sm text-[var(--muted-foreground)]">
                {idx + 1}
              </span>
              <Input
                placeholder={`Opção ${idx + 1}`}
                value={opt}
                onChange={(e) => {
                  const updated = [...optionsList];
                  updated[idx] = e.target.value;
                  setOptionsList(updated);
                }}
                autoFocus={idx === optionsList.length - 1}
              />
              {optionsList.length > 1 && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setOptionsList((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOptionsList((prev) => [...prev, ''])}
          >
            <Plus className="mr-1 h-4 w-4" />
            Adicionar opção
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={isPending || optionsList.every((o) => !o.trim())}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
