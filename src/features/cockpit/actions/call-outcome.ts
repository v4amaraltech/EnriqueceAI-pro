'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import type { CockpitCallOutcomeResult } from '../types';
import { armCockpitCallOutcome, fetchCockpitCallOutcome } from '../services/call-outcome.service';
import { isCallCockpitOutcomesEnabled, isCallCockpitOutcomesEnabledForAnyScope } from '../services/cockpit-outcomes-flag';

const inputSchema = z.object({ callId: z.string().uuid() });

/**
 * Resultado da ligação para o cartão do cockpit. Com `call_cockpit_outcomes`
 * desligada responde `disabled` sem tocar em dados de ligação.
 */
export async function getCockpitCallOutcome(input: unknown): Promise<ActionResult<CockpitCallOutcomeResult>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  if (!(await isCallCockpitOutcomesEnabledForAnyScope())) return { success: true, data: { status: 'disabled' } };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, role, supabase } = auth.data;
  if (!(await isCallCockpitOutcomesEnabled({ orgId, userId }))) return { success: true, data: { status: 'disabled' } };

  const result = await fetchCockpitCallOutcome(supabase, { orgId, userId, isManager: role === 'manager' }, parsed.data.callId);
  return { success: true, data: result };
}

/**
 * Arma a ligação recém-iniciada pelo cartão para receber resultado e resumo
 * automáticos. Idempotente; com a flag desligada não faz nada.
 */
export async function armCockpitCallOutcomeAction(input: unknown): Promise<ActionResult<{ armed: boolean }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  if (!(await isCallCockpitOutcomesEnabledForAnyScope())) return { success: true, data: { armed: false } };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, role, supabase } = auth.data;
  if (!(await isCallCockpitOutcomesEnabled({ orgId, userId }))) return { success: true, data: { armed: false } };

  const result = await armCockpitCallOutcome(supabase, { orgId, userId, isManager: role === 'manager' }, parsed.data.callId);
  if (result.status === 'not_found') return { success: false, error: 'Ligação não encontrada' };
  if (result.status === 'error') return { success: false, error: 'Falha ao registrar o resultado da ligação' };
  return { success: true, data: { armed: result.status === 'armed' } };
}
