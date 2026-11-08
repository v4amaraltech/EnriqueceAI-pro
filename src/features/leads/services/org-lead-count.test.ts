import { describe, expect, it, vi } from 'vitest';

const eq = vi.fn();
const isFn = vi.fn();
const select = vi.fn();
const fromMock = vi.fn();
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({ marker: 'service' }) }));
vi.mock('@/lib/supabase/from', () => ({ from: (...a: unknown[]) => fromMock(...a) }));

import { countOrgLeads } from './org-lead-count';

describe('countOrgLeads (pista 28)', () => {
  it('conta com o cliente service-role filtrando por org e deleted_at', async () => {
    isFn.mockResolvedValue({ count: 7 });
    eq.mockReturnValue({ is: isFn });
    select.mockReturnValue({ eq });
    fromMock.mockReturnValue({ select });

    expect(await countOrgLeads('org-1')).toBe(7);
    expect(fromMock).toHaveBeenCalledWith({ marker: 'service' }, 'leads');
    expect(eq).toHaveBeenCalledWith('org_id', 'org-1');
    expect(isFn).toHaveBeenCalledWith('deleted_at', null);
  });

  it('devolve 0 quando count vem nulo', async () => {
    isFn.mockResolvedValue({ count: null });
    expect(await countOrgLeads('org-1')).toBe(0);
  });
});
