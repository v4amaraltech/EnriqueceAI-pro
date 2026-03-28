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
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Switch } from '@/shared/components/ui/switch';

const FIELD_TYPES = [
  { value: 'text', label: 'Texto' },
  { value: 'textarea', label: 'Texto Longo' },
  { value: 'number', label: 'Número' },
  { value: 'currency', label: 'Valor' },
  { value: 'date', label: 'Data' },
  { value: 'datetime', label: 'Data e Hora' },
  { value: 'select', label: 'Seleção' },
  { value: 'url', label: 'URL' },
] as const;

type FieldType = 'text' | 'textarea' | 'number' | 'currency' | 'date' | 'datetime' | 'select' | 'url';

export interface CustomFieldSettings {
  is_visible: boolean;
  is_required_won: boolean;
  is_required_lost: boolean;
}

interface CustomFieldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string, type: FieldType, options: string[] | undefined, settings: CustomFieldSettings) => void;
  isPending: boolean;
  initialName?: string;
  initialType?: FieldType;
  initialOptions?: string[];
  initialSettings?: CustomFieldSettings;
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
  initialSettings,
  title = 'Novo campo personalizado',
}: CustomFieldDialogProps) {
  const [name, setName] = useState(initialName);
  const [type, setType] = useState<FieldType>(initialType);
  const [optionsList, setOptionsList] = useState<string[]>(
    initialOptions && initialOptions.length > 0 ? [...initialOptions] : [''],
  );
  const [isVisible, setIsVisible] = useState(initialSettings?.is_visible ?? true);
  const [isRequiredWon, setIsRequiredWon] = useState(initialSettings?.is_required_won ?? false);
  const [isRequiredLost, setIsRequiredLost] = useState(initialSettings?.is_required_lost ?? false);

  function handleSave() {
    if (!name.trim()) return;
    const opts = type === 'select' ? optionsList.map((o) => o.trim()).filter(Boolean) : undefined;
    onSave(name, type, opts, { is_visible: isVisible, is_required_won: isRequiredWon, is_required_lost: isRequiredLost });
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
                      aria-label="Remover opção"
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

          {/* Settings section */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <p className="text-sm font-medium text-muted-foreground">Configurações do campo</p>
            <div className="flex items-center justify-between">
              <Label htmlFor="field-visible" className="text-sm font-normal">Visível no formulário</Label>
              <Switch id="field-visible" checked={isVisible} onCheckedChange={setIsVisible} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="field-required-won" className="text-sm font-normal">Obrigatório para ganho</Label>
              <Switch id="field-required-won" checked={isRequiredWon} onCheckedChange={setIsRequiredWon} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="field-required-lost" className="text-sm font-normal">Obrigatório para perdido</Label>
              <Switch id="field-required-lost" checked={isRequiredLost} onCheckedChange={setIsRequiredLost} />
            </div>
          </div>
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
