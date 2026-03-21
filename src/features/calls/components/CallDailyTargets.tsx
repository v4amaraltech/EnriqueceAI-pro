'use client';

import { useState, useTransition } from 'react';

import { Save } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

import { saveCallDailyTargets } from '../actions/call-settings-crud';
import type { CallDailyTargetRow } from '../types';

interface MemberTarget {
  userId: string;
  name: string;
  role: string;
  dailyTarget: number | null;
}

interface CallDailyTargetsProps {
  orgDefault: number;
  members: Array<{ userId: string; name: string; role: string }>;
  initialTargets: CallDailyTargetRow[];
}

export function CallDailyTargets({ orgDefault, members, initialTargets }: CallDailyTargetsProps) {
  const targetMap = new Map(initialTargets.map((t) => [t.user_id, t.daily_target]));

  const [memberTargets, setMemberTargets] = useState<MemberTarget[]>(
    members.map((m) => ({
      userId: m.userId,
      name: m.name,
      role: m.role,
      dailyTarget: targetMap.get(m.userId) ?? null,
    })),
  );
  const [isPending, startTransition] = useTransition();

  function updateTarget(userId: string, value: string) {
    setMemberTargets((prev) =>
      prev.map((m) =>
        m.userId === userId
          ? { ...m, dailyTarget: value === '' ? null : Math.max(0, parseInt(value, 10) || 0) }
          : m,
      ),
    );
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveCallDailyTargets(
        memberTargets.map((m) => ({
          userId: m.userId,
          dailyTarget: m.dailyTarget,
        })),
      );

      if (result.success) {
        toast.success('Metas de ligações salvas!');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Metas de Ligações por Vendedor</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Defina metas individuais de ligações. Vendedores sem meta individual usam o padrão da organização ({orgDefault}).
        </p>
      </div>

      {memberTargets.length > 0 ? (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-[var(--muted)]/50">
                <th className="p-3 text-left text-sm font-medium">Vendedor</th>
                <th className="p-3 text-left text-sm font-medium">Role</th>
                <th className="p-3 text-left text-sm font-medium">Meta Individual</th>
              </tr>
            </thead>
            <tbody>
              {memberTargets.map((member) => (
                <tr key={member.userId} className="border-b last:border-0">
                  <td className="p-3 text-sm">{member.name}</td>
                  <td className="p-3 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                    {member.role === 'manager' ? 'Manager' : 'SDR'}
                  </td>
                  <td className="p-3">
                    <Input
                      type="number"
                      min={0}
                      placeholder={String(orgDefault)}
                      value={member.dailyTarget ?? ''}
                      onChange={(e) => updateTarget(member.userId, e.target.value)}
                      className="w-24 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Nenhum membro ativo na organização.
        </p>
      )}

      <Button onClick={handleSave} disabled={isPending}>
        <Save className="mr-2 h-4 w-4" />
        {isPending ? 'Salvando...' : 'Salvar Metas'}
      </Button>
    </div>
  );
}
