import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRpc = vi.fn();
const mockAuth = vi.fn();
const mockLost = vi.fn();
const mockLog = vi.fn();

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({ rpc: mockRpc }) }));
vi.mock('@/lib/security/rate-limit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock('@/features/inbound-api/services/api-key-auth', () => ({ authenticateApiKey: (...a: unknown[]) => mockAuth(...a) }));
vi.mock('@/features/cadences/services/cadence-end-loss.service', () => ({ markLeadLostOnCadenceEnd: (...a: unknown[]) => mockLost(...a) }));
vi.mock('@/features/leads/actions/log-lead-event', () => ({ logLeadEvent: (...a: unknown[]) => mockLog(...a) }));

import { POST } from './route';

const ORG = '11111111-1111-4111-8111-111111111111';
const EVENT = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const EXEC = '0f8fad5b-d9cb-469f-a165-70867728950e';

function req(body: unknown) {
  return new Request('https://example.com/api/webhooks/external-step', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer key' },
    body: JSON.stringify(body),
  });
}

const baseRow = {
  aplicado: true, duplicado: false, motivo: 'aplicado', enrollment_id: 'e1', lead_id: 'l1', cadence_id: 'c1',
  step_id: 's1', interaction_id: 'i1', advanced: true, completed: false, new_step: 3,
};

describe('POST /api/webhooks/external-step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ orgId: ORG, keyId: 'k' });
    mockLost.mockResolvedValue({});
    mockLog.mockResolvedValue(undefined);
  });

  it('401 sem API key', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(req({ evento: 'chamada_finalizada', event_id: EVENT, execution_id: EXEC }));
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('400 quando falta event_id ou execution_id', async () => {
    const res = await POST(req({ evento: 'chamada_finalizada', execution_id: EXEC }));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('aplica o evento: chama a RPC com org, ids, evento e payload inteiro', async () => {
    mockRpc.mockResolvedValue({ data: [baseRow], error: null });
    const body = {
      evento: 'chamada_finalizada', event_id: EVENT, execution_id: EXEC, call_sid: 'CA1',
      resultado: { confirmado: true, resumo: 'topou' }, gravacao_url: 'https://r',
    };
    const res = await POST(req(body));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.aplicado).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('confirm_external_step', expect.objectContaining({
      p_org_id: ORG, p_event_id: EVENT, p_execution_id: EXEC, p_evento: 'chamada_finalizada',
      p_call_sid: 'CA1', p_resultado: { confirmado: true, resumo: 'topou' }, p_payload: body, p_performed_by: null,
    }));
    expect(mockLost).not.toHaveBeenCalled();
  });

  it('event_id repetido → 200 duplicado, sem efeitos', async () => {
    mockRpc.mockResolvedValue({ data: [{ ...baseRow, aplicado: false, duplicado: true, motivo: 'event_id_ja_processado' }], error: null });
    const res = await POST(req({ evento: 'chamada_finalizada', event_id: EVENT, execution_id: EXEC }));
    const json = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(json.duplicado).toBe(true);
    expect(json.aplicado).toBe(false);
    expect(mockLost).not.toHaveBeenCalled();
  });

  it('execution_id desconhecida → 404', async () => {
    mockRpc.mockResolvedValue({ data: [{ ...baseRow, aplicado: false, motivo: 'execution_id_desconhecida' }], error: null });
    const res = await POST(req({ evento: 'caixa_postal', event_id: EVENT, execution_id: EXEC }));
    expect(res.status).toBe(404);
  });

  it('cadência concluída → registra evento e aplica Perdido de fim de cadência', async () => {
    mockRpc.mockResolvedValue({ data: [{ ...baseRow, completed: true, new_step: null }], error: null });
    const res = await POST(req({ evento: 'chamada_falhou', event_id: EVENT, execution_id: EXEC, motivo: 'numero_invalido' }));
    expect(res.status).toBe(200);
    expect(mockLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: 'cadence_completed', leadId: 'l1' }));
    expect(mockLost).toHaveBeenCalledWith({ orgId: ORG, leadId: 'l1', cadenceId: 'c1', enrollmentId: 'e1' });
  });

  it('erro na RPC → 500 (o chamador reenvia; a idempotência segura a repetição)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const res = await POST(req({ evento: 'chamada_finalizada', event_id: EVENT, execution_id: EXEC }));
    expect(res.status).toBe(500);
  });
});
