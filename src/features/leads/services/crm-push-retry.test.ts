import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryBuilder, mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';

const mockFrom = mockSupabaseFrom as unknown as ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

const adapter = {
  pushContact: vi.fn(),
  pushDeal: vi.fn(),
  getFieldDefinitions: vi.fn(),
  refreshToken: vi.fn(),
};

vi.mock('@/features/integrations/services/crm-registry', () => ({
  CRMRegistry: { getAdapter: () => adapter },
}));

vi.mock('@/features/integrations/services/crm-token', () => ({
  ensureFreshCredentials: vi.fn(() => Promise.resolve({ access_token: 't', refresh_token: 'r', subdomain: 'v4' })),
}));

vi.mock('@/features/cadences/services/webhook-dispatch.service', () => ({
  dispatchWebhookEvent: vi.fn(() => Promise.resolve()),
}));

import { pushConfirmedMeetingToCrm, pushLeadToCrm } from './crm-push.service';

const ORG = 'org-1';
const LEAD = 'lead-1';
const OPTS = { provider: 'kommo' as const, pipelineId: '13390831', stageId: '103287655' };

function undiciError(code: string) {
  return new Error('fetch failed', { cause: Object.assign(new Error(`getaddrinfo ${code} v4.kommo.com`), { code }) });
}

/**
 * Banco "limpo": sem deal, sem contato sincronizado, conexão Kommo, lead
 * existente. `inserts` registra o que foi gravado em `interactions`.
 */
function installDb() {
  const inserts: Array<Record<string, unknown>> = [];
  mockFrom.mockImplementation((table: string) => {
    const b = createQueryBuilder();
    if (table === 'crm_connections') {
      b.single = vi.fn(() =>
        Promise.resolve({
          data: { id: 'conn-1', org_id: ORG, crm_provider: 'kommo', credentials_encrypted: '{}', field_mapping: null, status: 'connected' },
          error: null,
        }),
      );
    }
    if (table === 'leads') {
      b.single = vi.fn(() =>
        Promise.resolve({ data: { id: LEAD, org_id: ORG, nome_fantasia: 'Matte Doce', custom_field_values: null }, error: null }),
      );
    }
    if (table === 'interactions') {
      b.insert = vi.fn((row: Record<string, unknown>) => {
        inserts.push(row);
        return b;
      });
    }
    return b;
  });
  return inserts;
}

describe('pushLeadToCrm — retry em erro de rede', () => {
  beforeEach(() => {
    resetMocks();
    adapter.pushContact.mockReset();
    adapter.pushDeal.mockReset();
    adapter.getFieldDefinitions.mockReset().mockResolvedValue({ types: new Map(), enums: new Map() });
    adapter.pushContact.mockResolvedValue({ external_id: 'contact-9' });
    adapter.pushDeal.mockResolvedValue({ external_id: 'deal-9' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('pushDeal cai por DNS duas vezes e passa na terceira: um card só', async () => {
    const inserts = installDb();
    adapter.pushDeal
      .mockRejectedValueOnce(undiciError('EAI_AGAIN'))
      .mockRejectedValueOnce(undiciError('EAI_AGAIN'))
      .mockResolvedValueOnce({ external_id: 'deal-9' });

    const res = await pushLeadToCrm(ORG, LEAD, OPTS, { delaysMs: [0, 0, 0] });

    expect(res).toMatchObject({ dealCreated: true, dealExternalId: 'deal-9' });
    expect(adapter.pushDeal).toHaveBeenCalledTimes(3);
    expect(inserts.filter((i) => i.type === 'crm_deal_created')).toHaveLength(1);
  });

  it('pushContact cai por rede sem contato prévio: relança e a próxima tentativa cria o card', async () => {
    const inserts = installDb();
    adapter.pushContact
      .mockRejectedValueOnce(undiciError('ECONNRESET'))
      .mockResolvedValueOnce({ external_id: 'contact-9' });

    const res = await pushLeadToCrm(ORG, LEAD, OPTS, { delaysMs: [0, 0, 0] });

    expect(res.dealCreated).toBe(true);
    expect(adapter.pushContact).toHaveBeenCalledTimes(2);
    expect(adapter.pushDeal).toHaveBeenCalledTimes(1);
    expect(inserts.filter((i) => i.type === 'crm_synced')).toHaveLength(1);
  });

  it('NÃO repete em erro 4xx do Kommo: uma chamada e o erro sobe', async () => {
    installDb();
    adapter.pushDeal.mockRejectedValue(new Error('Kommo API error (400): {"validation-errors":[]}'));

    await expect(pushLeadToCrm(ORG, LEAD, OPTS, { delaysMs: [0, 0, 0] })).rejects.toThrow('Kommo API error (400)');
    expect(adapter.pushDeal).toHaveBeenCalledTimes(1);
  });

  it('pushContact com 4xx segue o fluxo antigo (loga e devolve no_contact_id, sem repetir)', async () => {
    installDb();
    adapter.pushContact.mockRejectedValue(new Error('Kommo API error (400): bad contact'));

    const res = await pushLeadToCrm(ORG, LEAD, OPTS, { delaysMs: [0, 0, 0] });

    expect(res).toMatchObject({ dealCreated: false, skippedReason: 'no_contact_id' });
    expect(adapter.pushContact).toHaveBeenCalledTimes(1);
    expect(adapter.pushDeal).not.toHaveBeenCalled();
  });

  it('sem política (padrão do clique de Ganho) faz uma tentativa só', async () => {
    installDb();
    adapter.pushDeal.mockRejectedValue(undiciError('EAI_AGAIN'));

    await expect(pushLeadToCrm(ORG, LEAD, OPTS)).rejects.toThrow('fetch failed');
    expect(adapter.pushDeal).toHaveBeenCalledTimes(1);
  });

  it('esgotou as tentativas: console.error com o leadId e o motivo, e o erro sobe', async () => {
    installDb();
    adapter.pushDeal.mockRejectedValue(undiciError('EAI_AGAIN'));

    await expect(pushLeadToCrm(ORG, LEAD, OPTS, { delaysMs: [0, 0] })).rejects.toThrow('fetch failed');

    expect(adapter.pushDeal).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('push abandonado por erro de rede'),
      LEAD,
      ORG,
      3,
      expect.stringContaining('EAI_AGAIN'),
    );
  });

  it('pushConfirmedMeetingToCrm repete por padrão (caminho em segundo plano)', async () => {
    vi.useFakeTimers();
    installDb();
    // 1ª consulta em interactions = lead_won (crm_options salvos no Ganho)
    let interactionsCall = 0;
    const base = mockFrom.getMockImplementation() as (table: string) => Record<string, unknown>;
    mockFrom.mockImplementation((table: string) => {
      const b = base(table);
      if (table === 'interactions') {
        b.maybeSingle = vi.fn(() => {
          interactionsCall += 1;
          return Promise.resolve({
            data: interactionsCall === 1 ? { metadata: { system_event: 'lead_won', crm_options: OPTS } } : null,
            error: null,
          });
        });
      }
      return b;
    });
    adapter.pushDeal.mockRejectedValueOnce(undiciError('EAI_AGAIN')).mockResolvedValueOnce({ external_id: 'deal-9' });

    const promise = pushConfirmedMeetingToCrm(ORG, LEAD);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toMatchObject({ dealCreated: true });
    expect(adapter.pushDeal).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
