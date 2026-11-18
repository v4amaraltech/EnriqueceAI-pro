import { NextResponse } from 'next/server';

import { fetchActiveCadences } from '@/features/leads/actions/fetch-active-cadences';
import { fetchLossReasons } from '@/features/leads/actions/lead-lifecycle';

export const dynamic = 'force-dynamic';

/**
 * Listas do modal "Desqualificar lead": motivos de perda e cadências ativas.
 *
 * É rota GET, e não Server Action, de propósito: o Next manda as Server
 * Actions uma de cada vez, em fila. No Cockpit/discador há consultas por action
 * rodando o tempo todo, e a lista de motivos chegava segundos depois do modal
 * abrir — o dropdown abria vazio e parecia não responder ao clique.
 * Rota comum não entra na fila. A lógica (auth + filtro por org) é a mesma.
 */
export async function GET() {
  const [lossReasons, cadences] = await Promise.all([fetchLossReasons(), fetchActiveCadences()]);
  return NextResponse.json({ lossReasons, cadences }, { headers: { 'Cache-Control': 'no-store' } });
}
