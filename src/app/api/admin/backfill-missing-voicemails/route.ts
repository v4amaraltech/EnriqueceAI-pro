import { NextResponse } from 'next/server';

import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { decrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { classifyApi4ComCall, getSignificantThreshold } from '@/features/calls/services/api4com-classification';
import { parseApi4ComTimestamp } from '@/features/integrations/services/api4com-time';

export const maxDuration = 300;

/**
 * One-shot backfill of NUMBER_CHANGED voicemails (or any hangup_cause) for a
 * specific org+ramal+window combination using API4COM's Loopback filter
 * directly. Bypasses the regular reconciler's full-domain paginate-and-stop
 * flow, which exits at ~340s SSL drop before reaching the deep pages where
 * the tail-end voicemails live. Filtered fetch returns one to three orders
 * of magnitude fewer pages, so it finishes well inside the function budget.
 *
 * Insert-only: existing rows (matched by primary api4com_call_id, alt_ids,
 * or fallback) are skipped. Use the regular reconcile worker for top-up
 * updates.
 *
 * curl -X POST .../api/admin/backfill-missing-voicemails \
 *   -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
 *   -d '{"orgId":"...","ramals":["1024","1028"],"hangupCause":"NUMBER_CHANGED","sinceIso":"2026-05-01T00:00:00.000Z","untilIso":"2026-05-18T23:59:59.000Z"}'
 */

interface Api4ComCall {
  id?: string;
  call_type?: string;
  started_at?: string;
  ended_at?: string;
  from?: string;
  to?: string;
  duration?: number;
  hangup_cause?: string;
  record_url?: string | null;
}

interface ApiMeta {
  totalPageCount?: number;
  nextPage?: number | null;
}

export async function POST(request: Request) {
  if (!verifyServiceRole(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    orgId?: string;
    ramals?: string[];
    hangupCause?: string;
    sinceIso?: string;
    untilIso?: string;
  };

  if (!body.orgId || !body.ramals?.length || !body.hangupCause || !body.sinceIso || !body.untilIso) {
    return NextResponse.json({ error: 'orgId, ramals, hangupCause, sinceIso, untilIso required' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: connections } = (await from(supabase, 'api4com_connections' as never)
    .select('user_id, ramal, api_key_encrypted, base_url, status')
    .eq('org_id', body.orgId)
    .eq('status', 'connected')
    .not('api_key_encrypted', 'is', null)) as {
    data: Array<{ user_id: string; ramal: string; api_key_encrypted: string; base_url: string }> | null;
  };

  if (!connections?.length) {
    return NextResponse.json({ error: 'No connections' }, { status: 404 });
  }

  const ramalToUserId = new Map(connections.map((c) => [c.ramal, c.user_id]));
  const conn = connections[0]!;

  let apiKey: string;
  try {
    apiKey = decrypt(conn.api_key_encrypted);
  } catch (err) {
    return NextResponse.json({ error: `decrypt: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 500 });
  }

  const baseUrl = conn.base_url.replace(/\/+$/, '');
  const significantThresholdSeconds = await getSignificantThreshold(supabase, body.orgId);

  const perRamalResult: Array<{ ramal: string; fetched: number; inserted: number; reclassified: number; matched: number; errors: number }> = [];

  for (const ramal of body.ramals) {
    const userId = ramalToUserId.get(ramal);
    if (!userId) {
      perRamalResult.push({ ramal, fetched: 0, inserted: 0, reclassified: 0, matched: 0, errors: 1 });
      continue;
    }

    const filterPayload = JSON.stringify({
      where: {
        from: ramal,
        hangup_cause: body.hangupCause,
        started_at: { gte: body.sinceIso, lte: body.untilIso },
      },
    });

    let fetched = 0;
    let inserted = 0;
    let matched = 0;
    let reclassified = 0;
    let errors = 0;
    let totalPageCount: number | null = null;

    pageLoop: for (let page = 1; page <= 50; page++) {
      const url = new URL(`${baseUrl}/calls`);
      url.searchParams.set('filter', filterPayload);
      url.searchParams.set('page', String(page));

      let pageCalls: Api4ComCall[] = [];
      try {
        const res = await fetch(url.toString(), {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', Authorization: apiKey },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          errors++;
          break pageLoop;
        }
        const json = (await res.json()) as Api4ComCall[] | { data?: Api4ComCall[]; meta?: ApiMeta };
        if (Array.isArray(json)) {
          pageCalls = json;
        } else {
          pageCalls = json.data ?? [];
          const meta = json.meta;
          if (meta?.totalPageCount != null) totalPageCount = meta.totalPageCount;
          if (meta?.nextPage === null) totalPageCount = page;
        }
      } catch {
        errors++;
        break pageLoop;
      }

      for (const c of pageCalls) {
        if (!c.id) continue;
        fetched++;

        const realDate = parseApi4ComTimestamp(c.started_at);
        if (!realDate) continue;
        c.started_at = realDate.toISOString();

        // Primary id lookup — reclassify hangup_cause if DB diverges from API.
        const { data: primary } = (await from(supabase, 'calls')
          .select('id, hangup_cause')
          .eq('org_id', body.orgId)
          .filter('metadata->>api4com_call_id', 'eq', c.id)
          .limit(1)
          .maybeSingle()) as { data: { id: string; hangup_cause: string | null } | null };
        if (primary) {
          if (c.hangup_cause && primary.hangup_cause !== c.hangup_cause) {
            await from(supabase, 'calls')
              .update({ hangup_cause: c.hangup_cause, updated_at: new Date().toISOString() } as Record<string, unknown>)
              .eq('id', primary.id);
            reclassified++;
          } else {
            matched++;
          }
          continue;
        }

        // Alt-id lookup — same reclassify logic.
        const { data: alt } = (await from(supabase, 'calls')
          .select('id, hangup_cause')
          .eq('org_id', body.orgId)
          .contains('metadata', { alt_api4com_ids: [c.id] })
          .limit(1)
          .maybeSingle()) as { data: { id: string; hangup_cause: string | null } | null };
        if (alt) {
          if (alt.hangup_cause === null || alt.hangup_cause === c.hangup_cause) {
            matched++;
            continue;
          }
          // Alt-id row has divergent hangup. Phase 5 gate would reject this
          // as a match — so we should INSERT a new row, not reclassify the
          // (probably unrelated) row whose alt_ids happens to include this id.
          // Fall through to insert.
        }

        // INSERT
        const duration = Number(c.duration) || 0;
        const isOutbound = c.call_type !== 'inbound';
        const classification = classifyApi4ComCall({
          answeredAt: null,
          hangupCause: c.hangup_cause ?? null,
          durationSeconds: duration,
          significantThresholdSeconds,
        });

        try {
          await from(supabase, 'calls').insert({
            org_id: body.orgId,
            user_id: userId,
            origin: c.from ?? ramal,
            destination: c.to ?? '',
            started_at: c.started_at ?? new Date().toISOString(),
            duration_seconds: duration,
            status: duration > 0 ? classification.status : 'not_connected',
            connected: classification.connected,
            hangup_cause: c.hangup_cause ?? null,
            type: isOutbound ? 'outbound' : 'inbound',
            recording_url: c.record_url ?? null,
            metadata: {
              api4com_call_id: c.id,
              source: 'backfill_missing_voicemails',
              hangup_cause: c.hangup_cause ?? null,
              call_type: c.call_type ?? null,
            },
          } as Record<string, unknown>);
          inserted++;
        } catch {
          errors++;
        }
      }

      if (totalPageCount !== null && page >= totalPageCount) break;
      if (pageCalls.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    perRamalResult.push({ ramal, fetched, inserted, reclassified, matched, errors });
  }

  return NextResponse.json({
    org_id: body.orgId,
    window: { since: body.sinceIso, until: body.untilIso },
    hangup_cause: body.hangupCause,
    results: perRamalResult,
  });
}
