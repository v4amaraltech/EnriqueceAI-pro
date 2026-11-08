'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { fetchUpcomingMeetings } from '../services/upcoming-meetings.service';
import type { UpcomingMeetingsData } from '../types';

const inputSchema = z.object({
  userIds: z.array(z.string().uuid()).default([]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
});

export interface GetUpcomingMeetingsInput {
  userIds: string[];
  startDate: string;
}

/**
 * Bloco "Reuniões futuras" ao lado do gráfico RM/RR. Recebe o filtro de vendedor
 * da página e o 1º dia da janela; dashboard é global para todos os papéis
 * (mesma regra das demais actions do dashboard).
 */
export async function getUpcomingMeetings(
  raw: GetUpcomingMeetingsInput,
): Promise<ActionResult<UpcomingMeetingsData>> {
  const { orgId } = await requireAuthWithMember();
  const supabase = createServiceRoleClient();

  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: 'Parâmetros inválidos' };
  }

  try {
    const data = await fetchUpcomingMeetings(
      supabase,
      orgId,
      { userIds: parsed.data.userIds },
      parsed.data.startDate,
    );
    return { success: true, data };
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'digest' in error &&
      typeof (error as { digest: unknown }).digest === 'string' &&
      ((error as { digest: string }).digest).startsWith('NEXT_REDIRECT')
    ) {
      throw error;
    }
    console.error('[dashboard] getUpcomingMeetings failed:', error);
    return { success: false, error: 'Erro ao buscar as reuniões futuras' };
  }
}
