import { describe, expect, it, vi } from 'vitest';

import {
  type WebhookCallStore,
  type WebhookMatchedCall,
  findWebhookCall,
} from './api4com-webhook-matching';

const REF = '6f1c2a3e-1234-4abc-8def-0123456789ab';
const NOW = Date.parse('2026-11-12T15:00:00.000Z');

type Row = WebhookMatchedCall & { org_id: string };

function store(rows: {
  byId?: Row | null;
  byCallRef?: Row | null;
  primary?: Row | null;
  alt?: Row | null;
  fallback?: Row | null;
}) {
  const s = {
    findById: vi.fn(async (id: string) => (rows.byId && rows.byId.id === id ? rows.byId : null)),
    findByCallRefMetadata: vi.fn(async () => rows.byCallRef ?? null),
    findByPrimaryId: vi.fn(async () => rows.primary ?? null),
    findByAltId: vi.fn(async () => rows.alt ?? null),
    findFallback: vi.fn(async () => rows.fallback ?? null),
    mergeMetadata: vi.fn(async () => undefined),
  } satisfies WebhookCallStore<Row>;
  return s;
}

const event = (metadata: Record<string, unknown> | null = { callRef: REF, gateway: 'flux-org' }) => ({
  id: 'prov-1',
  caller: '1001',
  called: '5511999999999',
  domain: 'acme.api4com.com',
  metadata,
});

describe('findWebhookCall', () => {
  it('callRef acha a linha certa mesmo com outro candidato no fallback', async () => {
    const own: Row = { id: REF, org_id: 'org-1', metadata: { callRef: REF, gateway: 'flux-org' } };
    const older: Row = { id: 'older', org_id: 'org-1', metadata: { gateway: 'flux-org' } };
    const s = store({ byId: own, fallback: older });

    const result = await findWebhookCall(s, event(), ['org-1'], { now: NOW });

    expect(result?.call.id).toBe(REF);
    expect(result?.via).toBe('call_ref');
    expect(s.findFallback).not.toHaveBeenCalled();
    expect(s.findByPrimaryId).not.toHaveBeenCalled();
  });

  it('callRef preenche api4com_call_id e webhook_linked sem apagar o resto', async () => {
    const own: Row = {
      id: REF,
      org_id: 'org-1',
      metadata: { callRef: REF, gateway: 'flux-org', ai_outcome: { status: 'pending' } },
    };
    const s = store({ byId: own });

    const result = await findWebhookCall(s, event(), ['org-1'], { now: NOW });

    const expected = {
      callRef: REF,
      gateway: 'flux-org',
      ai_outcome: { status: 'pending' },
      api4com_call_id: 'prov-1',
      webhook_linked: true,
    };
    // O merge no banco recebe só as chaves novas; o resto fica na linha.
    expect(s.mergeMetadata).toHaveBeenCalledWith(REF, { api4com_call_id: 'prov-1', webhook_linked: true });
    expect(result?.call.metadata).toEqual(expected);
  });

  it('callRef com outro id primário guarda o do evento em alt_api4com_ids', async () => {
    const own: Row = { id: REF, org_id: 'org-1', metadata: { callRef: REF, api4com_call_id: 'req-0' } };
    const s = store({ byId: own });

    await findWebhookCall(s, event(), ['org-1'], { now: NOW });

    expect(s.mergeMetadata).toHaveBeenCalledWith(REF, {
      alt_api4com_ids: ['prov-1'],
      webhook_linked: true,
    });
  });

  it('linha já casada pelo callRef não é reescrita', async () => {
    const own: Row = {
      id: REF,
      org_id: 'org-1',
      metadata: { callRef: REF, api4com_call_id: 'prov-1', webhook_linked: true },
    };
    const s = store({ byId: own });

    await findWebhookCall(s, event(), ['org-1'], { now: NOW });

    expect(s.mergeMetadata).not.toHaveBeenCalled();
  });

  it('cai no metadata->>callRef quando a chave primária não acha', async () => {
    const row: Row = { id: 'x', org_id: 'org-1', metadata: { callRef: REF } };
    const s = store({ byCallRef: row });

    const result = await findWebhookCall(s, event(), [], { now: NOW });

    expect(s.findByCallRefMetadata).toHaveBeenCalledWith(REF);
    expect(result?.call.id).toBe('x');
  });

  it('orgScope vazio ainda casa por callRef', async () => {
    const own: Row = { id: REF, org_id: 'org-1', metadata: { callRef: REF } };
    const s = store({ byId: own });

    const result = await findWebhookCall(s, event(), [], { now: NOW });

    expect(result?.via).toBe('call_ref');
  });

  it('sem callRef (ou inválido) segue o caminho atual: id primário', async () => {
    const primary: Row = { id: 'p', org_id: 'org-1', metadata: { api4com_call_id: 'prov-1' } };
    for (const metadata of [null, {}, { callRef: 'lixo' }, { callRef: '5511999999999' }]) {
      const s = store({ primary });
      const result = await findWebhookCall(s, event(metadata), ['org-1'], { now: NOW });
      expect(result?.via).toBe('primary_id');
      expect(s.findById).not.toHaveBeenCalled();
    }
  });

  it('callRef que não acha linha cai no caminho atual', async () => {
    const alt: Row = { id: 'a', org_id: 'org-1', metadata: { alt_api4com_ids: ['prov-1'] } };
    const s = store({ alt });

    const result = await findWebhookCall(s, event(), ['org-1'], { now: NOW });

    expect(result?.via).toBe('alt_id');
  });

  it('fallback de 2 h continua: só com orgScope, grava alt id e webhook_linked', async () => {
    const fb: Row = { id: 'fb', org_id: 'org-1', metadata: { api4com_call_id: 'req-0', gateway: 'g' } };
    const s = store({ fallback: fb });

    const result = await findWebhookCall(s, event(null), ['org-1'], { now: NOW });

    expect(result?.via).toBe('fallback');
    expect(s.findFallback).toHaveBeenCalledWith({
      orgScope: ['org-1'],
      caller: '1001',
      calledSuffix: '99999999',
      sinceIso: '2026-11-12T13:00:00.000Z',
    });
    // Patch sem api4com_call_id nem gateway: só o que o fallback grava.
    expect(s.mergeMetadata).toHaveBeenCalledWith('fb', {
      alt_api4com_ids: ['prov-1'],
      webhook_linked: true,
    });
  });

  it('sem orgScope não usa o fallback', async () => {
    const s = store({ fallback: { id: 'fb', org_id: 'org-1', metadata: {} } });

    expect(await findWebhookCall(s, event(null), [], { now: NOW })).toBeNull();
    expect(s.findFallback).not.toHaveBeenCalled();
  });
});
