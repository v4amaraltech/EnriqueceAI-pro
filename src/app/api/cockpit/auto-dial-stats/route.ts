import { NextResponse } from 'next/server';

import { getAutoDialDayStatsAction } from '@/features/cockpit/actions/auto-dial-stats';

export const dynamic = 'force-dynamic';

/**
 * Resumo do dia do discador (ligações do motor, conversas, taxa e quanto falta para o teto) do usuário logado.
 *
 * É rota GET, e não Server Action, de propósito: o Next manda as Server Actions uma de cada vez, em fila. A aba
 * Discador relê isto a cada ligação; como action, a leitura ficaria na frente dos botões do motor. A lógica
 * (auth + filtro por org e usuário) é a mesma da action.
 */
export async function GET() {
  const result = await getAutoDialDayStatsAction();
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
