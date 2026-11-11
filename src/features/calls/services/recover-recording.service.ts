import type { SupabaseClient } from '@supabase/supabase-js';

import { getOrgApiCredentials } from '@/features/integrations/services/api4com.service';
import type { createServiceRoleClient } from '@/lib/supabase/service';

import {
  type RecordingSearchEvent,
  defaultSleep,
  searchRecordingCandidates,
} from './api4com-recording-search';

interface CallForRecovery {
  id: string;
  destination: string;
  origin: string | null;
  started_at: string | null;
  created_at: string;
  duration_seconds: number;
  user_id: string;
  org_id: string;
  metadata: Record<string, unknown> | null;
}

/**
 * Candidatos de `record_url` na API4COM, em ordem: primeiro por id do provedor
 * (`api4com_call_id` e `alt_api4com_ids`), depois por janela de data em torno do
 * início da ligação. Somente leitura (GET) e com backoff em 429/503.
 * Também avisa quando a janela é ambígua (`kind: 'ambiguous_window'`).
 * O chamador decide quando parar (ex.: o reparo baixa e mede cada um).
 */
export async function* lookupRecordingCandidatesFromApi4Com(
  supabase: SupabaseClient,
  call: CallForRecovery,
): AsyncGenerator<RecordingSearchEvent> {
  // Credential of the account: org token, else any legacy user token of the org.
  const creds = await getOrgApiCredentials(
    call.org_id,
    supabase as ReturnType<typeof createServiceRoleClient>,
  );
  if (!creds) return;
  yield* searchRecordingCandidates(
    { fetchFn: fetch, sleep: defaultSleep, apiKey: creds.apiKey, baseUrl: creds.baseUrl },
    call,
  );
}

/**
 * Looks up the missing recording_url for a call directly against API4COM's REST API.
 * Used by the cron that catches calls whose channel-hangup webhook arrived before
 * the recording was ready (~86% of API4COM hangups in this org).
 *
 * Returns the first candidate URL, or null if not found / API4COM unreachable.
 * Does NOT update the DB — caller is responsible.
 */
export async function lookupRecordingFromApi4Com(
  supabase: SupabaseClient,
  call: CallForRecovery,
): Promise<string | null> {
  for await (const event of lookupRecordingCandidatesFromApi4Com(supabase, call)) {
    if (event.kind === 'candidate') return event.url;
  }
  return null;
}
