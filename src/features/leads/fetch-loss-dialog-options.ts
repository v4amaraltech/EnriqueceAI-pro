'use client';

import type { ActionResult } from '@/lib/actions/action-result';

import type { LossReasonRow } from '@/features/settings-prospecting/actions/loss-reasons-crud';

import type { ActiveCadence } from './actions/fetch-active-cadences';

export interface LossDialogOptions {
  lossReasons: ActionResult<LossReasonRow[]>;
  cadences: ActionResult<ActiveCadence[]>;
}

/** Última lista carregada — o modal reabre já com os motivos, sem esperar a rede. */
let cached: { lossReasons: LossReasonRow[]; cadences: ActiveCadence[] } | null = null;

export function getCachedLossDialogOptions() {
  return cached;
}

/** Só para testes. */
export function __resetLossDialogOptionsCache() {
  cached = null;
}

/**
 * Busca motivos de perda e cadências ativas pela rota GET
 * `/api/leads/loss-dialog-options`.
 *
 * Não usar as Server Actions `fetchLossReasons`/`fetchActiveCadences` no
 * navegador: as actions saem em fila, uma por vez, e no Cockpit a lista
 * chegava segundos depois — o dropdown abria vazio. Devolve `null` em falha de
 * rede ou HTTP.
 */
export async function fetchLossDialogOptions(): Promise<LossDialogOptions | null> {
  try {
    const res = await fetch('/api/leads/loss-dialog-options', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as LossDialogOptions;
    if (body.lossReasons.success) {
      cached = {
        lossReasons: body.lossReasons.data,
        cadences: body.cadences.success ? body.cadences.data : (cached?.cadences ?? []),
      };
    }
    return body;
  } catch {
    return null;
  }
}
