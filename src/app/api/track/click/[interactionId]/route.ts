import { NextResponse } from 'next/server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { isUuid } from '@/shared/utils/uuid';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ interactionId: string }> },
) {
  const { interactionId } = await params;
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  // Validate URL — only allow http/https
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

  // M1: an invalid interaction id can't be a real tracking link — refuse to
  // redirect (previously this redirected to any ?url=, an open-redirect / phishing
  // vector that abused the platform's trusted domain).
  if (!isUuid(interactionId)) {
    return NextResponse.json({ error: 'Invalid tracking link' }, { status: 400 });
  }

  // Rate limit by interactionId (100 clicks per minute per interaction)
  const rl = await checkRateLimit(`track:click:${interactionId}`, 100, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const supabase = createServiceRoleClient();
  type TrackedInteraction = {
    metadata: Record<string, unknown> | null;
    message_content: string | null;
    org_id: string;
    lead_id: string;
    cadence_id: string | null;
    step_id: string | null;
  };
  let interaction: TrackedInteraction | null = null;
  try {
    const { data } = (await from(supabase, 'interactions')
      .select('metadata, message_content, org_id, lead_id, cadence_id, step_id')
      .eq('id', interactionId)
      .single()) as { data: TrackedInteraction | null };
    interaction = data;
  } catch (err) {
    // M1: fail closed — if we can't validate the link, don't redirect.
    console.error('[track/click] Error validating tracking link:', err);
    return NextResponse.json({ error: 'Could not validate tracking link' }, { status: 502 });
  }

  // M1: only follow URLs that actually appeared in the email we sent. This closes
  // the open redirect — an attacker can't point ?url= at an arbitrary site because
  // it won't match the stored body of a real interaction. message_content holds the
  // ORIGINAL urls (click tracking is injected onto a copy at send time), so the raw
  // ?url= value (pre-redirect) is what we match against. Legacy links keep working.
  if (!interaction || !interaction.message_content || !interaction.message_content.includes(url)) {
    return NextResponse.json({ error: 'Invalid tracking link' }, { status: 400 });
  }

  // Record click (best-effort — don't block the redirect on a write error)
  try {
    const metadata = interaction.metadata ?? {};
    const clicks = Array.isArray(metadata.clicks) ? metadata.clicks : [];
    const isFirstClick = clicks.length === 0;
    clicks.push({ url: parsedUrl.href, clicked_at: new Date().toISOString() });

    await from(supabase, 'interactions')
      .update({ metadata: { ...metadata, clicks } } as Record<string, unknown>)
      .eq('id', interactionId);

    // Create 'clicked' interaction record (only on first click)
    if (isFirstClick) {
      // H1: inherit the A/B variant so click metrics attribute to the right variant.
      const abVariant = interaction.metadata?.ab_variant;
      await from(supabase, 'interactions')
        .insert({
          org_id: interaction.org_id,
          lead_id: interaction.lead_id,
          cadence_id: interaction.cadence_id,
          step_id: interaction.step_id,
          channel: 'email',
          type: 'clicked',
          metadata: {
            sent_interaction_id: interactionId,
            url: parsedUrl.href,
            ...(abVariant ? { ab_variant: abVariant } : {}),
          },
        } as Record<string, unknown>);
    }
  } catch (err) {
    console.error('[track/click] Error recording click:', err);
  }

  return NextResponse.redirect(parsedUrl.href, 302);
}
