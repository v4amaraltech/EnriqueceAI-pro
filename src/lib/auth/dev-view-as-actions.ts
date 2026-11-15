'use server';

import { cookies } from 'next/headers';

import type { ActionResult } from '@/lib/actions/action-result';

import { DEV_VIEW_AS_COOKIE, isDevViewAsAvailable } from './dev-view-as';

/** Liga/desliga a visão de SDR no localhost. Recusa fora do `pnpm dev`. */
export async function setDevViewAs(view: 'manager' | 'sdr'): Promise<ActionResult<null>> {
  if (!isDevViewAsAvailable()) {
    return { success: false, error: 'Disponível só no ambiente de desenvolvimento' };
  }
  const store = await cookies();
  if (view === 'sdr') {
    store.set(DEV_VIEW_AS_COOKIE, 'sdr', { path: '/', sameSite: 'lax', httpOnly: true });
  } else {
    store.delete(DEV_VIEW_AS_COOKIE);
  }
  return { success: true, data: null };
}
