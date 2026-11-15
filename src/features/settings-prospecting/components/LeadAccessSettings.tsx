'use client';

import { useState, useTransition } from 'react';

import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';

import { saveLeadVisibility } from '../actions/org-settings-crud';

const MODES = [
  {
    value: 'all' as const,
    label: 'Todos veem todos',
    description: 'Qualquer membro da equipe pode ver todos os leads da organização.',
  },
  {
    value: 'own' as const,
    label: 'Apenas seus leads',
    description: 'Cada membro só vê os leads atribuídos a ele.',
  },
] as const;

// "Por equipe" não existe de fato: não há times no sistema, e o RLS de `leads`
// trata `team` igual a `own` (só vê o lead quem é o `assigned_to`). Por isso a
// opção não é oferecida. Só aparece se a organização JÁ estiver nesse modo, para
// o gestor enxergar o estado atual e poder sair dele.
const LEGACY_TEAM_MODE = {
  value: 'team' as const,
  label: 'Por equipe (indisponível)',
  description:
    'Esta opção não funciona como equipe: hoje equivale a "Apenas seus leads". Escolha uma das opções acima.',
};

interface LeadAccessSettingsProps {
  initialMode: 'all' | 'own' | 'team';
}

export function LeadAccessSettings({ initialMode }: LeadAccessSettingsProps) {
  const [mode, setMode] = useState<'all' | 'own' | 'team'>(initialMode);
  const [isPending, startTransition] = useTransition();
  const modes = initialMode === 'team' ? [...MODES, LEGACY_TEAM_MODE] : MODES;

  function handleSave() {
    startTransition(async () => {
      const result = await saveLeadVisibility(mode);
      if (result.success) {
        toast.success('Modo de acesso salvo');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Acesso aos Leads</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Defina quem pode visualizar quais leads na sua organização.
        </p>
      </div>

      <div className="space-y-3">
        {modes.map((m) => (
          <label
            key={m.value}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
              mode === m.value
                ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                : 'border-[var(--border)] hover:border-[var(--primary)]/50'
            }`}
          >
            <input
              type="radio"
              name="lead-access"
              value={m.value}
              checked={mode === m.value}
              onChange={() => setMode(m.value)}
              className="mt-1"
            />
            <div>
              <span className="text-sm font-medium">{m.label}</span>
              <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{m.description}</p>
            </div>
          </label>
        ))}
      </div>

      <Button onClick={handleSave} disabled={isPending}>
        Salvar Configuração
      </Button>
    </div>
  );
}
