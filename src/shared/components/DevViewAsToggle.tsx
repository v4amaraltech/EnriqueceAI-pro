'use client';

import { useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { setDevViewAs } from '@/lib/auth/dev-view-as-actions';

/**
 * Chave flutuante "Ver como: Gestor / SDR" — só aparece no `pnpm dev` e só para
 * gestores (o layout decide). Troca o cookie e recarrega os dados da página.
 */
export function DevViewAsToggle({ viewingAsSdr }: { viewingAsSdr: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function choose(view: 'manager' | 'sdr') {
    if ((view === 'sdr') === viewingAsSdr) return;
    startTransition(async () => {
      await setDevViewAs(view);
      router.refresh();
    });
  }

  const base = 'rounded px-2 py-1 font-medium transition-colors disabled:opacity-50';
  const active = 'bg-amber-500 text-black';
  const idle = 'text-amber-200 hover:bg-amber-500/20';

  return (
    <div
      className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 flex items-center gap-1 rounded-md border border-amber-500/60 bg-black/85 p-1 text-xs shadow-lg"
      data-testid="dev-view-as-toggle"
    >
      <span className="px-1 text-amber-300">DEV · Ver como:</span>
      <button
        type="button"
        className={`${base} ${viewingAsSdr ? idle : active}`}
        onClick={() => choose('manager')}
        disabled={isPending}
      >
        Gestor
      </button>
      <button
        type="button"
        className={`${base} ${viewingAsSdr ? active : idle}`}
        onClick={() => choose('sdr')}
        disabled={isPending}
      >
        SDR
      </button>
    </div>
  );
}
