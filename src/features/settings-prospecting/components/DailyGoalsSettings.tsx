'use client';

import { useState, useTransition } from 'react';

import { RotateCcw, Save, Trophy } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

import type { DailyGoalsData, MemberGoal } from '../actions/get-daily-goals';
import { saveDailyGoals } from '../actions/save-daily-goals';

interface DailyGoalsSettingsProps {
  initial: DailyGoalsData;
}

export function DailyGoalsSettings({ initial }: DailyGoalsSettingsProps) {
  const [orgDefault, setOrgDefault] = useState(initial.orgDefault);
  const [memberGoals, setMemberGoals] = useState<MemberGoal[]>(initial.members);
  const [isPending, startTransition] = useTransition();

  function updateMemberTarget(userId: string, value: string) {
    setMemberGoals((prev) =>
      prev.map((m) =>
        m.userId === userId
          ? { ...m, target: value === '' ? null : Math.max(0, parseInt(value, 10) || 0) }
          : m,
      ),
    );
  }

  function handleReset() {
    setOrgDefault(initial.orgDefault);
    setMemberGoals(initial.members);
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveDailyGoals({
        orgDefault,
        memberGoals: memberGoals.map((m) => ({
          userId: m.userId,
          target: m.target,
        })),
      });

      if (result.success) {
        toast.success('Metas salvas com sucesso!');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
          <Trophy className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Objetivo Diário de Atividades</h1>
          <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Configure o objetivo diário de atividades para cada membro da equipe.
          </p>
          <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)] opacity-70 mt-0.5">
            Esta meta é para acompanhamento diário individual. A meta mensal exibida nos cards do Dashboard é configurada em Editar Metas no Dashboard.
          </p>
        </div>
      </div>

      {/* Org default */}
      <div className="rounded-lg border border-[var(--border)] p-4">
        <label className="block text-sm font-medium mb-2">Padrão</label>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            min={0}
            value={orgDefault}
            onChange={(e) => setOrgDefault(Math.max(0, parseInt(e.target.value, 10) || 0))}
            className="w-24"
          />
          <span className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            atividades/dia
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Membros sem meta individual usarão este valor como padrão.
        </p>
      </div>

      {/* Members table */}
      {memberGoals.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-[var(--muted)]/50">
                <th className="p-3 text-left text-sm font-medium">Vendedor</th>
                <th className="p-3 text-left text-sm font-medium">Meta Individual</th>
              </tr>
            </thead>
            <tbody>
              {memberGoals.map((member) => (
                <tr key={member.userId} className="border-b last:border-0">
                  <td className="p-3 text-sm">{member.name}</td>
                  <td className="p-3">
                    <Input
                      type="number"
                      min={0}
                      placeholder={String(orgDefault)}
                      value={member.target ?? ''}
                      onChange={(e) => updateMemberTarget(member.userId, e.target.value)}
                      className="w-24"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {memberGoals.length === 0 && (
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Nenhum membro ativo na organização.
        </p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isPending}>
          <Save className="mr-2 h-4 w-4" />
          {isPending ? 'Salvando...' : 'Salvar'}
        </Button>
        <Button variant="outline" onClick={handleReset} disabled={isPending}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Resetar
        </Button>
      </div>
    </div>
  );
}
