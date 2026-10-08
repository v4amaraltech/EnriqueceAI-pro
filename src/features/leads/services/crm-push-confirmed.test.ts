import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryBuilder, mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';

const mockFrom = mockSupabaseFrom as unknown as ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

import { pushConfirmedMeetingToCrm } from './crm-push.service';

/**
 * interactions: 1ª consulta = interação lead_won (metadata), 2ª = dedup
 * crm_deal_created (devolve um deal existente → pushLeadToCrm para cedo).
 * crm_connections: registra se os defaults da conexão foram consultados.
 */
function installFake(wonMetadata: Record<string, unknown> | null) {
  const tables: string[] = [];
  let interactionsCall = 0;
  mockFrom.mockImplementation((table: string) => {
    tables.push(table);
    const b = createQueryBuilder();
    if (table === 'interactions') {
      b.maybeSingle = vi.fn(() => {
        interactionsCall += 1;
        return Promise.resolve({
          data: interactionsCall === 1 ? { metadata: wonMetadata } : { external_id: 'deal-1' },
          error: null,
        });
      });
    }
    if (table === 'crm_connections') {
      b.maybeSingle = vi.fn(() =>
        Promise.resolve({
          data: { crm_provider: 'kommo', default_pipeline_id: 'p-def', default_stage_id: 's-def', default_responsible_user_id: null, status: 'connected' },
          error: null,
        }),
      );
    }
    return b;
  });
  return tables;
}

describe('pushConfirmedMeetingToCrm', () => {
  beforeEach(() => resetMocks());

  it('usa o funil/etapa salvos no Ganho (crm_options) sem consultar os defaults', async () => {
    const tables = installFake({
      system_event: 'lead_won',
      crm_options: { provider: 'kommo', pipelineId: 'p-1', stageId: 's-1' },
    });

    const res = await pushConfirmedMeetingToCrm('org-1', 'lead-1');

    expect(res.skippedReason).toBe('already_synced');
    expect(tables).not.toContain('crm_connections');
  });

  it('cai nos defaults da conexão quando o Ganho veio sem modal', async () => {
    const tables = installFake({ system_event: 'lead_won' });

    const res = await pushConfirmedMeetingToCrm('org-1', 'lead-1');

    expect(res.skippedReason).toBe('already_synced');
    expect(tables).toContain('crm_connections');
  });

  it('ignora crm_options malformado e usa os defaults', async () => {
    const tables = installFake({ system_event: 'lead_won', crm_options: { provider: 'kommo', pipelineId: '' } });

    await pushConfirmedMeetingToCrm('org-1', 'lead-1');

    expect(tables).toContain('crm_connections');
  });
});
