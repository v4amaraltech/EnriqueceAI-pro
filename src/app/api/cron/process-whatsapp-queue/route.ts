import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { runTrackedWorker } from '@/lib/workers/worker-run';

import { processWhatsAppQueue } from '@/features/whatsapp-auto-send/services/process-queue.service';

export const maxDuration = 60;

/**
 * Cron (pg_cron, a cada minuto, 8h–18h BRT): WhatsApp automático cadenciado
 * por número do SDR. Story: whatsapp-evolution-paced-sending.
 */
export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runTrackedWorker('process-whatsapp-queue', async () => {
      const data = await processWhatsAppQueue();
      return { success: true as const, data };
    });
    return NextResponse.json({ ok: true, data: result.data });
  } catch (err) {
    console.error('[process-whatsapp-queue] falhou:', err);
    return NextResponse.json({ error: 'Falha ao processar a fila de WhatsApp' }, { status: 500 });
  }
}
