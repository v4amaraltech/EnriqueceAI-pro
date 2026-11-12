import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import { RECORDING_HIDDEN_KEY } from './recording-proxy';
import {
  type DownloadedAudio,
  PERSIST_CALL_COLUMNS,
  type PersistCallRow,
  downloadAudio,
  flagRecordingStatus,
  measureStoredRecording,
  mergeCallMetadata,
  uploadValidatedRecording,
} from './recording-storage.service';
import { callfaceRecordingMatchesCall, classifyRepairDuration } from './recording-validation';
import { lookupRecordingCandidatesFromApi4Com } from './recover-recording.service';

export type RepairOutcome =
  | 'skipped_ok' // já validada (flag ok) ou cópia atual bate com a duração
  | 'skipped_not_candidate' // sem cópia e sem flag de problema: cabe ao persist-pending
  | 'would_repair' // dry-run: uma cópia que bate seria gravada
  | 'repaired'
  | 'borderline_short' // ligação curta perto da tolerância: não é mismatch automático
  | 'duration_divergent' // gravação do Callface é desta ligação (fone+hora); a duração é que diverge
  | 'ambiguous_shared_url' // a cópia que bate está numa URL de outra ligação que também bate: segura
  | 'ambiguous_window' // janela da API4COM com vários candidatos só pelo ramal: segura
  | 'lookup_failed' // API4COM não respondeu (limite, rede, erro): busca incompleta, não esconde nada
  | 'unrepairable'; // não achou áudio que bata; apply esconde a gravação errada

/** De onde veio a cópia correta. */
export type RepairSource = 'recording_url' | 'api4com';

export interface RepairPageOptions {
  orgId: string;
  /** Último `id` da página anterior (keyset). */
  cursor?: string | null;
  limit?: number;
  /** Padrão false: dry-run, nada é gravado. */
  apply?: boolean;
  /** Ignora ligações criadas antes disto (ISO). */
  sinceIso?: string;
  /** Chamado depois de cada ligação (o script grava o cursor para retomar). */
  onCallDone?: (callId: string, result: RepairCallResult) => void | Promise<void>;
  /** true interrompe a página entre duas ligações (ex.: Ctrl+C no script). */
  shouldStop?: () => boolean;
}

export interface RepairCallResult {
  outcome: RepairOutcome;
  audioSeconds?: number | null;
  source?: RepairSource;
  /** ambiguous_shared_url: outras ligações com a mesma URL cuja duração também bate. */
  sharedWith?: string[];
  /** Como a cópia foi casada com a ligação (fonte api4com, ou URL liberada pelo id próprio). */
  match?: 'provider_id' | 'call_ref' | 'destination' | 'unique_in_window';
  /** ambiguous_window: quantos candidatos do ramal havia na janela. */
  windowCandidates?: number;
  /** unrepairable em apply: gravação marcada como escondida para o SDR. */
  hidden?: boolean;
}

export interface RepairPageResult {
  scanned: number;
  /** Parou antes do fim da página (shouldStop); `nextCursor` é a última processada. */
  stopped?: boolean;
  nextCursor: string | null;
  counts: Record<RepairOutcome, number>;
  /** Fonte da cópia correta (would_repair e repaired). */
  sources: Record<RepairSource, number>;
  details: Array<{ callId: string } & RepairCallResult>;
}

export const REPAIR_DEFAULT_LIMIT = 25;
export const REPAIR_MAX_LIMIT = 100;
/** Teto de downloads de candidatos da API4COM por ligação. */
export const REPAIR_MAX_API4COM_DOWNLOADS = 4;

function emptyCounts(): Record<RepairOutcome, number> {
  return {
    skipped_ok: 0,
    skipped_not_candidate: 0,
    would_repair: 0,
    repaired: 0,
    borderline_short: 0,
    duration_divergent: 0,
    ambiguous_shared_url: 0,
    ambiguous_window: 0,
    lookup_failed: 0,
    unrepairable: 0,
  };
}

/** `since` (ISO) prevalece sobre `days`. Devolve null se `since` for inválido. */
export function resolveRepairSinceIso(
  opts: { since?: string | null; days?: number },
  now = Date.now(),
): string | null {
  if (opts.since) {
    const time = Date.parse(opts.since);
    return Number.isNaN(time) ? null : new Date(time).toISOString();
  }
  return new Date(now - (opts.days ?? 90) * 24 * 60 * 60 * 1000).toISOString();
}

/** Teto de ligações irmãs consultadas por URL compartilhada. */
export const REPAIR_SHARED_URL_LOOKUP_LIMIT = 20;

interface SharedUrlRow {
  id: string;
  duration_seconds: number | null;
}

/**
 * Outras ligações da org com a MESMA URL de gravação cuja duração também bate com o
 * áudio. Se houver, o dono do áudio é ambíguo (listener serviu a mesma gravação para
 * ligações seguidas do ramal). Somente leitura.
 */
export async function findSharedUrlMatches(
  supabase: SupabaseClient,
  call: Pick<PersistCallRow, 'id' | 'org_id'>,
  url: string,
  audioSeconds: number | null,
): Promise<string[]> {
  if (audioSeconds === null) return [];
  const { data } = (await from(supabase, 'calls')
    .select('id, duration_seconds')
    .eq('org_id', call.org_id)
    .eq('recording_url', url)
    .neq('id', call.id)
    .limit(REPAIR_SHARED_URL_LOOKUP_LIMIT)) as { data: SharedUrlRow[] | null };
  return (data ?? [])
    .filter((row) => classifyRepairDuration(audioSeconds, row.duration_seconds) === 'ok')
    .map((row) => row.id);
}

/**
 * Repara UMA ligação. Se a cópia do Storage não bate, tenta nesta ordem:
 * 1) o `recording_url` já salvo; 2) a API4COM (por id, depois por janela de data).
 * Em dry-run nunca escreve. Ligação curta perto da tolerância vira
 * `borderline_short` e não é marcada como mismatch.
 * URL compartilhada com outra ligação que também bate fica retida, a menos que a
 * API4COM a devolva pelo id da própria ligação. Janela com vários candidatos só
 * pelo ramal vira `ambiguous_window`. Se a API4COM falhou (limite de taxa esgotado,
 * rede, erro HTTP) e nada bateu, vira `lookup_failed`: não conclui nem esconde.
 * Em apply, `unrepairable` esconde a gravação (metadata `recording_hidden`);
 * nunca apaga arquivo nem linha.
 */
export async function repairCallRecording(
  supabase: SupabaseClient,
  call: PersistCallRow,
  apply: boolean,
): Promise<RepairCallResult> {
  const meta = call.metadata ?? {};
  if (meta.recording_persist_status === 'ok') return { outcome: 'skipped_ok' };

  let borderlineSeconds: number | null = null;
  let sawBorderline = false;
  let storedSeconds: number | null = null;

  if (call.recording_storage_path) {
    storedSeconds = await measureStoredRecording(supabase, call.recording_storage_path);
    const storedStatus = classifyRepairDuration(storedSeconds, call.duration_seconds);
    if (storedStatus === 'ok' || storedStatus === 'unverified') {
      if (apply) await flagRecordingStatus(supabase, call.id, storedStatus, storedSeconds);
      return { outcome: 'skipped_ok', audioSeconds: storedSeconds };
    }
    if (storedStatus === 'borderline_short') {
      sawBorderline = true;
      borderlineSeconds = storedSeconds;
    }
  } else if (meta.recording_persist_status !== 'mismatch') {
    return { outcome: 'skipped_not_candidate' };
  }

  let lastSeconds: number | null = borderlineSeconds;
  const tried = new Set<string>();
  const measured = new Map<string, number | null>();
  let ambiguous: RepairCallResult | null = null;
  /** Áudio que bate mas ficou retido por URL compartilhada; o id próprio pode liberar. */
  const heldShared = new Map<
    string,
    { audio: DownloadedAudio; status: 'ok' | 'unverified'; source: RepairSource }
  >();
  let windowCandidates: number | null = null;
  let lookupFailed = false;

  const commit = async (
    audio: DownloadedAudio,
    status: 'ok' | 'unverified',
    source: RepairSource,
    url: string,
    match?: RepairCallResult['match'],
  ): Promise<RepairCallResult> => {
    const extra = match ? { match } : {};
    if (!apply) return { outcome: 'would_repair', audioSeconds: audio.seconds, source, ...extra };
    const saved = await uploadValidatedRecording(supabase, call, audio, status, {
      durableUrl: source === 'api4com' ? url : null,
    });
    return {
      outcome: saved.ok ? 'repaired' : 'unrepairable',
      audioSeconds: audio.seconds,
      source,
      ...extra,
    };
  };

  // Devolve o resultado se a URL tem áudio que bate; senão registra e segue.
  // `ownedById`: a API4COM devolveu esta URL pelo id da própria ligação, então
  // outra ligação com a mesma URL não a torna ambígua.
  const tryUrl = async (
    url: string,
    source: RepairSource,
    match?: RepairCallResult['match'],
  ): Promise<RepairCallResult | null> => {
    if (tried.has(url)) return null;
    tried.add(url);
    const audio = await downloadAudio(url);
    if (!audio) return null;
    measured.set(url, audio.seconds);
    const status = classifyRepairDuration(audio.seconds, call.duration_seconds);
    if (status === 'borderline_short') {
      sawBorderline = true;
      lastSeconds = audio.seconds;
      return null;
    }
    if (status === 'mismatch') {
      lastSeconds = audio.seconds;
      return null;
    }
    // provider_id e call_ref: a API4COM devolveu a URL pelo id da própria ligação.
    if (match !== 'provider_id' && match !== 'call_ref') {
      // Mesma URL em outra ligação que também bate: dono ambíguo, segura (não grava).
      const sharedWith = await findSharedUrlMatches(supabase, call, url, audio.seconds);
      if (sharedWith.length > 0) {
        heldShared.set(url, { audio, status, source });
        ambiguous ??= {
          outcome: 'ambiguous_shared_url',
          audioSeconds: audio.seconds,
          source,
          sharedWith,
        };
        return null;
      }
    }
    return commit(audio, status, source, url, match);
  };

  // 1) link já salvo na linha (S3 durável, listener ou outro host)
  if (call.recording_url) {
    const hit = await tryUrl(call.recording_url, 'recording_url');
    if (hit) return hit;
  }

  // 1b) gravação do Callface (S3) cujo nome bate fone e hora com a ligação, e é a
  // mesma que está no Storage: o áudio é desta ligação, a duração é que diverge.
  // Não é troca: continua servida, sem mismatch e sem busca na API4COM.
  const urlSeconds = call.recording_url ? (measured.get(call.recording_url) ?? null) : null;
  if (
    !ambiguous &&
    call.recording_url &&
    urlSeconds !== null &&
    (storedSeconds === null || Math.abs(urlSeconds - storedSeconds) < 1) &&
    callfaceRecordingMatchesCall(call.recording_url, call)
  ) {
    if (sawBorderline) return { outcome: 'borderline_short', audioSeconds: lastSeconds };
    if (apply) {
      await mergeCallMetadata(supabase, call.id, {
        // Chave própria: recording_audio_seconds divergente faria o proxy esconder a cópia.
        recording_duration_divergent: true,
        recording_divergent_audio_seconds: Math.round(urlSeconds * 10) / 10,
        recording_persist_checked_at: new Date().toISOString(),
        // Se uma rodada anterior escondeu a cópia, volta a servir.
        ...(meta.recording_persist_status === 'mismatch'
          ? { recording_persist_status: 'unverified' }
          : {}),
        ...(meta[RECORDING_HIDDEN_KEY] === true ? { [RECORDING_HIDDEN_KEY]: false } : {}),
      });
    }
    return { outcome: 'duration_divergent', audioSeconds: urlSeconds };
  }

  // 2) API4COM, só se o link salvo não resolveu: id do provedor antes da janela
  let downloads = 0;
  for await (const event of lookupRecordingCandidatesFromApi4Com(
    supabase,
    call as Parameters<typeof lookupRecordingCandidatesFromApi4Com>[1],
  )) {
    if (event.kind === 'ambiguous_window') {
      windowCandidates = event.candidates;
      continue;
    }
    if (event.kind === 'lookup_failed') {
      lookupFailed = true;
      continue;
    }
    const { url, match } = event;
    // A busca pelo id da própria ligação devolveu a URL retida como compartilhada:
    // a gravação é desta ligação, não é ambígua para ela.
    const held = match === 'provider_id' || match === 'call_ref' ? heldShared.get(url) : undefined;
    if (held) return commit(held.audio, held.status, held.source, url, match);
    if (tried.has(url)) continue;
    const hit = await tryUrl(url, 'api4com', match);
    if (hit) return hit;
    if (++downloads >= REPAIR_MAX_API4COM_DOWNLOADS) break;
  }

  // Cópia que bate existe, mas numa URL de dono ambíguo: não grava nem marca mismatch.
  if (ambiguous) return ambiguous;

  // Vários candidatos só pelo ramal na janela: pode ser de outro lead. Não grava nem esconde.
  if (windowCandidates !== null) {
    return { outcome: 'ambiguous_window', audioSeconds: lastSeconds, windowCandidates };
  }

  // Busca na API4COM incompleta: não dá para afirmar que não há cópia certa.
  // Não grava nem esconde; uma nova rodada (retomando pelo cursor) tenta de novo.
  if (lookupFailed) return { outcome: 'lookup_failed', audioSeconds: lastSeconds };

  // Perto da tolerância: não marca mismatch e não mexe no Storage.
  if (sawBorderline) return { outcome: 'borderline_short', audioSeconds: lastSeconds };

  // Sem cópia certa: esconde a gravação errada do SDR (o proxy respeita a flag).
  // Nada é apagado: arquivo, link e linha ficam; só a metadata ganha a marca.
  // Callface já confirmado como desta ligação (duração divergente) continua servido.
  if (apply && meta.recording_duration_divergent !== true) {
    await flagRecordingStatus(supabase, call.id, 'mismatch', null, {
      [RECORDING_HIDDEN_KEY]: true,
      recording_hidden_reason: 'repair_unrepairable',
    });
    return { outcome: 'unrepairable', audioSeconds: lastSeconds, hidden: true };
  }
  return { outcome: 'unrepairable', audioSeconds: lastSeconds };
}

/**
 * Uma página de reparo com paginação keyset por `id` (sem offset).
 * Idempotente: ligações com `recording_persist_status = 'ok'` são puladas.
 */
export async function repairRecordingsPage(
  supabase: SupabaseClient,
  opts: RepairPageOptions,
): Promise<RepairPageResult> {
  const limit = Math.min(Math.max(opts.limit ?? REPAIR_DEFAULT_LIMIT, 1), REPAIR_MAX_LIMIT);
  const apply = opts.apply === true;

  let query = from(supabase, 'calls')
    .select(PERSIST_CALL_COLUMNS)
    .eq('org_id', opts.orgId)
    .not('recording_url', 'is', null)
    .gt('duration_seconds', 0)
    .order('id', { ascending: true })
    .limit(limit);
  if (opts.cursor) query = query.gt('id', opts.cursor);
  if (opts.sinceIso) query = query.gte('created_at', opts.sinceIso);

  const { data } = (await query) as { data: PersistCallRow[] | null };
  const rows = data ?? [];

  const counts = emptyCounts();
  const sources: RepairPageResult['sources'] = { recording_url: 0, api4com: 0 };
  const details: RepairPageResult['details'] = [];
  let processed = 0;
  let stopped = false;
  for (const call of rows) {
    if (opts.shouldStop?.()) {
      stopped = true;
      break;
    }
    const result = await repairCallRecording(supabase, call, apply);
    counts[result.outcome]++;
    if (result.source && (result.outcome === 'would_repair' || result.outcome === 'repaired')) {
      sources[result.source]++;
    }
    details.push({ callId: call.id, ...result });
    processed++;
    await opts.onCallDone?.(call.id, result);
  }

  const last = rows[processed - 1];
  // Parada no meio: retoma depois da última processada (ou do cursor recebido).
  const nextCursor = stopped
    ? (last?.id ?? opts.cursor ?? null)
    : rows.length === limit && last
      ? last.id
      : null;
  return {
    scanned: processed,
    ...(stopped ? { stopped } : {}),
    nextCursor,
    counts,
    sources,
    details,
  };
}
