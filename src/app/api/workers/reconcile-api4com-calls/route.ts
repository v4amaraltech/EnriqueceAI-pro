import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { decrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

export const maxDuration = 300;

const DEFAULT_WINDOW_HOURS = 1.5;
const MAX_WINDOW_HOURS = 24;

interface Api4ComCall {
  id?: string;
  // Field names below are best-guess based on the webhook payload — the
  // API4COM REST schema isn't fully documented publicly. The dry-run path
  // returns the raw response so the operator can confirm/adjust before we
  // commit to mappings.
  caller?: string;
  called?: string;
  startedAt?: string;
  duration?: number | string;
  status?: string;
  hangupCause?: string;
  recordUrl?: string;
  direction?: string;
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
  user_id: string;
  ramal: string;
  fetched: number;
  upserted: number;
  skipped: number;
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
 * POST /api/workers/reconcile-api4com-calls
 * Body: { orgId?: string, dryRun?: boolean, windowHours?: number }
 * Auth: Bearer SUPABASE_SERVICE_ROLE_KEY (or cron secret)
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

  const results: OrgResult[] = [];

  for (const conn of conns) {
    const orgResult: OrgResult = {
      org_id: conn.org_id,
      user_id: conn.user_id,
      ramal: conn.ramal,
      fetched: 0,
      upserted: 0,
      skipped: 0,
      errors: [],
    };

    let apiKey: string;
    try {
      apiKey = decrypt(conn.api_key_encrypted);
    } catch (err) {
      orgResult.errors.push(`decrypt_failed: ${err instanceof Error ? err.message : 'unknown'}`);
      results.push(orgResult);
      continue;
    }

    const baseUrl = conn.base_url.replace(/\/+$/, '');
    // Best-guess REST endpoint. If the response is 404 we surface it so the
    // operator can correct the path before we wire the cron.
    const url = new URL(`${baseUrl}/calls`);
    url.searchParams.set('startedAt[gte]', since.toISOString());
    url.searchParams.set('startedAt[lte]', now.toISOString());
    url.searchParams.set('limit', '500');

    let calls: Api4ComCall[] = [];
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const text = await res.text();
        orgResult.errors.push(`http_${res.status}: ${text.slice(0, 200)}`);
        results.push(orgResult);
        continue;
      }

      const json = (await res.json()) as Api4ComCall[] | { data?: Api4ComCall[]; calls?: Api4ComCall[] };
      calls = Array.isArray(json) ? json : (json.data ?? json.calls ?? []);
    } catch (err) {
      orgResult.errors.push(`fetch_failed: ${err instanceof Error ? err.message : 'unknown'}`);
      results.push(orgResult);
      continue;
    }

    orgResult.fetched = calls.length;

    if (dryRun) {
      orgResult.sample = calls.slice(0, 3);
      results.push(orgResult);
      continue;
    }

    for (const c of calls) {
      const api4comId = c.id;
      if (!api4comId) {
        orgResult.skipped++;
        continue;
      }

      try {
        // Match by api4com_call_id stored in metadata
        const { data: existing } = (await from(supabase, 'calls')
          .select('id, status, duration_seconds, recording_url, started_at')
          .eq('org_id', conn.org_id)
          .filter('metadata->>api4com_call_id', 'eq', api4comId)
          .limit(1)
          .maybeSingle()) as {
          data: { id: string; status: string; duration_seconds: number; recording_url: string | null; started_at: string | null } | null;
        };

        const duration = Number(c.duration) || 0;
        const isOutbound = c.direction !== 'inbound';
        // Same status rule the webhook uses
        const derivedStatus = duration >= 50 ? 'significant' : 'no_contact';

        if (existing) {
          // Only update fields the webhook may have missed/diverged on.
          // Never downgrade a status the webhook already promoted to
          // 'significant'.
          const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
          if (!existing.recording_url && c.recordUrl) updates.recording_url = c.recordUrl;
          if (existing.duration_seconds === 0 && duration > 0) updates.duration_seconds = duration;
          if (!existing.started_at && c.startedAt) updates.started_at = c.startedAt;
          if (existing.status === 'not_connected' && duration > 0) updates.status = derivedStatus;

          if (Object.keys(updates).length > 1) {
            await from(supabase, 'calls').update(updates).eq('id', existing.id);
            orgResult.upserted++;
          } else {
            orgResult.skipped++;
          }
        } else {
          // Insert missing call (webhook never arrived)
          await from(supabase, 'calls').insert({
            org_id: conn.org_id,
            user_id: conn.user_id,
            origin: c.caller ?? conn.ramal,
            destination: c.called ?? '',
            started_at: c.startedAt ?? new Date().toISOString(),
            duration_seconds: duration,
            status: duration > 0 ? derivedStatus : 'not_connected',
            type: isOutbound ? 'outbound' : 'inbound',
            recording_url: c.recordUrl ?? null,
            metadata: {
              api4com_call_id: api4comId,
              source: 'reconcile_api4com',
              hangup_cause: c.hangupCause ?? null,
            },
          } as Record<string, unknown>);
          orgResult.upserted++;
        }
      } catch (err) {
        orgResult.errors.push(`call_${api4comId}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
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
