import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import { upsertLeadContact } from './lead-contacts';

vi.mock('@/lib/auth/get-org-id', () => ({ getAuthOrgIdResult: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const insert = vi.fn();

/** Lead existente e SEM nenhum contato cadastrado (count 0). */
function client() {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) chain[m] = () => chain;
      chain.insert = (row: unknown) => {
        insert(row);
        return chain;
      };
      chain.maybeSingle = () => Promise.resolve({ data: { id: 'lead-1' } });
      chain.single = () => Promise.resolve({ data: { id: 'c-1' }, error: null });
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ count: table === 'lead_contacts' ? 0 : null }).then(resolve);
      return chain;
    },
  };
}

const input = { leadId: 'lead-1', first_name: 'José', last_name: null, job_title: null, emails: [], phones: [] };

describe('upsertLeadContact: neverPrimary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthOrgIdResult).mockResolvedValue({ success: true, data: { orgId: 'org-1', userId: 'u1', supabase: client() } } as never);
  });

  it('primeiro contato continua virando principal por padrão', async () => {
    await upsertLeadContact(input);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ is_primary: true }));
  });

  it('com neverPrimary nem o primeiro contato vira principal', async () => {
    await upsertLeadContact({ ...input, neverPrimary: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ is_primary: false }));
  });
});
