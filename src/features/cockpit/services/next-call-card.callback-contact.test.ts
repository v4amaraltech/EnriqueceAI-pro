import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CallContext, CockpitViewer } from '../types';
import { fetchCallContext } from './call-context.service';
import { loadCallbackTarget } from './callback-contact.service';
import { buildNextCallCardForLead } from './next-call-card.service';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('./callback-contact.service', () => ({ loadCallbackTarget: vi.fn() }));
vi.mock('./call-context.service', () => ({
  fetchCallContext: vi.fn(),
  isCallCockpitEnabled: vi.fn(),
}));
vi.mock('../utils/call-approach', () => ({
  suggestApproach: vi.fn(() => ({})),
  suggestApproachV2: vi.fn(() => ({})),
}));

const viewer: CockpitViewer = {
  viewerId: 'u1',
  orgId: 'org-1',
  isManager: false,
  targetUserId: 'u1',
  targetName: 'U',
  sdrOptions: [],
};
const principal = {
  name: 'Ana',
  jobTitle: 'Diretora',
  email: 'ana@acme.com',
  phone: '11999990000',
  partners: [],
};
const context = { leadId: 'lead-1', decisionMaker: principal } as unknown as CallContext;
const build = async () => {
  const r = await buildNextCallCardForLead({
    viewer,
    leadId: 'lead-1',
    now: new Date('2026-11-13T15:00:00Z'),
  });
  if (r.status !== 'ok') throw new Error(r.status);
  return r.data;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchCallContext).mockResolvedValue({ status: 'ok', data: context });
});

describe('cartão de retorno com contato', () => {
  it('mostra nome e número do contato (o mesmo que o portão disca) e mantém o e-mail do lead', async () => {
    vi.mocked(loadCallbackTarget).mockResolvedValue({
      contactId: 'c-1',
      name: 'José Lima',
      jobTitle: 'Sócio',
      phone: '11988887777',
    });
    const card = await build();
    expect(card.context.decisionMaker).toMatchObject({
      name: 'José Lima',
      jobTitle: 'Sócio',
      phone: '11988887777',
      email: 'ana@acme.com',
    });
    expect(card.callbackContact).toEqual({ name: 'José Lima', contactId: 'c-1' });
    expect(loadCallbackTarget).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', leadId: 'lead-1' }),
    );
  });

  it('contato sem telefone: decisor principal intacto e aviso (contactId null)', async () => {
    vi.mocked(loadCallbackTarget).mockResolvedValue({
      contactId: 'c-1',
      name: 'José Lima',
      jobTitle: null,
      phone: null,
    });
    const card = await build();
    expect(card.context.decisionMaker).toEqual(principal);
    expect(card.callbackContact).toEqual({ name: 'José Lima', contactId: null });
  });

  it('número do indicado recusado: principal no cartão, com o motivo', async () => {
    vi.mocked(loadCallbackTarget).mockResolvedValue({
      contactId: 'c-1',
      name: 'José Lima',
      jobTitle: null,
      phone: '11988887777',
    });
    const r = await buildNextCallCardForLead({
      viewer,
      leadId: 'lead-1',
      now: new Date(),
      ignoreContact: true,
    });
    expect(r).toMatchObject({
      data: {
        context: { decisionMaker: principal },
        callbackContact: { name: 'José Lima', contactId: null, refused: true },
      },
    });
  });

  it('sem retorno com contato: cartão como antes', async () => {
    vi.mocked(loadCallbackTarget).mockResolvedValue(null);
    const card = await build();
    expect(card.context.decisionMaker).toEqual(principal);
    expect(card).not.toHaveProperty('callbackContact');
  });

  it('lead que o viewer não pode ver: nem procura o contato', async () => {
    vi.mocked(fetchCallContext).mockResolvedValue({ status: 'not_found' });
    expect(await buildNextCallCardForLead({ viewer, leadId: 'lead-1', now: new Date() })).toEqual({
      status: 'empty',
    });
    expect(loadCallbackTarget).not.toHaveBeenCalled();
  });
});
