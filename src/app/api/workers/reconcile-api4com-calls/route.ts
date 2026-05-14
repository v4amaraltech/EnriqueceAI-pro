import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { decrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

export const maxDuration = 300;

const DEFAULT_WINDOW_HOURS = 1.5;
// Cron uses the default 1.5h. The cap is meant to keep backfills from
// stretching the rate-limit budget too far: 60 days is enough to cover
// the original "API4COM webhook was leaking ~40% of calls" problem
// without anyone accidentally requesting "last 5 years".
const MAX_WINDOW_HOURS = 1440;
// API4COM ignores client-side pageSize and returns 100 per page by default.
// Use 100 as the expected size so the pagination loop knows when to stop.
const EXPECTED_PAGE_SIZE = 100;
const MAX_PAGES = 100; // 100 * 100 = 10k calls per org per window
const PAGE_DELAY_MS = 800; // be conservative — API4COM throttles per minute
const RATE_LIMIT_RETRY_MS = 12_000; // single retry covers a short hiccup
const MAX_RATE_LIMIT_RETRIES = 1;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// API4COM REST schema (confirmed via dry-run 2026-05-13). Snake_case fields
// and `call_type` instead of `direction`.
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
  email?: string;
  metadata?: Record<string, unknown>;
}

interface ConnRow {
  id: string;
  org_id: string;
  user_id: string;
  ramal: string;
  base_url: string;
  api_key_encrypted: string;
  status: string;
}

interface OrgResult {
  org_id: string;
  ramals_mapped: number;
  fetched: number;
  in_scope: number; // = fetched - skipped_unmapped (calls that belong to Enriquece SDRs)
  upserted_existing: number;
  inserted_new: number;
  skipped_unmapped: number;
  unmapped_ramals?: Record<string, number>; // dry-run only — diagnostic for the operator
  errors: string[];
  sample?: Api4ComCall[];
}

/**
 * Hourly reconciliation worker for API4COM calls.
 *
 * Pulls every call in the last `windowHours` from API4COM directly and
 * upserts into the `calls` table. Closes the gap left by the webhook-only
 * model: dropped webhooks, retroactive calls, status corrections.
 *
 * Pull strategy: ONE request per org (the API4COM /calls endpoint returns
 * every call in the domain regardless of which ramal's API key is used).
 * The `from` field on each call is mapped to user_id via the dictionary
 * built from all api4com_connections rows for the org.
 */
export async function POST(request: Request) {
  if (!verifyServiceRole(request) && !verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    orgId?: string;
    dryRun?: boolean;
    windowHours?: number;
  };

  const dryRun = body.dryRun === true;
  const windowHours = Math.min(Math.max(body.windowHours ?? DEFAULT_WINDOW_HOURS, 0.25), MAX_WINDOW_HOURS);
  const now = new Date();
  const since = new Date(now.getTime() - windowHours * 3600 * 1000);

  const supabase = createServiceRoleClient();

  let connsQuery = from(supabase, 'api4com_connections' as never)
    .select('id, org_id, user_id, ramal, base_url, api_key_encrypted, status')
    .eq('status', 'connected')
    .not('api_key_encrypted', 'is', null);

  if (body.orgId) {
    connsQuery = connsQuery.eq('org_id', body.orgId);
  }

  const { data: connsRaw } = (await connsQuery) as { data: ConnRow[] | null };
  const conns = connsRaw ?? [];

  if (conns.length === 0) {
    return NextResponse.json({ message: 'No connected API4COM accounts', orgs: [] });
  }

  // Group connections by org so we pull once per org, not once per ramal.
  const byOrg = new Map<string, ConnRow[]>();
  for (const c of conns) {
    const list = byOrg.get(c.org_id) ?? [];
    list.push(c);
    byOrg.set(c.org_id, list);
  }

  const results: OrgResult[] = [];

  for (const [orgId, orgConns] of byOrg) {
    const ramalToUserId = new Map<string, string>();
    for (const c of orgConns) {
      if (c.ramal) ramalToUserId.set(c.ramal, c.user_id);
    }

    const orgResult: OrgResult = {
      org_id: orgId,
      ramals_mapped: ramalToUserId.size,
      fetched: 0,
      in_scope: 0,
      upserted_existing: 0,
      inserted_new: 0,
      skipped_unmapped: 0,
      errors: [],
    };
    const unmappedRamalCounts: Record<string, number> = {};

    // Use the first connection's API key for the pull. Any key from the org
    // works because /calls returns the whole domain.
    const conn = orgConns[0]!;
    let apiKey: string;
    try {
      apiKey = decrypt(conn.api_key_encrypted);
    } catch (err) {
      orgResult.errors.push(`decrypt_failed: ${err instanceof Error ? err.message : 'unknown'}`);
      results.push(orgResult);
      continue;
    }

    const baseUrl = conn.base_url.replace(/\/+$/, '');
    const calls: Api4ComCall[] = [];

    pageLoop: for (let page = 1; page <= MAX_PAGES; page++) {
      const url = new URL(`${baseUrl}/calls`);
      url.searchParams.set('started_at[gte]', since.toISOString());
      url.searchParams.set('started_at[lte]', now.toISOString());
      url.searchParams.set('page', String(page));

      let pageCalls: Api4ComCall[] = [];
      let succeeded = false;

      // Retry on 429 with backoff. Surfaces final failure after the cap.
      for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
        try {
          const res = await fetch(url.toString(), {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              Authorization: apiKey,
            },
            signal: AbortSignal.timeout(30_000),
          });

          if (res.status === 429) {
            if (attempt === MAX_RATE_LIMIT_RETRIES) {
              orgResult.errors.push(`http_429 page=${page}: rate limit persisted after ${MAX_RATE_LIMIT_RETRIES} retries`);
              break pageLoop;
            }
            await sleep(RATE_LIMIT_RETRY_MS * (attempt + 1));
            continue;
          }

          if (!res.ok) {
            const text = await res.text();
            orgResult.errors.push(`http_${res.status} page=${page}: ${text.slice(0, 200)}`);
            break pageLoop;
          }

          const json = (await res.json()) as Api4ComCall[] | { data?: Api4ComCall[]; calls?: Api4ComCall[] };
          pageCalls = Array.isArray(json) ? json : (json.data ?? json.calls ?? []);
          succeeded = true;
          break;
        } catch (err) {
          orgResult.errors.push(`fetch_failed page=${page}: ${err instanceof Error ? err.message : 'unknown'}`);
          break pageLoop;
        }
      }

      if (!succeeded) break;

      // API4COM returns calls in reverse chronological order and silently
      // ignores started_at[gte] in production (dry-run on 2026-05-13 with
      // windowHours=1.5 returned calls from 7+ hours earlier). Filter
      // client-side and stop paginating once we see anything older than
      // `since` — every subsequent page is older still.
      const sinceMs = since.getTime();
      const untilMs = now.getTime();
      let sawOlderThanWindow = false;

      for (const c of pageCalls) {
        const tsStr = c.started_at;
        if (!tsStr) continue;
        const ts = new Date(tsStr).getTime();
        if (Number.isNaN(ts)) continue;
        if (ts < sinceMs) {
          sawOlderThanWindow = true;
          continue;
        }
        if (ts > untilMs) continue; // unlikely but defensive
        calls.push(c);
      }

      // Stop on empty page, short page (true end of data), or when we've
      // crossed past the window's lower bound.
      if (pageCalls.length === 0 || pageCalls.length < EXPECTED_PAGE_SIZE || sawOlderThanWindow) {
        break;
      }

      // Throttle: stay under the per-minute call cap.
      await sleep(PAGE_DELAY_MS);
    }

    orgResult.fetched = calls.length;

    if (dryRun) {
      orgResult.sample = calls.slice(0, 3);
      // Still tally unmapped ramals for diagnostics, just don't write.
      for (const c of calls) {
        if (!c.from || !ramalToUserId.has(c.from)) {
          orgResult.skipped_unmapped++;
          const ramalKey = c.from ?? '<no-from>';
          unmappedRamalCounts[ramalKey] = (unmappedRamalCounts[ramalKey] ?? 0) + 1;
        }
      }
      orgResult.in_scope = Math.max(0, orgResult.fetched - orgResult.skipped_unmapped);
      if (Object.keys(unmappedRamalCounts).length > 0) {
        orgResult.unmapped_ramals = unmappedRamalCounts;
      }
      results.push(orgResult);
      continue;
    }

    for (const c of calls) {
      const api4comId = c.id;
      if (!api4comId) {
        orgResult.skipped_unmapped++;
        continue;
      }

      const userId = c.from ? ramalToUserId.get(c.from) : undefined;
      if (!userId) {
        // The org has connections for some ramals but this call came from a
        // ramal that's not mapped to a user in Enriquece. Skip — we don't
        // know who to attribute it to. Track the unmapped ramal so the
        // operator can decide whether to wire it up.
        orgResult.skipped_unmapped++;
        const ramalKey = c.from ?? '<no-from>';
        unmappedRamalCounts[ramalKey] = (unmappedRamalCounts[ramalKey] ?? 0) + 1;
        continue;
      }

      try {
        const { data: existing } = (await from(supabase, 'calls')
          .select('id, status, duration_seconds, recording_url, started_at')
          .eq('org_id', orgId)
          .filter('metadata->>api4com_call_id', 'eq', api4comId)
          .limit(1)
          .maybeSingle()) as {
          data: { id: string; status: string; duration_seconds: number; recording_url: string | null; started_at: string | null } | null;
        };

        const duration = Number(c.duration) || 0;
        const isOutbound = c.call_type !== 'inbound';
        // Same rule used by the webhook: 50s = connected & significant.
        const derivedStatus = duration >= 50 ? 'significant' : 'no_contact';

        if (existing) {
          // Top up fields the webhook may have missed/diverged on. Never
          // downgrade a status the webhook already promoted to 'significant'.
          const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
          if (!existing.recording_url && c.record_url) updates.recording_url = c.record_url;
          if (existing.duration_seconds === 0 && duration > 0) updates.duration_seconds = duration;
          if (!existing.started_at && c.started_at) updates.started_at = c.started_at;
          if (existing.status === 'not_connected' && duration > 0) updates.status = derivedStatus;

          if (Object.keys(updates).length > 1) {
            await from(supabase, 'calls').update(updates).eq('id', existing.id);
            orgResult.upserted_existing++;
          }
        } else {
          // Insert missing call (webhook never arrived).
          await from(supabase, 'calls').insert({
            org_id: orgId,
            user_id: userId,
            origin: c.from ?? '',
            destination: c.to ?? '',
            started_at: c.started_at ?? new Date().toISOString(),
            duration_seconds: duration,
            status: duration > 0 ? derivedStatus : 'not_connected',
            type: isOutbound ? 'outbound' : 'inbound',
            recording_url: c.record_url ?? null,
            metadata: {
              api4com_call_id: api4comId,
              source: 'reconcile_api4com',
              hangup_cause: c.hangup_cause ?? null,
            },
          } as Record<string, unknown>);
          orgResult.inserted_new++;
        }
      } catch (err) {
        orgResult.errors.push(`call_${api4comId}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }

    orgResult.in_scope = Math.max(0, orgResult.fetched - orgResult.skipped_unmapped);

    // unmapped_ramals is a diagnostic for the operator running dry-runs;
    // surfacing it in cron logs hourly would just create noise.
    if (dryRun && Object.keys(unmappedRamalCounts).length > 0) {
      orgResult.unmapped_ramals = unmappedRamalCounts;
    }

    results.push(orgResult);
  }

  return NextResponse.json({
    windowHours,
    since: since.toISOString(),
    until: now.toISOString(),
    dryRun,
    orgs: results,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
