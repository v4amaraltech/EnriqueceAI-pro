'use client';

import { useState, useTransition } from 'react';

import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import { saveAbmSettings } from '../actions/org-settings-crud';

const GROUP_FIELDS = [
  { value: 'razao_social', label: 'Razão Social' },
  { value: 'nome_fantasia', label: 'Nome Fantasia' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'cnae', label: 'CNAE' },
  { value: 'uf', label: 'UF' },
] as const;

interface AbmSettingsProps {
  initialEnabled: boolean;
  initialGroupField: string;
}

export function AbmSettings({ initialEnabled, initialGroupField }: AbmSettingsProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [groupField, setGroupField] = useState(initialGroupField);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const result = await saveAbmSettings(enabled, groupField);
      if (result.success) {
        toast.success('Configuração ABM salva');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Vendas Baseadas em Contas (ABM)</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Ative o modo ABM para agrupar leads por empresa e trabalhar contas de forma estratégica.
        </p>
      </div>

      <div className="space-y-4 rounded-lg border border-[var(--border)] p-4">
        {/* Toggle */}
        <div className="flex items-center gap-3">
          <Checkbox
            id="abm-toggle"
            checked={enabled}
            onCheckedChange={(v) => setEnabled(v === true)}
          />
          <label htmlFor="abm-toggle" className="text-sm font-medium cursor-pointer">
            Ativar vendas baseadas em contas
          </label>
        </div>

        {/* Group field */}
        {enabled && (
          <div>
            <label className="mb-1 block text-sm font-medium">Campo de agrupamento</label>
            <p className="mb-2 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Leads com o mesmo valor neste campo serão agrupados na mesma conta.
            </p>
            <Select value={groupField} onValueChange={setGroupField}>
              <SelectTrigger className="w-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUP_FIELDS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <Button onClick={handleSave} disabled={isPending}>
        Salvar Configuração
      </Button>
    </div>
  );
}
