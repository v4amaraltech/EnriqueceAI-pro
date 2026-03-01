'use client';

import { useState, useTransition } from 'react';

import { Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import { saveDialerPreferences } from '../actions/save-dialer-preferences';
import type { DialerPreferences } from '../schemas/dialer-preferences.schemas';

interface DialerPreferencesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preferences: DialerPreferences;
  onSaved: (updated: DialerPreferences) => void;
}

const DEFAULTS: DialerPreferences = {
  simultaneous_phones: 2,
  daily_limit_per_lead: 3,
};

const SIMULTANEOUS_MIN = 2;
const SIMULTANEOUS_MAX = 4;
const DAILY_LIMIT_MIN = 1;
const DAILY_LIMIT_MAX = 10;

export function DialerPreferencesDialog({
  open,
  onOpenChange,
  preferences,
  onSaved,
}: DialerPreferencesDialogProps) {
  const [phones, setPhones] = useState(preferences.simultaneous_phones);
  const [limit, setLimit] = useState(preferences.daily_limit_per_lead);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const result = await saveDialerPreferences({
        simultaneous_phones: phones,
        daily_limit_per_lead: limit,
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success('Preferências salvas');
      onSaved({ simultaneous_phones: phones, daily_limit_per_lead: limit });
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-lg">Preferências Power Dialer</DialogTitle>
        </DialogHeader>

        <div className="space-y-0 py-2">
          {/* Leads simultâneos */}
          <div className="space-y-3 py-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Leads simultâneos</h3>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => setPhones(Math.max(SIMULTANEOUS_MIN, phones - 1))}
                  disabled={phones <= SIMULTANEOUS_MIN}
                  aria-label="Diminuir leads simultâneos"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-8 text-center text-2xl font-bold">{phones}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => setPhones(Math.min(SIMULTANEOUS_MAX, phones + 1))}
                  disabled={phones >= SIMULTANEOUS_MAX}
                  aria-label="Aumentar leads simultâneos"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="text-sm text-[var(--muted-foreground)]">
              Número de leads a serem discados simultaneamente.
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              *Valor entre {SIMULTANEOUS_MIN} e {SIMULTANEOUS_MAX}.
            </p>
            {phones !== DEFAULTS.simultaneous_phones && (
              <button
                type="button"
                className="text-xs font-medium text-[var(--primary)] hover:underline"
                onClick={() => setPhones(DEFAULTS.simultaneous_phones)}
              >
                Voltar para o padrão
              </button>
            )}
          </div>

          <div className="border-t border-[var(--border)]" />

          {/* Limite diário de tentativas por lead */}
          <div className="space-y-3 py-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Limite diário de tentativas por lead</h3>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => setLimit(Math.max(DAILY_LIMIT_MIN, limit - 1))}
                  disabled={limit <= DAILY_LIMIT_MIN}
                  aria-label="Diminuir limite diário"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-8 text-center text-2xl font-bold">{limit}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => setLimit(Math.min(DAILY_LIMIT_MAX, limit + 1))}
                  disabled={limit >= DAILY_LIMIT_MAX}
                  aria-label="Aumentar limite diário"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="text-sm text-[var(--muted-foreground)]">
              Máximo de tentativas de ligação que um lead pode receber em um mesmo dia. Após isso, o lead ficará fora da fila do Power Dialer até o fim do dia.
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              *Valor entre {DAILY_LIMIT_MIN} e {DAILY_LIMIT_MAX}.
            </p>
            {limit !== DEFAULTS.daily_limit_per_lead && (
              <button
                type="button"
                className="text-xs font-medium text-[var(--primary)] hover:underline"
                onClick={() => setLimit(DEFAULTS.daily_limit_per_lead)}
              >
                Voltar para o padrão
              </button>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Fechar
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
