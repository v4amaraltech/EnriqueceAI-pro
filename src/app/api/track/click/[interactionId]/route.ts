import { NextResponse } from 'next/server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { checkRateLimit } from '@/lib/security/rate-limit';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ interactionId: string }> },
) {
  const { interactionId } = await params;
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  // Validate URL — only allow http/https to prevent open redirect
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: 'Invalid URL protocol' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  // Validate UUID format before querying DB
  if (!UUID_REGEX.test(interactionId)) {
    return NextResponse.redirect(parsedUrl.href, 302);
  }

  // Rate limit by interactionId (100 clicks per minute per interaction)
  const rl = await checkRateLimit(`track:click:${interactionId}`, 100, 60_000);
  if (!rl.allowed) {
    return NextResponse.redirect(parsedUrl.href, 302);
  }

  // Record click (fire-and-forget — don't block redirect)
  try {
    const supabase = createServiceRoleClient();

    const { data: interaction } = (await from(supabase, 'interactions')
      .select('metadata')
      .eq('id', interactionId)
      .single()) as { data: { metadata: Record<string, unknown> | null } | null };

    if (interaction) {
      const metadata = interaction.metadata ?? {};
      const clicks = Array.isArray(metadata.clicks) ? metadata.clicks : [];
      clicks.push({ url: parsedUrl.href, clicked_at: new Date().toISOString() });

      await from(supabase, 'interactions')
        .update({ metadata: { ...metadata, clicks } } as Record<string, unknown>)
        .eq('id', interactionId);
    }
  } catch (err) {
    console.error('[track/click] Error recording click:', err);
  }

  return NextResponse.redirect(parsedUrl.href, 302);
}
