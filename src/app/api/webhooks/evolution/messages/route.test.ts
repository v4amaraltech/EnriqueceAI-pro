import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.fn();

vi.mock('@/features/lead-messages/inbound', () => ({
  storeOrQuarantine: (...args: unknown[]) => store(...args),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: { id: 'inst-1', org_id: 'org-1', phone: '5511888887777' },
          }),
        }),
      }),
    }),
  }),
}));

import { POST } from './route';

const SECRET = 'segredo-de-teste';

function request(body: unknown, secret: string | null = SECRET) {
  return new Request('http://localhost/api/webhooks/evolution/messages', {
    method: 'POST',
    headers: secret ? { 'x-evolution-secret': secret, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const upsert = {
  event: 'messages.upsert',
  instance: 'ea_org_1',
  data: {
    key: { id: 'MSG-A', remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
    message: { conversation: 'oi' },
  },
};

beforeEach(() => {
  store.mockReset();
  process.env.EVOLUTION_MESSAGES_WEBHOOK_SECRET = SECRET;
});

describe('webhook de mensagens da Evolution', () => {
  it('recusa sem segredo e ignora grupo', async () => {
    delete process.env.EVOLUTION_MESSAGES_WEBHOOK_SECRET;
    expect((await POST(request(upsert))).status).toBe(503);
    process.env.EVOLUTION_MESSAGES_WEBHOOK_SECRET = SECRET;
    expect((await POST(request(upsert, 'errado'))).status).toBe(401);
    const group = await POST(request({
      ...upsert,
      data: { key: { id: 'G1', remoteJid: '123@g.us', fromMe: false }, message: { conversation: 'grupo' } },
    }));
    expect(group.status).toBe(200);
    expect(store).not.toHaveBeenCalled();
  });

  it('aceita o reenvio da mesma mensagem sem mudar o id gravado', async () => {
    const first = await POST(request(upsert));
    const second = await POST(request(upsert));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(store).toHaveBeenCalledTimes(2);
    expect(store.mock.calls[0]?.[0]).toMatchObject({
      orgId: 'org-1',
      provider: 'evolution',
      providerMessageId: 'MSG-A',
      direction: 'inbound',
      bodyText: 'oi',
    });
    expect(store.mock.calls[1]?.[0]).toMatchObject({ providerMessageId: 'MSG-A' });
  });
});
