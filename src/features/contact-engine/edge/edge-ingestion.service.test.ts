import { describe, expect, it, vi } from 'vitest';

import type { InboundBatchResult } from '@/features/inbound-api/types';

import {
  applyEnrichmentEdge,
  computeEnrichmentPatch,
  ingestLeadsEdge,
  ingestionKey,
  lookupCallEdge,
  type EdgeIngestionPorts,
  type EnrichTargetLead,
} from './edge-ingestion.service';
import {
  callLookupRequestSchema,
  enrichmentRequestSchema,
  leadIngestRequestSchema,
} from './edge-ingestion.schemas';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const LEAD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const auth = { orgId: ORG_A, keyId: null };

function makePorts(over: Partial<EdgeIngestionPorts> = {}, opts: { enabled?: boolean; lead?: EnrichTargetLead | null } = {}) {
  const events = new Map<string, string[]>();
  const batches = new Set<string>();
  const lead: EnrichTargetLead | null =
    opts.lead === undefined ? { id: LEAD_A, enrichment_status: 'pending', values: { razao_social: null, porte: 'ME', cnpj: null } } : opts.lead;
  const ports = {
    isEnabled: vi.fn(async () => opts.enabled ?? true),
    isBatchProcessed: vi.fn(async (_o: string, k: string) => batches.has(k)),
    markBatchProcessed: vi.fn(async (_o: string, k: string) => void batches.add(k)),
    ingestLeads: vi.fn(
      async (_o: string, leads: unknown[]): Promise<InboundBatchResult> => ({
        received: leads.length,
        created: leads.length,
        duplicates: 0,
        updated: 0,
        errors: 0,
        results: leads.map((_, i) => ({ index: i, status: 'created' as const, lead_id: `l${i}` })),
      }),
    ),
    findCall: vi.fn(async () => null),
    loadLead: vi.fn(async () => lead),
    cnpjTaken: vi.fn(async () => false),
    applyEnrichment: vi.fn(async () => true),
    readEvent: vi.fn(async (_o: string, k: string) => (events.has(k) ? { disposition: 'x', reasons: events.get(k)! } : null)),
    recordEvent: vi.fn(async (i: { key: string; reasons: string[] }) => {
      if (events.has(i.key)) return 'duplicate' as const;
      events.set(i.key, i.reasons);
      return 'recorded' as const;
    }),
    ...over,
  };
  return ports as unknown as EdgeIngestionPorts & typeof ports;
}

const leadItem = { first_name: 'Ana', email: 'ana@x.com', telefone: '11999990000', empresa: 'X' };
const leadReq = (over: Record<string, unknown> = {}) =>
  leadIngestRequestSchema.parse({ source: 'leadbroker', idempotency_key: 'lb-batch-0001', leads: [leadItem], ...over });

describe('schemas de ingestão', () => {
  it('rejeita responsável, cadência, consentimento e campos extras vindos do n8n', () => {
    for (const extra of [{ assigned_to: LEAD_A }, { cadence_id: LEAD_A }, { consent_whatsapp: true }, { status: 'qualified' }]) {
      expect(leadIngestRequestSchema.safeParse({ source: 'leadbroker', idempotency_key: 'lb-batch-0001', leads: [{ ...leadItem, ...extra }] }).success).toBe(false);
    }
    expect(leadIngestRequestSchema.safeParse({ source: 'outro', idempotency_key: 'lb-batch-0001', leads: [leadItem] }).success).toBe(false);
  });

  it('enriquecimento não aceita telefone, e-mail nem responsável', () => {
    const base = { lead_id: LEAD_A, idempotency_key: 'enr-000001', provider: 'x', status: 'enriched' };
    expect(enrichmentRequestSchema.safeParse({ ...base, fields: { porte: 'ME' } }).success).toBe(true);
    for (const f of [{ telefone: '1' }, { email: 'a@b.com' }, { assigned_to: LEAD_A }]) {
      expect(enrichmentRequestSchema.safeParse({ ...base, fields: f }).success).toBe(false);
    }
    expect(enrichmentRequestSchema.safeParse({ ...base, fields: {} }).success).toBe(false);
    expect(enrichmentRequestSchema.safeParse({ ...base, status: 'not_found', fields: { porte: 'ME' } }).success).toBe(false);
  });

  it('chamada exige provedor conhecido', () => {
    expect(callLookupRequestSchema.safeParse({ provider: 'api4com', idempotency_key: 'call-0001', external_call_id: 'abc-1' }).success).toBe(true);
    expect(callLookupRequestSchema.safeParse({ provider: 'x', idempotency_key: 'call-0001', external_call_id: 'abc-1' }).success).toBe(false);
  });
});

describe('flag desligada', () => {
  it('as três operações respondem 403 sem ler nem gravar', async () => {
    const p = makePorts({}, { enabled: false });
    const r1 = await ingestLeadsEdge(p, auth, leadReq());
    const r2 = await lookupCallEdge(p, auth, { provider: 'api4com', idempotency_key: 'call-0001', external_call_id: 'a' });
    const r3 = await applyEnrichmentEdge(p, auth, enrichmentRequestSchema.parse({ lead_id: LEAD_A, idempotency_key: 'enr-000001', provider: 'x', status: 'not_found' }));
    for (const r of [r1, r2, r3]) {
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('adapter_disabled');
    }
    expect(p.ingestLeads).not.toHaveBeenCalled();
    expect(p.findCall).not.toHaveBeenCalled();
    expect(p.loadLead).not.toHaveBeenCalled();
    expect(p.applyEnrichment).not.toHaveBeenCalled();
    expect(p.recordEvent).not.toHaveBeenCalled();
  });
});

describe('ingestLeadsEdge', () => {
  it('ingere e o replay da mesma chave não ingere de novo', async () => {
    const p = makePorts();
    const a = await ingestLeadsEdge(p, auth, leadReq());
    expect(a.status).toBe(200);
    expect((a.body.data as { created: number }).created).toBe(1);
    const b = await ingestLeadsEdge(p, auth, leadReq());
    expect((b.body.data as { replay: boolean }).replay).toBe(true);
    expect(p.ingestLeads).toHaveBeenCalledTimes(1);
  });

  it('lote com erro não é marcado e pede reenvio dos que falharam', async () => {
    const p = makePorts({
      ingestLeads: vi.fn(async () => ({ received: 1, created: 0, duplicates: 0, updated: 0, errors: 1, results: [{ index: 0, status: 'error' as const, error: 'x' }] })),
    });
    const r = await ingestLeadsEdge(p, auth, leadReq());
    expect((r.body.data as { next_action: string }).next_action).toBe('retry_failed');
    expect(p.markBatchProcessed).not.toHaveBeenCalled();
  });

  it('a chave de idempotência é escopada por organização', () => {
    expect(ingestionKey(ORG_A, 'leads', 'k-123456')).not.toBe(ingestionKey(ORG_B, 'leads', 'k-123456'));
    expect(ingestionKey(ORG_A, 'leads', 'k-123456')).not.toBe(ingestionKey(ORG_A, 'enrichment', 'k-123456'));
  });

  it('falha de leitura da idempotência é 503 retentável e nada é ingerido', async () => {
    const p = makePorts({ isBatchProcessed: vi.fn(async () => 'error' as const) });
    const r = await ingestLeadsEdge(p, auth, leadReq());
    expect(r.status).toBe(503);
    expect(r.body.retryable).toBe(true);
    expect(p.ingestLeads).not.toHaveBeenCalled();
  });
});

describe('lookupCallEdge', () => {
  it('ligação conhecida: skip, sem criar nada', async () => {
    const p = makePorts({ findCall: vi.fn(async () => ({ callId: 'c1', leadId: LEAD_A, status: 'significant' })) });
    const r = await lookupCallEdge(p, auth, { provider: 'api4com', idempotency_key: 'call-0001', external_call_id: 'a' });
    expect((r.body.data as { next_action: string; known: boolean }).known).toBe(true);
    expect((r.body.data as { next_action: string }).next_action).toBe('skip');
  });

  it('desconhecida: forward ao webhook atual', async () => {
    const r = await lookupCallEdge(makePorts(), auth, { provider: 'callface', idempotency_key: 'call-0001', external_call_id: 'a' });
    expect((r.body.data as { next_action: string }).next_action).toBe('forward');
  });

  it('erro de leitura: 503 e não "desconhecida" (evita duplicar)', async () => {
    const r = await lookupCallEdge(makePorts({ findCall: vi.fn(async () => 'error' as const) }), auth, { provider: 'api4com', idempotency_key: 'call-0001', external_call_id: 'a' });
    expect(r.status).toBe(503);
  });
});

describe('computeEnrichmentPatch', () => {
  it('só preenche campo vazio e nunca sobrescreve', () => {
    const { patch, skipped } = computeEnrichmentPatch({ razao_social: null, porte: 'ME', website: '  ' }, { razao_social: 'ACME', porte: 'EPP', website: 'https://a.com' }, false);
    expect(patch).toEqual({ razao_social: 'ACME', website: 'https://a.com' });
    expect(skipped).toEqual(['porte_already_set']);
  });

  it('cnpj em uso por outro lead não é aplicado', () => {
    expect(computeEnrichmentPatch({ cnpj: null }, { cnpj: '12345678000190' }, true)).toEqual({ patch: {}, skipped: ['cnpj_in_use'] });
  });
});

describe('applyEnrichmentEdge', () => {
  const req = (over: Record<string, unknown> = {}) =>
    enrichmentRequestSchema.parse({ lead_id: LEAD_A, idempotency_key: 'enr-000001', provider: 'apollo', status: 'enriched', fields: { razao_social: 'ACME', porte: 'EPP' }, ...over });

  it('aplica só o vazio, grava trilha sem valores e o replay não reaplica', async () => {
    const p = makePorts();
    const a = await applyEnrichmentEdge(p, auth, req());
    expect((a.body.data as { applied: string[] }).applied).toEqual(['razao_social']);
    expect(p.applyEnrichment).toHaveBeenCalledWith(expect.objectContaining({ patch: { razao_social: 'ACME' }, status: 'enriched' }));
    const rec = vi.mocked(p.recordEvent).mock.calls[0]![0];
    expect(JSON.stringify(rec)).not.toContain('ACME');
    const b = await applyEnrichmentEdge(p, auth, req());
    expect((b.body.data as { replay: boolean }).replay).toBe(true);
    expect(p.applyEnrichment).toHaveBeenCalledTimes(1);
  });

  it('lead de outra organização ou inexistente: 404 sem escrita', async () => {
    const p = makePorts({}, { lead: null });
    const r = await applyEnrichmentEdge(p, { orgId: ORG_B, keyId: null }, req());
    expect(r.status).toBe(404);
    expect(p.applyEnrichment).not.toHaveBeenCalled();
  });

  it('falha posterior não rebaixa lead já enriquecido', async () => {
    const p = makePorts({}, { lead: { id: LEAD_A, enrichment_status: 'enriched', values: {} } });
    await applyEnrichmentEdge(p, auth, enrichmentRequestSchema.parse({ lead_id: LEAD_A, idempotency_key: 'enr-000002', provider: 'x', status: 'failed' }));
    expect(p.applyEnrichment).not.toHaveBeenCalled();
  });

  it('falha ao gravar: 503 e a trilha não é registrada', async () => {
    const p = makePorts({ applyEnrichment: vi.fn(async () => false) });
    const r = await applyEnrichmentEdge(p, auth, req());
    expect(r.status).toBe(503);
    expect(p.recordEvent).not.toHaveBeenCalled();
  });

  it('a flag é lida com escopo da organização', async () => {
    const p = makePorts();
    await applyEnrichmentEdge(p, auth, req());
    expect(p.isEnabled).toHaveBeenCalledWith(ORG_A);
  });
});
