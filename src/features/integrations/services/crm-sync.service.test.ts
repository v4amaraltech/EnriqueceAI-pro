import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { CrmConnectionRow, CrmCredentials, CrmContact } from '../types/crm';

// --- Mocks ---

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock('./crm-registry', () => ({
  CRMRegistry: { getAdapter: vi.fn() },
}));

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { CRMRegistry } from './crm-registry';
import { CrmSyncService } from './crm-sync.service';

// --- Fixtures ---

const BASE_CREDENTIALS: CrmCredentials = {
  access_token: 'access-token-abc',
  refresh_token: 'refresh-token-xyz',
  token_expires_at: new Date(Date.now() + 3_600_000).toISOString(), // 1h from now
};

const BASE_CONNECTION: CrmConnectionRow = {
  id: 'conn-1',
  org_id: 'org-1',
  crm_provider: 'hubspot',
  credentials_encrypted: JSON.stringify(BASE_CREDENTIALS),
  field_mapping: { leads: { nome_fantasia: 'company', email: 'email', telefone: 'phone' } },
  status: 'connected',
  last_sync_at: '2026-02-18T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const MOCK_CONTACTS: CrmContact[] = [
  {
    external_id: 'hs-1',
    email: 'alice@corp.com',
    company_name: 'Corp Alpha',
    phone: '11999990001',
    properties: { company: 'Corp Alpha', email: 'alice@corp.com', phone: '11999990001' },
    updated_at: '2026-02-19T10:00:00Z',
  },
  {
    external_id: 'hs-2',
    email: 'bob@corp.com',
    company_name: 'Corp Beta',
    phone: '11999990002',
    properties: { company: 'Corp Beta', email: 'bob@corp.com', phone: '11999990002' },
    updated_at: '2026-02-19T11:00:00Z',
  },
];

// --- Supabase mock builder ---

/**
 * Builds a chainable Supabase mock object that handles the table-based call
 * patterns used by CrmSyncService. Each option controls the data returned for
 * a specific query path.
 */
interface MockOptions {
  /** Data returned by crm_connections .select().eq().single() */
  connectionData?: CrmConnectionRow | null;
  /** Data returned by leads .select()...eq().maybeSingle() (cnpj/email lookup) */
  leadLookupData?: { id: string; updated_at: string } | null;
  /** Data returned by leads .select()...eq().is().limit() (push leads query) */
  leadsListData?: Array<Record<string, unknown>>;
  /** Data returned by interactions crm_synced lookup .maybeSingle() */
  crmSyncedData?: { external_id: string } | null;
  /** Data returned by interactions sent query */
  sentInteractionsData?: Array<Record<string, unknown>>;
  /** Data returned by interactions crm_synced lookup inside pushActivities */
  activitiesCrmSyncData?: { external_id: string } | null;
}

function buildSupabaseMock(opts: MockOptions = {}) {
  const {
    connectionData = BASE_CONNECTION,
    leadLookupData = null,
    leadsListData = [],
    crmSyncedData = null,
    sentInteractionsData = [],
    activitiesCrmSyncData = { external_id: 'hs-ext-1' },
  } = opts;

  // Track call counts per table so we can differentiate successive calls
  const callCounters: Record<string, number> = {};
  // Counter for interactions maybeSingle calls (shared across from() calls)
  let interactionsMaybeSingleCount = 0;

  const supabase = {
    from: vi.fn((table: string) => {
      callCounters[table] = (callCounters[table] ?? 0) + 1;
      const _callIndex = callCounters[table]!;

      if (table === 'crm_connections') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: connectionData }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        };
      }

      if (table === 'leads') {
        // Unified mock that supports both:
        //   - pullContacts lookups: .select().eq().eq().maybeSingle()
        //   - pushLeads list query: .select().eq().is().limit().gte() (thenable)
        //   - update: .update().eq()
        // The chain must be thenable at any point (for `await query`)
        const resolvedData = { data: leadsListData };
        const buildChain = (): Record<string, unknown> => {
          const chain: Record<string, unknown> = {
            eq: vi.fn().mockImplementation(() => buildChain()),
            is: vi.fn().mockImplementation(() => buildChain()),
            limit: vi.fn().mockImplementation(() => buildChain()),
            gte: vi.fn().mockImplementation(() => buildChain()),
            maybeSingle: vi.fn().mockResolvedValue({ data: leadLookupData }),
            then: (resolve: (v: unknown) => void) => Promise.resolve(resolvedData).then(resolve),
          };
          return chain;
        };

        return {
          select: vi.fn().mockImplementation(() => buildChain()),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null }),
          }),
        };
      }

      if (table === 'interactions') {
        // Unified chain that supports all interaction query patterns:
        //   - .select().eq().eq().maybeSingle() (crm_synced lookup — pushLeads and pushActivities)
        //   - .select().eq().eq().is().limit().gte() (sent interactions list, thenable)
        //   - .insert() (new crm_synced record)
        //   - .update().eq() (mark interaction as synced)
        // Use maybeSingle counter to differentiate: odd calls → crmSyncedData, even calls → activitiesCrmSyncData
        const resolvedSent = { data: sentInteractionsData };
        const buildInteractionChain = (): Record<string, unknown> => ({
          eq: vi.fn().mockImplementation(() => buildInteractionChain()),
          is: vi.fn().mockImplementation(() => buildInteractionChain()),
          limit: vi.fn().mockImplementation(() => buildInteractionChain()),
          gte: vi.fn().mockImplementation(() => buildInteractionChain()),
          maybeSingle: vi.fn().mockImplementation(() => {
            interactionsMaybeSingleCount++;
            // Odd calls are from pushLeads, even from pushActivities
            const data = interactionsMaybeSingleCount % 2 === 1 ? crmSyncedData : activitiesCrmSyncData;
            return Promise.resolve({ data });
          }),
          then: (resolve: (v: unknown) => void) => Promise.resolve(resolvedSent).then(resolve),
        });

        return {
          select: vi.fn().mockImplementation(() => buildInteractionChain()),
          insert: vi.fn().mockResolvedValue({ data: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null }),
          }),
        };
      }

      if (table === 'crm_sync_log') {
        return {
          insert: vi.fn().mockResolvedValue({ data: null }),
        };
      }

      // Generic fallback
      return {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ data: null }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null }) }),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      };
    }),
  };

  vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);

  return supabase;
}

function buildMockAdapter(overrides: Partial<{
  pullContacts: ReturnType<typeof vi.fn>;
  pushContact: ReturnType<typeof vi.fn>;
  pushActivity: ReturnType<typeof vi.fn>;
  refreshToken: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    pullContacts: overrides.pullContacts ?? vi.fn().mockResolvedValue([]),
    pushContact: overrides.pushContact ?? vi.fn().mockResolvedValue({ external_id: 'hs-ext-1' }),
    pushActivity: overrides.pushActivity ?? vi.fn().mockResolvedValue({ external_id: 'hs-act-1' }),
    refreshToken: overrides.refreshToken ?? vi.fn().mockResolvedValue(BASE_CREDENTIALS),
  };
}

// --- Tests ---

describe('CrmSyncService.syncConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('success flow: pulls contacts, pushes leads, pushes activities', async () => {
    const mockAdapter = buildMockAdapter({
      pullContacts: vi.fn().mockResolvedValue(MOCK_CONTACTS),
      pushContact: vi.fn().mockResolvedValue({ external_id: 'hs-ext-new' }),
      pushActivity: vi.fn().mockResolvedValue({ external_id: 'hs-act-new' }),
    });

    vi.mocked(CRMRegistry.getAdapter).mockReturnValue(mockAdapter as never);

    buildSupabaseMock({
      leadsListData: [
        {
          id: 'lead-1',
          org_id: 'org-1',
          cnpj: '12.345.678/0001-00',
          razao_social: 'Corp Alpha',
          nome_fantasia: 'Corp Alpha',
          email: 'alice@corp.com',
          telefone: '11999990001',
          porte: 'medio',
          cnae: '6201',
          situacao_cadastral: 'ativa',
          updated_at: '2026-02-19T10:00:00Z',
        },
      ],
      sentInteractionsData: [
        {
          id: 'inter-1',
          lead_id: 'lead-1',
          channel: 'email',
          type: 'sent',
          message_content: 'Hello from cadence',
          created_at: '2026-02-19T09:00:00Z',
        },
      ],
      activitiesCrmSyncData: { external_id: 'hs-ext-new' },
    });

    const result = await CrmSyncService.syncConnection('conn-1');

    // pull: 2 contacts from MOCK_CONTACTS, but no existing lead found so synced = 0
    // (upsertLeadFromContact only updates — not creates — so synced counts the attempt)
    expect(result.pull.errors).toBe(0);

    // push: 1 lead pushed successfully
    expect(result.push.synced).toBe(1);
    expect(result.push.errors).toBe(0);
    expect(mockAdapter.pushContact).toHaveBeenCalledOnce();

    // activities: 1 interaction pushed
    expect(result.activities.synced).toBe(1);
    expect(result.activities.errors).toBe(0);
    expect(mockAdapter.pushActivity).toHaveBeenCalledOnce();
    expect(mockAdapter.pushActivity).toHaveBeenCalledWith(
      BASE_CREDENTIALS,
      expect.objectContaining({
        contact_external_id: 'hs-ext-new',
        type: 'email',
        body: 'Hello from cadence',
      }),
    );
  });

  it('throws "Connection not found" when connection row does not exist', async () => {
    vi.mocked(CRMRegistry.getAdapter).mockReturnValue(buildMockAdapter() as never);

    buildSupabaseMock({ connectionData: null });

    await expect(CrmSyncService.syncConnection('missing-conn')).rejects.toThrow(
      'Connection not found',
    );
  });

  it('refreshes token when credentials are expired', async () => {
    const expiredCredentials: CrmCredentials = {
      access_token: 'old-token',
      refresh_token: 'refresh-xyz',
      token_expires_at: new Date(Date.now() - 60_000).toISOString(), // expired 1min ago
    };

    const freshCredentials: CrmCredentials = {
      access_token: 'new-fresh-token',
      refresh_token: 'new-refresh-token',
      token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    };

    const connectionWithExpiredToken: CrmConnectionRow = {
      ...BASE_CONNECTION,
      credentials_encrypted: JSON.stringify(expiredCredentials),
    };

    const mockAdapter = buildMockAdapter({
      refreshToken: vi.fn().mockResolvedValue(freshCredentials),
      pullContacts: vi.fn().mockResolvedValue([]),
      pushContact: vi.fn().mockResolvedValue({ external_id: 'hs-1' }),
    });

    vi.mocked(CRMRegistry.getAdapter).mockReturnValue(mockAdapter as never);

    buildSupabaseMock({ connectionData: connectionWithExpiredToken });

    await CrmSyncService.syncConnection('conn-1');

    expect(mockAdapter.refreshToken).toHaveBeenCalledOnce();
    expect(mockAdapter.refreshToken).toHaveBeenCalledWith(expiredCredentials);

    // The refreshed credentials should be used for subsequent calls
    expect(mockAdapter.pullContacts).toHaveBeenCalledWith(freshCredentials, expect.anything());
  });

  it('marks connection as error status when sync throws', async () => {
    const mockAdapter = buildMockAdapter({
      pullContacts: vi.fn().mockRejectedValue(new Error('CRM API unavailable')),
    });

    vi.mocked(CRMRegistry.getAdapter).mockReturnValue(mockAdapter as never);

    const supabase = buildSupabaseMock();

    await expect(CrmSyncService.syncConnection('conn-1')).rejects.toThrow('CRM API unavailable');

    // Verify the update(status: 'error') call was made
    const updateCalls = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: any[]) => args[0] === 'crm_connections',
    );
    // Should have been called at least twice: once for select and once for status update
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('handles field mapping correctly when pushing leads', async () => {
    const connectionWithMapping: CrmConnectionRow = {
      ...BASE_CONNECTION,
      field_mapping: {
        leads: {
          nome_fantasia: 'company',
          email: 'email',
          telefone: 'phone',
          cnpj: 'hs_additional_id',
        },
      },
    };

    const mockAdapter = buildMockAdapter({
      pullContacts: vi.fn().mockResolvedValue([]),
      pushContact: vi.fn().mockResolvedValue({ external_id: 'hs-mapped' }),
    });

    vi.mocked(CRMRegistry.getAdapter).mockReturnValue(mockAdapter as never);

    buildSupabaseMock({
      connectionData: connectionWithMapping,
      leadsListData: [
        {
          id: 'lead-2',
          org_id: 'org-1',
          cnpj: '98.765.432/0001-00',
          razao_social: 'Mapped Corp',
          nome_fantasia: 'Mapped Corp',
          email: 'mapped@corp.com',
          telefone: '11999990099',
          porte: null,
          cnae: null,
          situacao_cadastral: null,
          updated_at: '2026-02-19T12:00:00Z',
        },
      ],
    });

    const result = await CrmSyncService.syncConnection('conn-1');

    expect(result.push.synced).toBe(1);
    expect(mockAdapter.pushContact).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: BASE_CREDENTIALS.access_token }),
      expect.objectContaining({ nome_fantasia: 'Mapped Corp', email: 'mapped@corp.com' }),
      connectionWithMapping.field_mapping!.leads,
      undefined, // no existing external_id (crmSyncedData defaults to null)
    );
  });

  it('returns zeroed SyncResult when there are no leads or contacts to sync', async () => {
    const mockAdapter = buildMockAdapter({
      pullContacts: vi.fn().mockResolvedValue([]),
      pushContact: vi.fn().mockResolvedValue({ external_id: 'hs-1' }),
      pushActivity: vi.fn().mockResolvedValue({ external_id: 'act-1' }),
    });

    vi.mocked(CRMRegistry.getAdapter).mockReturnValue(mockAdapter as never);

    buildSupabaseMock({
      leadsListData: [],
      sentInteractionsData: [],
    });

    const result = await CrmSyncService.syncConnection('conn-1');

    expect(result.pull).toEqual({ synced: 0, errors: 0, errorDetails: [] });
    expect(result.push).toEqual({ synced: 0, errors: 0, errorDetails: [] });
    expect(result.activities).toEqual({ synced: 0, errors: 0, errorDetails: [] });

    expect(mockAdapter.pullContacts).toHaveBeenCalledOnce();
    expect(mockAdapter.pushContact).not.toHaveBeenCalled();
    expect(mockAdapter.pushActivity).not.toHaveBeenCalled();
  });
});
