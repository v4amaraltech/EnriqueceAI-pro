import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import {
  type MixedAutoEmailScope,
  type MixedCadenceRef,
  isMixedAutoEmailCadence,
  orgAllowsMixedAutoEmail,
  pickDueMixedEmailEnrollments,
} from './mixed-auto-email.service';

/** Teto da busca leve: lê só colunas curtas, então cabe bem mais que o lote final. */
export const MIXED_LIGHT_LIMIT = 1000;
/** Tamanho do bloco de ids em `.in()` — listas grandes estouram a URL do PostgREST. */
export const IN_CHUNK_SIZE = 100;
/**
 * Cadências por consulta de passos. O PostgREST corta a resposta em max_rows
 * (1000): com até ~33 passos por cadência, 30 cadências sempre cabem.
 */
export const STEP_CHUNK = 30;
export const POSTGREST_MAX_ROWS = 1000;

export interface MixedLightRow {
  id: string;
  cadence_id: string;
  current_step: number;
  lead: { org_id: string };
  cadence: MixedCadenceRef;
}

export interface CadenceStepOrders {
  /** Todos os passos da cadência, de qualquer canal. */
  all: Set<number>;
  /** Só os passos de e-mail. */
  email: Set<number>;
}

export function chunkList<T>(items: T[], size: number = IN_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Das inscrições vencidas (ordenadas da mais antiga), escolhe até `limit`:
 * as que estão num passo de e-mail e as que apontam para um passo que não
 * existe mais (o motor conclui essas). Ligação/WhatsApp/LinkedIn ficam de fora
 * — esse caminho não avança esses canais, e não podem ocupar o lote.
 */
export function pickMixedBatch<T extends MixedLightRow>(
  rows: T[],
  stepOrders: Map<string, CadenceStepOrders>,
  scope: MixedAutoEmailScope,
  limit: number,
): T[] {
  if (scope.kind === 'none') return [];
  const emailOrders = new Map<string, Set<number>>();
  for (const [cadenceId, orders] of stepOrders) emailOrders.set(cadenceId, orders.email);
  const emailIds = new Set(pickDueMixedEmailEnrollments(rows, emailOrders, scope).map((r) => r.id));

  const picked: T[] = [];
  for (const row of rows) {
    if (picked.length >= limit) break;
    if (emailIds.has(row.id)) {
      picked.push(row);
      continue;
    }
    if (!orgAllowsMixedAutoEmail(scope, row.lead.org_id) || !isMixedAutoEmailCadence(row.cadence)) continue;
    // Cadência sem nenhum passo carregado = leitura suspeita: não conclui.
    const orders = stepOrders.get(row.cadence_id);
    if (orders && !orders.all.has(row.current_step)) picked.push(row);
  }
  return picked;
}

/**
 * Busca as inscrições da cadência mista que o motor de fato consegue tratar:
 * 1) busca leve (sem o lead inteiro), mais antigas primeiro;
 * 2) descobre os passos das cadências e filtra em memória;
 * 3) só então carrega as linhas completas das até `batchSize` escolhidas.
 * Qualquer erro devolve `error` e nenhuma linha — nunca conclui inscrição "sem
 * passo" por causa de uma consulta de passos que falhou.
 */
export async function loadMixedEmailBatch<T extends { id: string }>(
  supabase: SupabaseClient,
  params: { scope: MixedAutoEmailScope; nowIso: string; batchSize: number; fullSelect: string },
): Promise<{ rows: T[]; error: string | null }> {
  const { scope, nowIso, batchSize, fullSelect } = params;
  if (scope.kind === 'none') return { rows: [], error: null };

  let lightQuery = from(supabase, 'cadence_enrollments')
    .select('id, cadence_id, current_step, next_step_due, lead:leads!inner(org_id), cadence:cadences!inner(type, executor)')
    .eq('status', 'active')
    .eq('cadence.status', 'active')
    .eq('cadence.type', 'standard')
    .neq('cadence.executor', 'bdr_ai')
    .not('next_step_due', 'is', null)
    .lte('next_step_due', nowIso)
    .order('next_step_due', { ascending: true })
    .limit(MIXED_LIGHT_LIMIT);
  if (scope.kind === 'orgs') lightQuery = lightQuery.in('lead.org_id', scope.orgIds);
  const { data: lightData, error: lightErr } = (await lightQuery) as {
    data: MixedLightRow[] | null;
    error: { message: string } | null;
  };
  if (lightErr) return { rows: [], error: lightErr.message };
  const light = lightData ?? [];
  if (light.length === 0) return { rows: [], error: null };

  const stepOrders = new Map<string, CadenceStepOrders>();
  const cadenceIds = [...new Set(light.map((r) => r.cadence_id))];
  for (const chunk of chunkList(cadenceIds, STEP_CHUNK)) {
    const { data: stepRows, error: stepErr } = (await from(supabase, 'cadence_steps')
      .select('cadence_id, step_order, channel')
      .in('cadence_id', chunk)) as {
      data: Array<{ cadence_id: string; step_order: number; channel: string }> | null;
      error: { message: string } | null;
    };
    if (stepErr) return { rows: [], error: stepErr.message };
    // Resposta no teto = possivelmente truncada: passo faltando viraria "sem passo".
    if ((stepRows?.length ?? 0) >= POSTGREST_MAX_ROWS) {
      return { rows: [], error: 'passos possivelmente truncados pelo limite de linhas' };
    }
    for (const s of stepRows ?? []) {
      let bucket = stepOrders.get(s.cadence_id);
      if (!bucket) {
        bucket = { all: new Set(), email: new Set() };
        stepOrders.set(s.cadence_id, bucket);
      }
      bucket.all.add(s.step_order);
      if (s.channel === 'email') bucket.email.add(s.step_order);
    }
  }

  const chosen = pickMixedBatch(light, stepOrders, scope, batchSize);
  if (chosen.length === 0) return { rows: [], error: null };

  const byId = new Map<string, T>();
  for (const chunk of chunkList(chosen.map((r) => r.id))) {
    const { data: fullRows, error: fullErr } = (await from(supabase, 'cadence_enrollments')
      .select(fullSelect)
      .eq('status', 'active')
      .in('id', chunk)) as { data: T[] | null; error: { message: string } | null };
    if (fullErr) return { rows: [], error: fullErr.message };
    for (const row of fullRows ?? []) byId.set(row.id, row);
  }
  // Mantém a ordem do vencimento mais antigo primeiro.
  const rows = chosen.map((r) => byId.get(r.id)).filter((r): r is T => r !== undefined);
  return { rows, error: null };
}

/**
 * Passos de várias cadências em blocos (mesma proteção de URL e de max_rows).
 * Qualquer erro, ou bloco no teto de linhas, devolve `error` e mapa vazio —
 * quem chama NÃO pode seguir como se as cadências não tivessem passos.
 */
export async function loadStepsByCadence<S extends { cadence_id: string; step_order: number }>(
  supabase: SupabaseClient,
  cadenceIds: string[],
): Promise<{ steps: Map<string, Map<number, S>>; error: string | null }> {
  const steps = new Map<string, Map<number, S>>();
  for (const chunk of chunkList(cadenceIds, STEP_CHUNK)) {
    const { data, error } = (await from(supabase, 'cadence_steps')
      .select('*')
      .in('cadence_id', chunk)) as { data: S[] | null; error: { message: string } | null };
    if (error) return { steps: new Map(), error: error.message };
    if ((data?.length ?? 0) >= POSTGREST_MAX_ROWS) {
      return { steps: new Map(), error: 'passos possivelmente truncados pelo limite de linhas' };
    }
    for (const s of data ?? []) {
      let bucket = steps.get(s.cadence_id);
      if (!bucket) {
        bucket = new Map<number, S>();
        steps.set(s.cadence_id, bucket);
      }
      bucket.set(s.step_order, s);
    }
  }
  return { steps, error: null };
}
