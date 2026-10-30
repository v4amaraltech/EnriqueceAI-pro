import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryBuilder, mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';

const mockFrom = mockSupabaseFrom as unknown as ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

const adapter = {
  pushContact: vi.fn(),
  pushDeal: vi.fn(),
  fetchUsers: vi.fn(),
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

import { pushLeadToCrm } from './crm-push.service';
import { clearKommoUsersCache } from './crm-responsible';

const ORG = 'org-1';
const LEAD = 'lead-next360';
const OPTS = { provider: 'kommo' as const, pipelineId: '13390831', stageId: '103287655' };

/**
 * Banco "limpo": sem deal, sem contato sincronizado, conexão Kommo (padrão de
 * responsável opcional), lead com closer, closer com e-mail.
 */
function installDb(opts: { closerId: string | null; closerEmail?: string; defaultResponsible?: string | null }) {
  mockFrom.mockImplementation((table: string) => {
    const b = createQueryBuilder();
    if (table === 'crm_connections') {
      b.single = vi.fn(() =>
        Promise.resolve({
          data: {
            id: 'conn-1', org_id: ORG, crm_provider: 'kommo', credentials_encrypted: '{}', field_mapping: null,
            status: 'connected', default_responsible_user_id: opts.defaultResponsible ?? null,
          },
          error: null,
        }),
      );
    }
    if (table === 'leads') {
      b.single = vi.fn(() =>
        Promise.resolve({
          data: { id: LEAD, org_id: ORG, nome_fantasia: 'NEXT360 Telecom', custom_field_values: null, closer_id: opts.closerId },
          error: null,
        }),
      );
    }
    if (table === 'closers') {
      b.maybeSingle = vi.fn(() => Promise.resolve({ data: opts.closerEmail ? { email: opts.closerEmail } : null, error: null }));
    }
    return b;
  });
}

describe('pushLeadToCrm (Kommo) — responsável do card', () => {
  beforeEach(() => {
    resetMocks();
    clearKommoUsersCache();
    adapter.pushContact.mockReset().mockResolvedValue({ external_id: 'contact-9' });
    adapter.pushDeal.mockReset().mockResolvedValue({ external_id: 'deal-9' });
    adapter.getFieldDefinitions.mockReset().mockResolvedValue({ types: new Map(), enums: new Map() });
    adapter.fetchUsers.mockReset().mockResolvedValue([
      { id: 11111111, name: 'Vini', email: 'vini@v4company.com' },
      { id: 15013532, name: 'Jhonata', email: 'jhonata.banqueri@v4company.com' },
    ]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('crm_options sem responsibleUserId: o card nasce com o closer da reunião', async () => {
    installDb({ closerId: 'closer-jhonata', closerEmail: 'jhonata.banqueri@v4company.com' });

    const res = await pushLeadToCrm(ORG, LEAD, OPTS);

    expect(res).toMatchObject({ dealCreated: true, dealExternalId: 'deal-9' });
    expect(adapter.pushDeal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ responsibleUserId: 15013532 }));
  });

  it('responsibleUserId explícito do modal é respeitado', async () => {
    installDb({ closerId: 'closer-jhonata', closerEmail: 'jhonata.banqueri@v4company.com' });

    await pushLeadToCrm(ORG, LEAD, { ...OPTS, responsibleUserId: '11111111' });

    expect(adapter.pushDeal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ responsibleUserId: 11111111 }));
    expect(adapter.fetchUsers).not.toHaveBeenCalled();
  });

  it('closer sem usuário no Kommo: cai no padrão da conexão', async () => {
    installDb({ closerId: 'closer-x', closerEmail: 'x@fora.com', defaultResponsible: '11111111' });

    await pushLeadToCrm(ORG, LEAD, OPTS);

    expect(adapter.pushDeal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ responsibleUserId: 11111111 }));
  });

  it('sem closer e sem padrão: card sem responsável (como antes) e aviso com o leadId', async () => {
    installDb({ closerId: null });

    await pushLeadToCrm(ORG, LEAD, OPTS);

    expect(adapter.fetchUsers).not.toHaveBeenCalled();
    expect(adapter.pushDeal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ responsibleUserId: undefined }));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('sem responsável'), LEAD, ORG);
  });
});
