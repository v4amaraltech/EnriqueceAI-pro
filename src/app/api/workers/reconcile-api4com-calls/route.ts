import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { triggerHangupCrmShadow } from '@/features/calls/services/crm-auto-update/hangup-shadow.service';
import { mergeCallsMetadata, metadataPatchFrom } from '@/features/calls/services/merge-calls-metadata';
import {
  classifyApi4ComCall,
  getSignificantThreshold,
} from '@/features/calls/services/api4com-classification';
import {
  parseApi4ComTimestamp,
  toApi4ComFilterTimestamp,
} from '@/features/integrations/services/api4com-time';
import {
  groupCallsForReconcile,
  reconcileInsertMetadata,
  reconcileLinkMetadata,
  resolveReconcileMatch,
} from '@/features/integrations/services/api4com-reconcile-matching';
import { getOrgApiCredentials } from '@/features/integrations/services/api4com.service';
import { getApi4ComCallsLimiter } from '@/features/integrations/services/api4com-rate-limit';
import {
  RECONCILE_MAX_RATE_LIMIT_RETRIES,
  fetchReconcileCallsPage,
} from '@/features/integrations/services/api4com-reconcile-fetch';

export const maxDuration = 800;

const JOB_NAME = 'reconcile-api4com-calls';
const DEFAULT_WINDOW_HOURS = 1.5;
const ADAPTIVE_OVERLAP_HOURS = 0.5;
// Cron uses the default 1.5h. The cap is meant to keep backfills from
// stretching the rate-limit budget too far: 60 days is enough to cover
// the original "API4COM webhook was leaking ~40% of calls" problem
// without anyone accidentally requesting "last 5 years".
const MAX_WINDOW_HOURS = 1440;
const MAX_PAGES = 100; // 100 pages × ~100 calls = 10k calls per org per window
// Limite de taxa: o teto oficial da API4COM é 15 GET /calls por minuto por
// token. Cada página passa pelo limitador do token (getApi4ComCallsLimiter,
// janela deslizante) e o 429 respeita RateLimit-Reset / Retry-After; ver
// fetchReconcileCallsPage. Não há mais pausa fixa entre páginas.
// Batch size for parallel upserts within one fetched page. The Supabase
// pooler comfortably handles 10 concurrent queries; bigger batches don't
// proportionally speed up since each upsert is dominated by a single round
// trip to PostgREST.
const UPSERT_CONCURRENCY = 10;
// Rows fetched per fallback lookup. SDRs rarely redial the same number more
// than a handful of times within ±10min; 25 leaves plenty of headroom.
const FALLBACK_CANDIDATE_LIMIT = 25;
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
  api_key_encrypted: string | null;
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
  const now = new Date();
  const supabase = createServiceRoleClient();

  // Adaptive windowing: when the caller doesn't pin windowHours (typical for
  // the cron), compute it from the last successful run + an overlap. This
  // way if Vercel paused or pg_cron missed a few cycles, the next run
  // catches everything the gap dropped — instead of permanently leaking the
  // hours between (last_success + 1.5h) and now.
  let windowHours: number = DEFAULT_WINDOW_HOURS;
  if (body.windowHours != null) {
    windowHours = Math.min(Math.max(body.windowHours, 0.25), MAX_WINDOW_HOURS);
  } else {
    // Adaptive lookup — never let it break the cron. The 2026-05-14 cron
    // hit a 500 here ("(0 , E.from)(...)") even though the table existed;
    // suspect a PostgREST schema-cache miss on the newly created table.
    // Falls back to the static default if anything goes wrong.
    try {
      const { data: lastRun } = (await from(supabase, 'worker_run_state' as never)
        .select('last_success_at')
        .eq('job_name', JOB_NAME)
        .maybeSingle()) as { data: { last_success_at: string | null } | null };

      if (lastRun?.last_success_at) {
        const hoursSinceLastSuccess = (now.getTime() - new Date(lastRun.last_success_at).getTime()) / 3_600_000;
        windowHours = Math.min(
          Math.max(hoursSinceLastSuccess + ADAPTIVE_OVERLAP_HOURS, DEFAULT_WINDOW_HOURS),
          MAX_WINDOW_HOURS,
        );
      }
    } catch (err) {
      console.warn('[reconcile-api4com] adaptive window lookup failed, using default:', err);
    }
  }

  const since = new Date(now.getTime() - windowHours * 3600 * 1000);

  // Every connected ramal maps to a user, even without a legacy per-user token:
  // the credential for the pull comes from the org (`getOrgApiCredentials`).
  let connsQuery = from(supabase, 'api4com_connections' as never)
    .select('id, org_id, user_id, ramal, base_url, api_key_encrypted, status')
    .eq('status', 'connected');

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

    // One credential per org for the pull (org token, else the first legacy
    // user token). Any key of the account works because /calls returns the
    // whole domain.
    let apiKey: string;
    let baseUrl: string;
    try {
      const creds = await getOrgApiCredentials(orgId, supabase);
      if (!creds) {
        orgResult.errors.push('no_credentials: org has no API4COM token');
        results.push(orgResult);
        continue;
      }
      apiKey = creds.apiKey;
      baseUrl = creds.baseUrl;
    } catch (err) {
      orgResult.errors.push(`decrypt_failed: ${err instanceof Error ? err.message : 'unknown'}`);
      results.push(orgResult);
      continue;
    }
    const calls: Api4ComCall[] = [];
    // Limitador compartilhado do token (15/min), o mesmo do reparo de gravações.
    const limiter = getApi4ComCallsLimiter(apiKey);

    // Fetch once per org — we'll thread the org's threshold into the
    // classifier instead of running the old hardcoded 50s gate.
    const significantThresholdSeconds = await getSignificantThreshold(supabase, orgId);

    // Set by API4COM's paginated response metadata. Used as the definitive
    // stop condition; remains null only if the API never returns metadata
    // (legacy/raw-array responses) — in that case we fall back to the
    // window/empty-page heuristics.
    let totalPageCount: number | null = null;

    // API4COM REST uses Loopback-style filtering, confirmed by support on
    // 2026-05-18 after the gap investigation: `?filter={"where":{...}}`
    // URL-encoded JSON. The prior `?started_at[gte]=...` syntax was silently
    // ignored — that's why mai/2026 V4 Amaral had 155 voicemails (and other
    // missing causes) hiding past the MAX_PAGES horizon. With the filter
    // honoured by the server, paginação enumera SÓ a janela e não a domain
    // inteira em reverse-chrono.
    // The bounds must be in API4COM's BRT-disguised-as-Z clock, not real
    // UTC — otherwise the window lands 3h in the future and comes back empty.
    const filterPayload = JSON.stringify({
      where: {
        started_at: {
          gte: toApi4ComFilterTimestamp(since),
          lte: toApi4ComFilterTimestamp(now),
        },
      },
    });

    pageLoop: for (let page = 1; page <= MAX_PAGES; page++) {
      const url = new URL(`${baseUrl}/calls`);
      url.searchParams.set('filter', filterPayload);
      url.searchParams.set('page', String(page));

      let pageCalls: Api4ComCall[] = [];
      let succeeded = false;

      // Vaga no limitador antes de cada GET; 429 pausa o token e repete.
      const fetched = await fetchReconcileCallsPage(
        { fetchFn: fetch, limiter },
        url.toString(),
        apiKey,
      );

      if (fetched.kind === 'fetch_failed') {
        orgResult.errors.push(`fetch_failed page=${page}: ${fetched.error.message}`);
        break pageLoop;
      }
      if (fetched.kind === 'rate_limited') {
        orgResult.errors.push(
          `http_429 page=${page}: rate limit persisted after ${RECONCILE_MAX_RATE_LIMIT_RETRIES} retries`,
        );
        break pageLoop;
      }

      const res = fetched.response;
      try {
        if (!res.ok) {
          const text = await res.text();
          orgResult.errors.push(`http_${res.status} page=${page}: ${text.slice(0, 200)}`);

          // Auth failure: mark the connection broken so the manager gets a
          // visible signal in the integrations UI. Without this an expired
          // API key just makes the reconcile silently log errors forever.
          // The credential is the org's, so every ramal of the org is affected.
          if (res.status === 401 || res.status === 403) {
            await from(supabase, 'api4com_connections' as never)
              .update({ status: 'error' } as Record<string, unknown>)
              .eq('org_id', orgId)
              .eq('status', 'connected');
          }

          break pageLoop;
        }

        type ApiMeta = { totalPageCount?: number; currentPage?: number; nextPage?: number | null };
        const json = (await res.json()) as
          | Api4ComCall[]
          | { data?: Api4ComCall[]; calls?: Api4ComCall[]; meta?: ApiMeta; metadata?: ApiMeta };
        if (Array.isArray(json)) {
          pageCalls = json;
        } else {
          pageCalls = json.data ?? json.calls ?? [];
          // API4COM returns the pagination object as `meta` (confirmed via
          // probe 2026-05-18). Older docs called it `metadata`, so keep both
          // paths so legacy responses still parse.
          const meta = json.meta ?? json.metadata;
          if (meta?.totalPageCount != null) {
            totalPageCount = meta.totalPageCount;
          }
          if (meta?.nextPage === null) {
            // Last page reached, same effect as totalPageCount === page,
            // but explicit signal from API. Used as definitive stop.
            totalPageCount = page;
          }
        }
        succeeded = true;
      } catch (err) {
        orgResult.errors.push(`fetch_failed page=${page}: ${err instanceof Error ? err.message : 'unknown'}`);
        break pageLoop;
      }

      if (!succeeded) break;

      // Defense-in-depth: server filter (Loopback `where.started_at`) is
      // authoritative since 2026-05-18, but keep the client-side window
      // check so a malformed/loosened filter doesn't silently re-introduce
      // out-of-window rows. parseApi4ComTimestamp also normalises the
      // BRT-disguised-as-Z stamps API4COM emits.
      const sinceMs = since.getTime();
      const untilMs = now.getTime();
      let sawOlderThanWindow = false;

      for (const c of pageCalls) {
        // parseApi4ComTimestamp handles API4COM's BRT-disguised-as-Z stamps.
        const realDate = parseApi4ComTimestamp(c.started_at);
        if (!realDate) continue;
        const ts = realDate.getTime();
        if (ts < sinceMs) {
          sawOlderThanWindow = true;
          continue;
        }
        if (ts > untilMs) continue;
        // Normalize started_at to the real UTC representation before any
        // downstream comparison/insert.
        c.started_at = realDate.toISOString();
        calls.push(c);
      }

      // Stop conditions, in order of authority:
      //   1. Window crossed (calls older than `since`) — every subsequent
      //      page is older still by the API's reverse-chrono ordering.
      //   2. totalPageCount from API metadata — definitive end of dataset.
      //   3. Empty page — no more results, regardless of metadata.
      //
      // We DON'T use `pageCalls.length < EXPECTED_PAGE_SIZE` as a stop
      // condition anymore (was causing ~19% gap in mai/2026): if API4COM
      // returned a momentarily short page mid-pull (e.g. race with new
      // calls), we'd bail out before reaching real end-of-data.
      if (sawOlderThanWindow) break;
      if (totalPageCount !== null && page >= totalPageCount) break;
      if (pageCalls.length === 0) break;
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

    // Process calls in concurrent batches. Sequential processing was the
    // single biggest contributor to the 504 timeouts on long reingests: at
    // ~150ms per call (1-2 round trips to PostgREST + an upsert), 4k+ calls
    // serially run over 600s. Promise.all across batches of UPSERT_CONCURRENCY
    // cuts that to ~60s on the same dataset.
    type CallOutcome =
      | { kind: 'inserted_new' }
      | { kind: 'upserted_existing' }
      | { kind: 'matched_no_update' }
      | { kind: 'skipped_no_id' }
      | { kind: 'skipped_unmapped'; ramal: string }
      | { kind: 'error'; api4comId: string; message: string };

    async function processOneCall(c: Api4ComCall): Promise<CallOutcome> {
      const api4comId = c.id;
      if (!api4comId) return { kind: 'skipped_no_id' };

      const userId = c.from ? ramalToUserId.get(c.from) : undefined;
      if (!userId) {
        return { kind: 'skipped_unmapped', ramal: c.from ?? '<no-from>' };
      }

      try {
        type CallLookupRow = { id: string; status: string; connected: boolean; duration_seconds: number; recording_url: string | null; started_at: string | null; hangup_cause: string | null; metadata: Record<string, unknown> | null };
        const SELECT_COLS = 'id, status, connected, duration_seconds, recording_url, started_at, hangup_cause, metadata';

        const one = async (query: PromiseLike<unknown>) => ((await query) as { data: CallLookupRow | null }).data;
        const byOrg = () => from(supabase, 'calls').select(SELECT_COLS).eq('org_id', orgId);

        // Ordem (ver resolveReconcileMatch em api4com-reconcile-matching.ts):
        // 0) callRef do registro REST (o calls.id enviado no POST /calls),
        //    sem gate de hangup_cause; 1a) api4com_call_id; 1b) alt_api4com_ids
        //    com gate de hangup_cause; 2) ramal + destino + started_at ±10 min,
        //    pegando a linha mais próxima ainda não casada. O gate de hangup_cause
        //    evita juntar uma caixa postal (NUMBER_CHANGED) e uma ligação atendida
        //    (NORMAL_CLEARING) ao mesmo número: sem ele o dashboard de V4 Amaral
        //    contou 155 NUMBER_CHANGED a menos em mai/2026. O fallback ±10 min
        //    (antes 5 min) cobre a deriva entre o started_at da linha do discador e
        //    o do REST; ver o incidente de 2026-09-10 no módulo de matching.
        const match = await resolveReconcileMatch<CallLookupRow>(c, {
          byId: (id) => one(byOrg().eq('id', id).maybeSingle()),
          byCallRefMetadata: (callRef) => one(byOrg().filter('metadata->>callRef', 'eq', callRef).limit(1).maybeSingle()),
          byPrimaryId: (id) => one(byOrg().filter('metadata->>api4com_call_id', 'eq', id).limit(1).maybeSingle()),
          byAltId: (id) => one(byOrg().contains('metadata', { alt_api4com_ids: [id] }).limit(1).maybeSingle()),
          fallbackCandidates: async ({ origin, suffix, loIso, hiIso }) => {
            const { data } = (await byOrg()
              .eq('origin', origin)
              .like('destination', `%${suffix}`)
              .gte('started_at', loIso)
              .lte('started_at', hiIso)
              .order('started_at', { ascending: true })
              .limit(FALLBACK_CANDIDATE_LIMIT)) as { data: CallLookupRow[] | null };
            return data ?? [];
          },
        });
        const existing = match?.row ?? null;

        const duration = Number(c.duration) || 0;
        const isOutbound = c.call_type !== 'inbound';
        // REST doesn't expose answered_at — let the classifier derive
        // connected from hangup_cause + duration.
        const classification = classifyApi4ComCall({
          answeredAt: null,
          hangupCause: c.hangup_cause ?? null,
          durationSeconds: duration,
          significantThresholdSeconds,
        });

        if (existing) {
          // Top up fields the webhook may have missed/diverged on. Never
          // downgrade a status the webhook already promoted to 'significant'.
          const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
          if (!existing.recording_url && c.record_url) updates.recording_url = c.record_url;
          if (existing.duration_seconds === 0 && duration > 0) updates.duration_seconds = duration;
          if (!existing.started_at && c.started_at) updates.started_at = c.started_at;
          // Trust the API as source of truth for hangup_cause. Older rows had
          // wrong classifications from early-webhook ingestion (e.g. voicemails
          // stored as NORMAL_CLEARING). Override whenever the API explicitly
          // names a different cause — the REST endpoint reflects API4COM's
          // post-hoc classification, which is more authoritative than the
          // webhook's mid-call snapshot. Only keep existing when API omits.
          if (c.hangup_cause && existing.hangup_cause !== c.hangup_cause) {
            updates.hangup_cause = c.hangup_cause;
          }

          // Status: only override the default 'not_connected'. Manual SDR
          // classifications and webhook-promoted statuses are preserved.
          if (existing.status === 'not_connected' && duration > 0) {
            updates.status = classification.status;
          }

          // connected: NEVER downgrade. The webhook (which has answered_at)
          // is more authoritative than the REST/reconcile proxy. If existing
          // says true, leave it. Only upgrade false→true via classifier.
          if (!existing.connected && classification.connected) {
            updates.connected = true;
          }

          // Pelo callRef: merge que grava o id do provedor (ou alt) e preserva
          // callRef, gateway e webhook_linked. Pelo fallback a linha pode ter
          // outro api4com_call_id (request_id do discador vs channel_id do REST):
          // o primário fica e o novo id vai para alt_api4com_ids[].
          // O metadata vai por merge atômico no banco (merge_calls_metadata) com só as
          // chaves que mudaram: regravar o objeto inteiro apagava chaves escritas em
          // paralelo (audio_stats, live_amd, marcador do CRM automático).
          const linkedMeta = reconcileLinkMetadata(existing.metadata, api4comId, match!.via);
          const hasColumnUpdates = Object.keys(updates).length > 1;

          if (hasColumnUpdates || linkedMeta) {
            let updateError: { message?: string } | null | undefined = null;
            if (hasColumnUpdates) {
              ({ error: updateError } = (await from(supabase, 'calls').update(updates).eq('id', existing.id)) as {
                error?: { message?: string } | null;
              });
            }
            if (linkedMeta) {
              const merged = await mergeCallsMetadata(
                supabase,
                existing.id,
                metadataPatchFrom(existing.metadata, linkedMeta),
              );
              if (merged.error) updateError = updateError ?? { message: merged.error };
            }
            // Hangup conhecido e persistido: log sombra (só shadow, idempotente pelo UNIQUE do log).
            if (!updateError && (updates.hangup_cause ?? existing.hangup_cause)) {
              triggerHangupCrmShadow(supabase, existing.id);
            }
            return { kind: 'upserted_existing' };
          }
          return { kind: 'matched_no_update' };
        } else {
          // Insert missing call (webhook never arrived).
          const { data: inserted, error: insertError } = (await from(supabase, 'calls').insert({
            org_id: orgId,
            user_id: userId,
            origin: c.from ?? '',
            destination: c.to ?? '',
            started_at: c.started_at ?? new Date().toISOString(),
            duration_seconds: duration,
            status: duration > 0 ? classification.status : 'not_connected',
            connected: classification.connected,
            hangup_cause: c.hangup_cause ?? null,
            type: isOutbound ? 'outbound' : 'inbound',
            recording_url: c.record_url ?? null,
            // Copia o callRef do registro REST quando existe.
            metadata: reconcileInsertMetadata(c, api4comId),
          } as Record<string, unknown>)
            .select('id')
            .single()) as { data: { id: string } | null; error?: { message?: string } | null };
          if (!insertError && inserted?.id && c.hangup_cause) {
            triggerHangupCrmShadow(supabase, inserted.id);
          }
          return { kind: 'inserted_new' };
        }
      } catch (err) {
        return {
          kind: 'error',
          api4comId,
          message: err instanceof Error ? err.message : 'unknown',
        };
      }
    }

    // Drive the parallel processing in batches, accumulating into orgResult.
    // Parallelism is across ramal+number groups; calls inside a group run in
    // time order so redials never race for the same dialer row.
    const groups = groupCallsForReconcile(calls);
    for (let i = 0; i < groups.length; i += UPSERT_CONCURRENCY) {
      const batch = groups.slice(i, i + UPSERT_CONCURRENCY);
      const outcomesPerGroup = await Promise.all(
        batch.map(async (group) => {
          const groupOutcomes: CallOutcome[] = [];
          for (const c of group) groupOutcomes.push(await processOneCall(c));
          return groupOutcomes;
        }),
      );
      for (const outcome of outcomesPerGroup.flat()) {
        switch (outcome.kind) {
          case 'inserted_new':
            orgResult.inserted_new++;
            break;
          case 'upserted_existing':
            orgResult.upserted_existing++;
            break;
          case 'matched_no_update':
            // Row found but already up-to-date; not counted as upsert to
            // preserve the pre-refactor metric semantics.
            break;
          case 'skipped_no_id':
            orgResult.skipped_unmapped++;
            break;
          case 'skipped_unmapped':
            orgResult.skipped_unmapped++;
            unmappedRamalCounts[outcome.ramal] = (unmappedRamalCounts[outcome.ramal] ?? 0) + 1;
            break;
          case 'error':
            orgResult.errors.push(`call_${outcome.api4comId}: ${outcome.message}`);
            break;
        }
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

  // Persist run state so the next invocation can compute an adaptive window
  // and the health-check cron can spot a silently-paused worker. Only write
  // when this isn't a dry-run — dry-runs are inspection tools, they don't
  // count as "the worker has caught up to now".
  if (!dryRun) {
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
    const totalFetched = results.reduce((sum, r) => sum + r.fetched, 0);
    const status: string = totalErrors === 0 ? 'success' : (totalFetched > 0 ? 'partial' : 'error');

    const updates: Record<string, unknown> = {
      job_name: JOB_NAME,
      last_run_at: now.toISOString(),
      last_status: status,
      metadata: {
        windowHours,
        orgs: results.map((r) => ({ org_id: r.org_id, fetched: r.fetched, errors: r.errors.length })),
      },
    };
    // Only bump last_success_at when no errors at all — a partial run leaves
    // the previous success timestamp in place so adaptive windowing keeps
    // trying to cover the gap on the next invocation.
    if (status === 'success') {
      updates.last_success_at = now.toISOString();
    }

    try {
      await from(supabase, 'worker_run_state' as never)
        .upsert(updates, { onConflict: 'job_name' } as never);
    } catch (err) {
      console.warn('[reconcile-api4com] failed to write run state:', err);
    }
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
