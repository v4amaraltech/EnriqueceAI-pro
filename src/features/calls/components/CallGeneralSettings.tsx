'use client';

import { useState, useTransition } from 'react';

import { Save } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

import { saveCallSettings } from '../actions/call-settings-crud';
import type { CallSettingsRow, CallType } from '../types';

interface CallGeneralSettingsProps {
  initial: CallSettingsRow | null;
}

const CALL_TYPE_OPTIONS: { value: CallType; label: string }[] = [
  { value: 'outbound', label: 'Realizada' },
  { value: 'inbound', label: 'Recebida' },
  { value: 'manual', label: 'Manual' },
];

export function CallGeneralSettings({ initial }: CallGeneralSettingsProps) {
  const [callsEnabled, setCallsEnabled] = useState(initial?.calls_enabled ?? true);
  const [defaultCallType, setDefaultCallType] = useState<CallType>(initial?.default_call_type ?? 'outbound');
  const [threshold, setThreshold] = useState(initial?.significant_threshold_seconds ?? 30);
  const [dailyTarget, setDailyTarget] = useState(initial?.daily_call_target ?? 20);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const result = await saveCallSettings({
        calls_enabled: callsEnabled,
        default_call_type: defaultCallType,
        significant_threshold_seconds: threshold,
        daily_call_target: dailyTarget,
      });

      if (result.success) {
        toast.success('Configurações salvas com sucesso!');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Configurações Gerais</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Configure o módulo de ligações da organização.
        </p>
      </div>

      <div className="space-y-4 rounded-lg border border-[var(--border)] p-4">
        {/* Calls enabled toggle */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">Módulo de Ligações</label>
            <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Habilitar ou desabilitar o módulo de ligações.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={callsEnabled}
            onClick={() => setCallsEnabled(!callsEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              callsEnabled ? 'bg-[var(--primary)]' : 'bg-[var(--muted)]'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                callsEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Default call type */}
        <div>
          <label className="block text-sm font-medium mb-2">Tipo Padrão de Ligação</label>
          <select
            value={defaultCallType}
            onChange={(e) => setDefaultCallType(e.target.value as CallType)}
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
          >
            {CALL_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Significant threshold */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Duração Mínima para Ligação Significativa
          </label>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={1}
              value={threshold}
              onChange={(e) => setThreshold(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-24 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">segundos</span>
          </div>
        </div>

        {/* Daily target */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Meta Diária de Ligações (Padrão da Organização)
          </label>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={0}
              value={dailyTarget}
              onChange={(e) => setDailyTarget(Math.max(0, parseInt(e.target.value, 10) || 0))}
              className="w-24 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">ligações por dia</span>
          </div>
        </div>
      </div>

      <Button onClick={handleSave} disabled={isPending}>
        <Save className="mr-2 h-4 w-4" />
        {isPending ? 'Salvando...' : 'Salvar Configurações'}
      </Button>
    </div>
  );
}
