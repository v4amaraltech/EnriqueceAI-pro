import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  type MergeCallsMetadataArgs,
  applyMergeCallsMetadataRpc,
} from '@tests/mocks/merge-calls-metadata';

import { applyMetadataPatch, mergeCallsMetadata, metadataPatchFrom } from './merge-calls-metadata';

type Row = Record<string, unknown>;

const CALL_ID = '6c5efe3c-0000-4000-8000-000000000001';
const ORG = 'org-v4';
const MARKER = {
  applied: true,
  disposition: 'no_answer',
  applied_at: '2026-11-13T14:00:00.000Z',
  rules_version: 'hangup_v1',
  source: 'crm_auto_update_v1_live',
};
const AUDIO = { packetsReceived: 100, packetsLost: 0, lossPercent: 0, jitterMs: 3, rttMs: 40 };

/** Banco falso com uma linha de calls; a RPC aplica `metadata || patch` e as guardas. */
function fakeDb(row: Row) {
  const rows = [row];
  const calls: MergeCallsMetadataArgs[] = [];
  const db = {
    async rpc(fn: string, args: MergeCallsMetadataArgs) {
      if (fn !== 'merge_calls_metadata')
        return { data: null, error: { message: `rpc desconhecida: ${fn}` } };
      calls.push(args);
      return { data: applyMergeCallsMetadataRpc(rows, args).data, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, row, calls };
}

describe('applyMetadataPatch (espelho do jsonb ||)', () => {
  it('chave só na esquerda fica, chave nova do patch entra', () => {
    expect(applyMetadataPatch({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('conflito na mesma chave: o patch ganha só naquela chave', () => {
    expect(applyMetadataPatch({ a: 1, b: { x: 1, y: 2 } }, { b: { x: 9 } })).toEqual({
      a: 1,
      b: { x: 9 },
    });
  });

  it('metadata nulo ou inválido vira objeto vazio (COALESCE)', () => {
    expect(applyMetadataPatch(null, { a: 1 })).toEqual({ a: 1 });
    expect(applyMetadataPatch([1], { a: 1 })).toEqual({ a: 1 });
  });
});

describe('metadataPatchFrom', () => {
  it('só as chaves adicionadas ou alteradas', () => {
    expect(
      metadataPatchFrom(
        { callRef: 'r', api4com_call_id: 'a' },
        { callRef: 'r', api4com_call_id: 'a', alt_api4com_ids: ['b'], webhook_linked: true },
      ),
    ).toEqual({ alt_api4com_ids: ['b'], webhook_linked: true });
  });

  it('sem base, tudo vira patch', () => {
    expect(metadataPatchFrom(null, { gateway: 'g', callRef: 'r' })).toEqual({
      gateway: 'g',
      callRef: 'r',
    });
  });

  it('nada mudou: patch vazio', () => {
    expect(metadataPatchFrom({ a: { b: 1 } }, { a: { b: 1 } })).toEqual({});
  });
});

describe('mergeCallsMetadata', () => {
  it('chama a RPC só com os argumentos informados', async () => {
    const { db, calls } = fakeDb({
      id: CALL_ID,
      org_id: ORG,
      metadata: null,
      sdr_disposition: null,
    });
    expect(await mergeCallsMetadata(db, CALL_ID, { audio_stats: AUDIO })).toEqual({
      updated: true,
      error: null,
    });
    await mergeCallsMetadata(
      db,
      CALL_ID,
      { crm_auto_update: MARKER },
      {
        orgId: ORG,
        sdrDisposition: 'no_answer',
        onlyIfDispositionNull: true,
      },
    );
    await mergeCallsMetadata(
      db,
      CALL_ID,
      { ai_outcome: { status: 'processing' } },
      { onlyIfAiOutcomeStatus: 'pending' },
    );
    expect(calls).toEqual([
      { p_id: CALL_ID, p_patch: { audio_stats: AUDIO } },
      {
        p_id: CALL_ID,
        p_patch: { crm_auto_update: MARKER },
        p_org_id: ORG,
        p_sdr_disposition: 'no_answer',
        p_only_if_disposition_null: true,
      },
      {
        p_id: CALL_ID,
        p_patch: { ai_outcome: { status: 'processing' } },
        p_only_if_ai_outcome_status: 'pending',
      },
    ]);
  });

  it('erro da RPC volta em error, sem lançar', async () => {
    const db = {
      rpc: async () => ({
        data: null,
        error: { message: 'function merge_calls_metadata does not exist' },
      }),
    };
    expect(await mergeCallsMetadata(db as unknown as SupabaseClient, CALL_ID, { a: 1 })).toEqual({
      updated: false,
      error: 'function merge_calls_metadata does not exist',
    });
  });

  it('corrida de 13/11: CRM grava o marcador e o áudio chega depois, as duas chaves ficam', async () => {
    const { db, row } = fakeDb({
      id: CALL_ID,
      org_id: ORG,
      metadata: { api4com_call_id: 'x' },
      sdr_disposition: null,
    });
    // Os dois escritores leram o metadata antigo; cada um manda só a própria chave.
    const crm = await mergeCallsMetadata(
      db,
      CALL_ID,
      { crm_auto_update: MARKER },
      {
        orgId: ORG,
        sdrDisposition: 'no_answer',
        onlyIfDispositionNull: true,
      },
    );
    const audio = await mergeCallsMetadata(db, CALL_ID, { audio_stats: AUDIO }, { orgId: ORG });
    expect(crm.updated && audio.updated).toBe(true);
    expect(row.metadata).toEqual({
      api4com_call_id: 'x',
      crm_auto_update: MARKER,
      audio_stats: AUDIO,
    });
    expect(row.sdr_disposition).toBe('no_answer');
  });

  it('inverso: audio_stats já existe, o marcador do CRM chega depois, as duas chaves ficam', async () => {
    const { db, row } = fakeDb({
      id: CALL_ID,
      org_id: ORG,
      metadata: { audio_stats: AUDIO },
      sdr_disposition: null,
    });
    await mergeCallsMetadata(
      db,
      CALL_ID,
      { crm_auto_update: MARKER },
      {
        orgId: ORG,
        sdrDisposition: 'no_answer',
        onlyIfDispositionNull: true,
      },
    );
    expect(row.metadata).toEqual({ audio_stats: AUDIO, crm_auto_update: MARKER });
  });

  it('live_amd e crm_auto_update não se apagam, em qualquer ordem', async () => {
    const liveAmd = { prediction: 'no_answer', confidence: 0.8 };
    for (const order of [0, 1]) {
      const { db, row } = fakeDb({ id: CALL_ID, org_id: ORG, metadata: {}, sdr_disposition: null });
      const writers = [
        () => mergeCallsMetadata(db, CALL_ID, { live_amd: liveAmd }, { orgId: ORG }),
        () =>
          mergeCallsMetadata(
            db,
            CALL_ID,
            { crm_auto_update: MARKER },
            {
              orgId: ORG,
              sdrDisposition: 'no_answer',
              onlyIfDispositionNull: true,
            },
          ),
      ];
      if (order === 1) writers.reverse();
      for (const w of writers) await w();
      expect(row.metadata).toEqual({ live_amd: liveAmd, crm_auto_update: MARKER });
    }
  });

  it('CRM com desfecho já preenchido: 0 linhas, nada sobrescrito', async () => {
    const { db, row } = fakeDb({
      id: CALL_ID,
      org_id: ORG,
      metadata: { audio_stats: AUDIO },
      sdr_disposition: 'callback_requested',
    });
    const r = await mergeCallsMetadata(
      db,
      CALL_ID,
      { crm_auto_update: MARKER },
      {
        orgId: ORG,
        sdrDisposition: 'no_answer',
        onlyIfDispositionNull: true,
      },
    );
    expect(r).toEqual({ updated: false, error: null });
    expect(row.sdr_disposition).toBe('callback_requested');
    expect(row.metadata).toEqual({ audio_stats: AUDIO });
  });

  it('outra org: 0 linhas', async () => {
    const { db, row } = fakeDb({ id: CALL_ID, org_id: ORG, metadata: {}, sdr_disposition: null });
    expect((await mergeCallsMetadata(db, CALL_ID, { a: 1 }, { orgId: 'outra' })).updated).toBe(
      false,
    );
    expect(row.metadata).toEqual({});
  });

  it('claim de ai_outcome: só passa com status pending', async () => {
    const { db, row } = fakeDb({
      id: CALL_ID,
      org_id: ORG,
      metadata: { ai_outcome: { status: 'pending' }, audio_stats: AUDIO },
    });
    const first = await mergeCallsMetadata(
      db,
      CALL_ID,
      { ai_outcome: { status: 'processing' } },
      { onlyIfAiOutcomeStatus: 'pending' },
    );
    const second = await mergeCallsMetadata(
      db,
      CALL_ID,
      { ai_outcome: { status: 'processing' } },
      { onlyIfAiOutcomeStatus: 'pending' },
    );
    expect(first.updated).toBe(true);
    expect(second.updated).toBe(false);
    expect(row.metadata).toEqual({ ai_outcome: { status: 'processing' }, audio_stats: AUDIO });
  });

  it('patch mínimo não reverte chave que outro escritor atualizou no meio', async () => {
    const { db, row } = fakeDb({
      id: CALL_ID,
      org_id: ORG,
      metadata: { api4com_call_id: 'velho' },
    });
    const stale = { ...(row.metadata as Row) };
    // Outro escritor troca o id no meio.
    await mergeCallsMetadata(db, CALL_ID, { api4com_call_id: 'novo' });
    // O áudio montou o patch a partir do lido (stale), mas manda só a própria chave.
    await mergeCallsMetadata(
      db,
      CALL_ID,
      metadataPatchFrom(stale, { ...stale, audio_stats: AUDIO }),
    );
    expect(row.metadata).toEqual({ api4com_call_id: 'novo', audio_stats: AUDIO });
  });
});
