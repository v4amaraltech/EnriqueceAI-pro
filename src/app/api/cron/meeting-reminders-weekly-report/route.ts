import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { runWeeklyReport } from '@/features/meeting-reminders/services/weekly-report.service';

export const maxDuration = 60;

/**
 * Cron semanal (segunda 09h BRT): relatório de comparecimento de reuniões vs
 * exposição aos lembretes, enviado por email aos managers de cada org com a
 * automação de meeting-reminders ativa. Somente leitura + envio de email.
 */
export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runWeeklyReport();
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, data: result.data });
  } catch (err) {
    console.error('[weekly-report] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
