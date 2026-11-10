import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  enabled: false,
  upserts: [] as Array<{ table: string; row: Record<string, unknown>; onConflict?: string }>,
}));

vi.mock('./flag', () => ({
  isLeadMessagesCaptureEnabled: () => Promise.resolve(state.enabled),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => ({ from: (table: string) => chain(table) }),
}));

function chain(table: string) {
  const c: Record<string, unknown> = {};
  const pass = () => c;
  for (const name of ['select', 'eq', 'limit', 'maybeSingle']) c[name] = pass;
  c.upsert = (row: Record<string, unknown>, options?: { onConflict?: string }) => {
    state.upserts.push({ table, row, onConflict: options?.onConflict });
    return c;
  };
  c.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
    data: table === 'lead_messages' && state.upserts.some((item) => item.table === 'lead_messages')
      ? { id: 'msg-1' }
      : null,
    error: null,
  }).then(resolve);
  return c;
}

import { mediaMetadata, recordLeadMessage } from './record';

beforeEach(() => {
  state.enabled = false;
  state.upserts = [];
});

describe('captura da conversa', () => {
  it('não grava quando a flag está desligada', async () => {
    await recordLeadMessage({
      orgId: 'org-1',
      leadId: 'lead-1',
      channel: 'whatsapp',
      direction: 'outbound',
      provider: 'evolution',
      providerMessageId: 'evo-1',
      bodyText: 'oi',
    });
    expect(state.upserts).toEqual([]);
  });

  it('grava o texto e o status sem arquivo de mídia, e ignora duplicata', async () => {
    state.enabled = true;
    await recordLeadMessage({
      orgId: 'org-1',
      leadId: 'lead-1',
      channel: 'whatsapp',
      direction: 'outbound',
      provider: 'meta',
      providerMessageId: 'wamid.1',
      bodyText: 'olá',
      status: 'sent',
      media: { type: 'image', provider_media_id: 'mid', mime: 'image/jpeg' },
    });
    expect(state.upserts[0]).toMatchObject({
      table: 'lead_messages',
      onConflict: 'org_id,provider,provider_message_id',
      row: {
        provider: 'meta',
        provider_message_id: 'wamid.1',
        body_text: 'olá',
        media: { type: 'image', provider_media_id: 'mid', mime: 'image/jpeg' },
      },
    });
    expect(state.upserts[1]).toMatchObject({
      table: 'lead_message_status_events',
      onConflict: 'message_id,status',
      row: { status: 'sent', message_id: 'msg-1' },
    });
  });

  it('não grava aviso interno de feedback no lead', async () => {
    state.enabled = true;
    await recordLeadMessage({
      orgId: 'org-1',
      leadId: 'lead-1',
      channel: 'whatsapp',
      direction: 'outbound',
      provider: 'evolution',
      providerMessageId: 'fb-1',
      leadAddress: '11945705316',
      bodyText: 'WhatsApp de solicitação de feedback enviado para Vinicius Mercante',
    });
    expect(state.upserts).toEqual([]);
  });

  it('o metadado de mídia não aceita url nem base64', () => {
    expect(mediaMetadata({ type: 'image', provider_media_id: 'a', mime: 'image/png' })).toEqual({
      type: 'image',
      provider_media_id: 'a',
      mime: 'image/png',
    });
    expect(mediaMetadata({ type: '  ' })).toBeNull();
  });
});
