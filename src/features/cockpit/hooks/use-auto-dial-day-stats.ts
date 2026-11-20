'use client';

import { useEffect, useState } from 'react';

import type { ActionResult } from '@/lib/actions/action-result';

import type { AutoDialDayStats } from '../services/cockpit-auto-dial-stats.service';

/**
 * Lê o resumo pela rota GET `/api/cockpit/auto-dial-stats`. Não usar a Server Action no navegador: as actions saem
 * em fila, uma por vez, e a leitura atrasaria os botões do motor. `null` em falha de rede ou de leitura.
 */
export async function fetchAutoDialDayStats(): Promise<AutoDialDayStats | null> {
  try {
    const res = await fetch('/api/cockpit/auto-dial-stats', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as ActionResult<AutoDialDayStats>;
    return body.success ? body.data : null;
  } catch {
    return null;
  }
}

/**
 * Resumo do dia do discador. Relê quando `refreshKey` muda (a aba passa uma chave que muda no início e no fim de cada
 * ligação): nada de consulta no relógio. `enabled=false` (simulado ou página de visualização) não consulta nada.
 * Em falha mantém o último número bom; sem nenhum ainda, devolve `null` (a aba não mostra o bloco).
 */
export function useAutoDialDayStats({
  enabled,
  refreshKey,
}: {
  enabled: boolean;
  refreshKey: string;
}): AutoDialDayStats | null {
  const [stats, setStats] = useState<AutoDialDayStats | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetchAutoDialDayStats().then((next) => {
      if (!cancelled && next) setStats(next);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, refreshKey]);

  return enabled ? stats : null;
}
