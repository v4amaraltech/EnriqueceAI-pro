/**
 * Plano de reparo do marcador `calls.metadata.crm_auto_update` apagado pela corrida
 * de 13/11/2026 (o UPDATE do audio_stats regravou o metadata inteiro depois do CRM).
 *
 * Só planeja: decide, a partir da linha de calls e do log (append-only, nunca
 * alterado aqui), se o marcador pode ser reposto e qual patch iria para
 * `merge_calls_metadata`. Quem executa é o script de reparo, em dry-run.
 */
import { CRM_AUTO_UPDATE_LIVE_SOURCE } from './constants';
import { CRM_AUTO_UPDATE_METADATA_KEY, type CrmAutoUpdateMarker } from './shadow.service';

export interface MarkerRepairCall {
  id: string;
  org_id: string;
  sdr_disposition: string | null;
  metadata: Record<string, unknown> | null;
}

export interface MarkerRepairLog {
  call_id: string;
  applied: boolean;
  applied_at: string | null;
  rules_version: string;
  qualification_id: string | null;
  proposed_changes: { disposition?: string | null } | null;
}

export type MarkerRepairSkipReason =
  | 'call_not_found'
  | 'marker_present'
  | 'no_disposition'
  | 'no_applied_log'
  | 'disposition_mismatch';

export type MarkerRepairPlan =
  | {
      action: 'restore';
      callId: string;
      orgId: string;
      patch: { [CRM_AUTO_UPDATE_METADATA_KEY]: CrmAutoUpdateMarker };
    }
  | { action: 'skip'; callId: string; reason: MarkerRepairSkipReason };

const DISPOSITIONS: ReadonlyArray<CrmAutoUpdateMarker['disposition']> = [
  'voicemail',
  'no_answer',
  'technical_failure',
];

export function planMarkerRepair(
  callId: string,
  call: MarkerRepairCall | null,
  logs: MarkerRepairLog[],
): MarkerRepairPlan {
  if (!call) return { action: 'skip', callId, reason: 'call_not_found' };
  if (call.metadata && call.metadata[CRM_AUTO_UPDATE_METADATA_KEY] != null) {
    return { action: 'skip', callId, reason: 'marker_present' };
  }
  if (!call.sdr_disposition) return { action: 'skip', callId, reason: 'no_disposition' };

  const log = logs.find((l) => l.call_id === callId && l.applied === true && !!l.applied_at);
  if (!log) return { action: 'skip', callId, reason: 'no_applied_log' };

  const disposition = log.proposed_changes?.disposition ?? null;
  // Desfecho mudou depois (SDR corrigiu): repor o marcador seria mentir sobre quem escreveu.
  if (
    !disposition ||
    disposition !== call.sdr_disposition ||
    !DISPOSITIONS.includes(disposition as CrmAutoUpdateMarker['disposition'])
  ) {
    return { action: 'skip', callId, reason: 'disposition_mismatch' };
  }

  const marker: CrmAutoUpdateMarker = {
    applied: true,
    disposition: disposition as CrmAutoUpdateMarker['disposition'],
    applied_at: log.applied_at as string,
    ...(log.qualification_id ? { qualification_id: log.qualification_id } : {}),
    rules_version: log.rules_version,
    source: CRM_AUTO_UPDATE_LIVE_SOURCE,
  };
  return {
    action: 'restore',
    callId,
    orgId: call.org_id,
    patch: { [CRM_AUTO_UPDATE_METADATA_KEY]: marker },
  };
}
