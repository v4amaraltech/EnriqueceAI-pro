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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

const FIELD_TYPES = [
  { value: 'text', label: 'Texto' },
  { value: 'number', label: 'Número' },
  { value: 'date', label: 'Data' },
  { value: 'select', label: 'Seleção' },
] as const;

type FieldType = 'text' | 'number' | 'date' | 'select';

interface CustomFieldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string, type: FieldType, options?: string[]) => void;
  isPending: boolean;
  initialName?: string;
  initialType?: FieldType;
  initialOptions?: string[];
  title?: string;
}

export function CustomFieldDialog({
  open,
  onOpenChange,
  onSave,
  isPending,
  initialName = '',
  initialType = 'text',
  initialOptions,
  title = 'Novo campo personalizado',
}: CustomFieldDialogProps) {
  const [name, setName] = useState(initialName);
  const [type, setType] = useState<FieldType>(initialType);
  const [optionsList, setOptionsList] = useState<string[]>(
    initialOptions && initialOptions.length > 0 ? [...initialOptions] : [''],
  );

  function handleSave() {
    if (!name.trim()) return;
    const opts = type === 'select' ? optionsList.map((o) => o.trim()).filter(Boolean) : undefined;
    onSave(name, type, opts);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <label className="text-sm font-medium">Nome do campo</label>
            <Input
              placeholder="Ex: Segmento, Cargo..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Tipo</label>
            <Select
              value={type}
              onValueChange={(v) => {
                setType(v as FieldType);
                if (v === 'select' && optionsList.length === 0) setOptionsList(['']);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type === 'select' && (
            <div className="space-y-2">
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
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isPending || !name.trim()}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
