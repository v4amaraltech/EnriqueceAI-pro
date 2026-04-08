import { NextResponse } from 'next/server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { checkRateLimit } from '@/lib/security/rate-limit';

// 1x1 transparent GIF
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!UUID_REGEX.test(interactionId)) {
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
      .select('metadata')
      .eq('id', interactionId)
      .single()) as { data: { metadata: Record<string, unknown> | null } | null };

    if (interaction) {
      const metadata = interaction.metadata ?? {};
      const openCount = (typeof metadata.open_count === 'number' ? metadata.open_count : 0) + 1;

      await from(supabase, 'interactions')
        .update({ metadata: { ...metadata, open_count: openCount } } as Record<string, unknown>)
        .eq('id', interactionId);

      // Create 'opened' interaction record (only on first open)
      if (openCount === 1) {
        const { data: sent } = (await from(supabase, 'interactions')
          .select('org_id, lead_id, cadence_id, step_id')
          .eq('id', interactionId)
          .single()) as { data: { org_id: string; lead_id: string; cadence_id: string | null; step_id: string | null } | null };

        if (sent) {
          await from(supabase, 'interactions')
            .insert({
              org_id: sent.org_id,
              lead_id: sent.lead_id,
              cadence_id: sent.cadence_id,
              step_id: sent.step_id,
              channel: 'email',
              type: 'opened',
              metadata: { sent_interaction_id: interactionId, open_count: 1 },
            } as Record<string, unknown>);
        }
      }
    }
  } catch (err) {
    console.error('[track/open] Error recording open:', err);
  }

  return new NextResponse(TRANSPARENT_GIF, { status: 200, headers: GIF_HEADERS });
}
