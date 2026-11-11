/**
 * Helpers puros de validação de gravação. Sem I/O, fáceis de testar.
 */

/** Tolerância relativa entre a duração do áudio e `calls.duration_seconds`. */
export const RECORDING_DURATION_TOLERANCE_RATIO = 0.15;
/** Piso absoluto (segundos). Ligações curtas toleram arredondamento e silêncio de borda. */
export const RECORDING_DURATION_TOLERANCE_FLOOR_SECONDS = 5;

export type RecordingPersistStatus = 'ok' | 'mismatch' | 'unverified';

/** Tolerância em segundos: o MAIOR entre 15% da duração da ligação e 5 s. */
export function recordingToleranceSeconds(callSeconds: number): number {
  return Math.max(
    RECORDING_DURATION_TOLERANCE_FLOOR_SECONDS,
    callSeconds * RECORDING_DURATION_TOLERANCE_RATIO,
  );
}

/**
 * Classifica o áudio contra a duração registrada da ligação.
 * - `unverified`: não dá para comparar (duração do áudio desconhecida ou ligação sem duração).
 * - `ok`: diferença dentro da tolerância (12 s contra 365 s dá `mismatch`; 58 s contra 60 s dá `ok`).
 */
export function classifyRecordingDuration(
  audioSeconds: number | null,
  callSeconds: number | null | undefined,
): RecordingPersistStatus {
  if (audioSeconds === null || !Number.isFinite(audioSeconds)) return 'unverified';
  if (!callSeconds || callSeconds <= 0) return 'unverified';
  return Math.abs(audioSeconds - callSeconds) <= recordingToleranceSeconds(callSeconds)
    ? 'ok'
    : 'mismatch';
}

/** Até esta duração (segundos) a ligação é "curta" e pode cair em `borderline_short`. */
export const REPAIR_SHORT_CALL_MAX_SECONDS = 30;
/** Folga mínima (segundos) acima da tolerância normal para uma ligação curta. */
export const REPAIR_BORDERLINE_FLOOR_SECONDS = 15;
/** Folga relativa acima da tolerância normal para uma ligação curta. */
export const REPAIR_BORDERLINE_RATIO = 0.5;

export type RepairDurationStatus = RecordingPersistStatus | 'borderline_short';

/** Folga em segundos: o MAIOR entre 15 s e 50% da duração da ligação. */
export function recordingBorderlineSlackSeconds(callSeconds: number): number {
  return Math.max(REPAIR_BORDERLINE_FLOOR_SECONDS, callSeconds * REPAIR_BORDERLINE_RATIO);
}

/**
 * Como `classifyRecordingDuration`, mas ligação curta (até 30 s) cuja diferença
 * passa da tolerância e cabe na folga vira `borderline_short`, não `mismatch`.
 * Ex.: 12 s contra 20 s é `borderline_short`; 12 s contra 365 s é `mismatch`.
 */
export function classifyRepairDuration(
  audioSeconds: number | null,
  callSeconds: number | null | undefined,
): RepairDurationStatus {
  const base = classifyRecordingDuration(audioSeconds, callSeconds);
  if (base !== 'mismatch' || audioSeconds === null || !callSeconds) return base;
  if (callSeconds > REPAIR_SHORT_CALL_MAX_SECONDS) return base;
  return Math.abs(audioSeconds - callSeconds) <= recordingBorderlineSlackSeconds(callSeconds)
    ? 'borderline_short'
    : 'mismatch';
}

/** `true` só quando o áudio foi medido e NÃO bate. `unverified` não conta como ruim. */
export function recordingDurationMismatches(
  audioSeconds: number | null,
  callSeconds: number | null | undefined,
): boolean {
  return classifyRecordingDuration(audioSeconds, callSeconds) === 'mismatch';
}

/** Dois downloads seguidos com a mesma duração indicam arquivo já fechado (não está crescendo). */
export function isDurationStable(previous: number | null, current: number | null): boolean {
  if (previous === null || current === null) return false;
  return Math.abs(previous - current) < 1;
}

export interface RecordingOwnerRow {
  id: string;
  org_id: string;
  origin: string | null;
  destination?: string | null;
  recording_url?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Decide se alguma outra ligação do mesmo ramal já usa esta gravação.
 * Compara a URL e, quando houver, o eTag. Org e ramal (origin; sem origin,
 * destination) precisam coincidir. Retorna o id da ligação dona ou null.
 */
export function findReusedRecordingOwner(
  call: Pick<RecordingOwnerRow, 'id' | 'org_id' | 'origin' | 'destination'>,
  others: RecordingOwnerRow[],
  identity: { url: string | null; etag: string | null },
): string | null {
  for (const other of others) {
    if (other.id === call.id) continue;
    if (other.org_id !== call.org_id) continue;
    const sameRamal = call.origin
      ? other.origin === call.origin
      : !!call.destination && other.destination === call.destination;
    if (!sameRamal) continue;
    if (identity.url && other.recording_url === identity.url) return other.id;
    const otherEtag = other.metadata?.recording_etag;
    if (identity.etag && typeof otherEtag === 'string' && otherEtag === identity.etag)
      return other.id;
  }
  return null;
}
