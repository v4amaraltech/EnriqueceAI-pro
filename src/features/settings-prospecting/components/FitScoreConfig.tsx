'use client';

import { useState, useTransition } from 'react';

import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import type { FitScoreRuleRow } from '../actions/get-fit-score-rules';
import { saveFitScoreRules } from '../actions/save-fit-score-rules';
import { LEAD_FIELDS, OPERATORS } from '../fit-score.schema';

interface LocalRule {
  tempId: string;
  id?: string;
  points: number;
  field: string;
  operator: string;
  value: string | null;
}

function generateTempId() {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface FitScoreConfigProps {
  initial: FitScoreRuleRow[];
}

export function FitScoreConfig({ initial }: FitScoreConfigProps) {
  const [rules, setRules] = useState<LocalRule[]>(
    initial.map((r) => ({
      tempId: generateTempId(),
      id: r.id,
      points: r.points,
      field: r.field,
      operator: r.operator,
      value: r.value,
    })),
  );
  const [isPending, startTransition] = useTransition();

  function addRule() {
    setRules((prev) => [
      ...prev,
      {
        tempId: generateTempId(),
        points: 1,
        field: '',
        operator: 'contains',
        value: '',
      },
    ]);
  }

  function removeRule(tempId: string) {
    setRules((prev) => prev.filter((r) => r.tempId !== tempId));
  }

  function updateRule(tempId: string, updates: Partial<LocalRule>) {
    setRules((prev) =>
      prev.map((r) => (r.tempId === tempId ? { ...r, ...updates } : r)),
    );
  }

  function handleSave() {
    // Client-side validation
    for (const rule of rules) {
      if (rule.points === 0) {
        toast.error('Pontos não pode ser zero');
        return;
      }
      if (!rule.field) {
        toast.error('Campo é obrigatório em todas as regras');
        return;
      }
    }

    startTransition(async () => {
      const result = await saveFitScoreRules(
        rules.map((r) => ({
          id: r.id,
          points: r.points,
          field: r.field,
          operator: r.operator as 'contains' | 'equals' | 'not_empty' | 'starts_with',
          value: r.operator === 'not_empty' ? null : (r.value ?? null),
        })),
      );

      if (result.success) {
        toast.success(`${result.data.saved} regra(s) salva(s)`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Fit Score</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Configure regras para calcular a qualidade dos leads automaticamente.
          Cada regra adiciona ou subtrai pontos com base em um campo do lead.
        </p>
      </div>

      {/* Explanation */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-4">
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          <strong>Como funciona:</strong> O Fit Score é calculado somando os pontos de todas as regras
          que um lead atende. Leads com pontuação mais alta são considerados mais qualificados.
          Use pontos positivos para critérios desejáveis e negativos para critérios indesejáveis.
        </p>
      </div>

      {/* Rules table */}
      {rules.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-[var(--muted)]/50">
                <th className="p-3 text-left text-sm font-medium w-24">Pontos</th>
                <th className="p-3 text-left text-sm font-medium">Campo</th>
                <th className="p-3 text-left text-sm font-medium">Critério</th>
                <th className="p-3 text-left text-sm font-medium">Valor</th>
                <th className="p-3 text-right text-sm font-medium w-16" />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.tempId} className="border-b last:border-0">
                  <td className="p-3">
                    <Input
                      type="number"
                      value={rule.points}
                      onChange={(e) =>
                        updateRule(rule.tempId, {
                          points: parseInt(e.target.value, 10) || 0,
                        })
                      }
                      className="w-20"
                    />
                  </td>
                  <td className="p-3">
                    <Select
                      value={rule.field}
                      onValueChange={(v) => updateRule(rule.tempId, { field: v })}
                    >
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        {LEAD_FIELDS.map((f) => (
                          <SelectItem key={f.value} value={f.value}>
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-3">
                    <Select
                      value={rule.operator}
                      onValueChange={(v) => updateRule(rule.tempId, { operator: v })}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OPERATORS.map((op) => (
                          <SelectItem key={op.value} value={op.value}>
                            {op.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-3">
                    {rule.operator === 'not_empty' ? (
                      <span className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)] italic">—</span>
                    ) : (
                      <Input
                        value={rule.value ?? ''}
                        onChange={(e) => updateRule(rule.tempId, { value: e.target.value })}
                        placeholder="Valor..."
                        className="w-40"
                      />
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => removeRule(rule.tempId)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rules.length === 0 && (
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Nenhuma regra configurada. Clique em &quot;Adicionar regra&quot; para começar.
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={addRule}>
          <Plus className="mr-1 h-4 w-4" />
          Adicionar regra
        </Button>
        <Button onClick={handleSave} disabled={isPending}>
          <Save className="mr-2 h-4 w-4" />
          {isPending ? 'Salvando...' : 'Salvar Regras'}
        </Button>
      </div>
    </div>
  );
}
