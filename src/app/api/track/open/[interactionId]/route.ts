import { NextResponse } from 'next/server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { marcaEngajamentoReal, segundosAposEnvio } from '@/lib/email/engajamento-real';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { isUuid } from '@/shared/utils/uuid';

// 1x1 transparent GIF
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

const GIF_HEADERS = {
  'Content-Type': 'image/gif',
  'Content-Length': String(TRANSPARENT_GIF.length),
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ interactionId: string }> },
) {
  const { interactionId } = await params;

  // Validate UUID format before querying DB
  if (!isUuid(interactionId)) {
    return new NextResponse(TRANSPARENT_GIF, { status: 200, headers: GIF_HEADERS });
  }

  // Rate limit by interactionId (100 opens per minute per interaction)
  const rl = await checkRateLimit(`track:open:${interactionId}`, 100, 60_000);
  if (!rl.allowed) {
    return new NextResponse(TRANSPARENT_GIF, { status: 200, headers: GIF_HEADERS });
  }

  // Fire-and-forget: don't block the pixel response
  try {
    const supabase = createServiceRoleClient();

    const { data: interaction } = (await from(supabase, 'interactions')
      .select('metadata, created_at')
      .eq('id', interactionId)
      .single()) as { data: { metadata: Record<string, unknown> | null; created_at?: string | null } | null };

    if (interaction) {
      const metadata = interaction.metadata ?? {};
      const openCount = (typeof metadata.open_count === 'number' ? metadata.open_count : 0) + 1;
      // Abertura de robô (filtro de segurança) chega segundos após o envio: só a primeira abertura
      // depois do corte vira aberto_real_em, que é o que os sinais do BDR leem.
      const real = marcaEngajamentoReal(metadata, 'aberto_real_em', interaction.created_at);
      const segundos = segundosAposEnvio(interaction.created_at);

      await from(supabase, 'interactions')
        .update({ metadata: { ...metadata, open_count: openCount, ...(real ?? {}) } } as Record<string, unknown>)
        .eq('id', interactionId);

      // Create 'opened' interaction record (only on first open)
      if (openCount === 1) {
        const { data: sent } = (await from(supabase, 'interactions')
          .select('org_id, lead_id, cadence_id, step_id, metadata')
          .eq('id', interactionId)
          .single()) as { data: { org_id: string; lead_id: string; cadence_id: string | null; step_id: string | null; metadata: Record<string, unknown> | null } | null };

        if (sent) {
          // H1: inherit the A/B variant from the parent 'sent' so the A/B panel can
          // bucket opens correctly (without it, every open fell into variant A).
          const abVariant = sent.metadata?.ab_variant;
          await from(supabase, 'interactions')
            .insert({
              org_id: sent.org_id,
              lead_id: sent.lead_id,
              cadence_id: sent.cadence_id,
              step_id: sent.step_id,
              channel: 'email',
              type: 'opened',
              metadata: {
                sent_interaction_id: interactionId,
                open_count: 1,
                ...(segundos !== null ? { segundos_apos_envio: segundos, automatica: real === null } : {}),
                ...(abVariant ? { ab_variant: abVariant } : {}),
              },
            } as Record<string, unknown>);
        }
      }
    }
  } catch (err) {
    console.error('[track/open] Error recording open:', err);
  }

  return new NextResponse(TRANSPARENT_GIF, { status: 200, headers: GIF_HEADERS });
}
