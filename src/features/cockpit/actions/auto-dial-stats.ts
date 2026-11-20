'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { createServiceRoleClient } from '@/lib/supabase/service';

import {
  type AutoDialDayStats,
  getAutoDialDayStats,
} from '../services/cockpit-auto-dial-stats.service';

/** Sem parâmetros: o alvo é SEMPRE o usuário autenticado (gestor também), nunca vem do navegador. */
const inputSchema = z.object({}).strict();

/** Resumo do dia do motor (ligações, conversas reais, taxa e quanto falta para o teto). Só leitura. */
export async function getAutoDialDayStatsAction(
  input?: unknown,
): Promise<ActionResult<AutoDialDayStats>> {
  const parsed = inputSchema.safeParse(input ?? {});
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId } = auth.data;

  const stats = await getAutoDialDayStats(createServiceRoleClient(), orgId, userId, new Date());
  if (!stats) return { success: false, error: 'Falha ao ler o resumo do dia' };
  return { success: true, data: stats };
}
