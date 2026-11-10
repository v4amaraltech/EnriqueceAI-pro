import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  enabled: true,
  capture: false,
  rows: [] as unknown[],
  events: [] as unknown[],
  error: null as { message: string } | null,
  filters: [] as string[],
  reads: 0,
}));

function chain() {
  const c: Record<string, unknown> = {};
  const pass = (name: string) => (...args: unknown[]) => {
    state.filters.push(`${name}:${args.map(String).join(',')}`);
    return c;
  };
  for (const name of ['select', 'eq', 'order', 'limit', 'or', 'in']) c[name] = pass(name);
  c.then = (resolve: (value: unknown) => unknown) => {
    state.reads += 1;
    const data = state.reads === 1 ? state.rows : state.events;
    return Promise.resolve({ data, error: state.error }).then(resolve);
  };
  return c;
}

vi.mock('@/lib/auth/get-org-id', () => ({
  getAuthOrgIdResult: vi.fn(() => Promise.resolve({
    success: true,
    data: { orgId: 'org-1', userId: 'u-1', supabase: { from: () => chain() } },
  })),
}));
vi.mock('@/lib/supabase/from', () => ({
  from: (supabase: { from: () => unknown }) => supabase.from(),
}));
vi.mock('./flag', () => ({
  isLeadChannelChatEnabled: () => Promise.resolve(state.enabled),
}));
vi.mock('@/features/lead-messages/flag', () => ({
  isLeadMessagesCaptureEnabled: () => Promise.resolve(state.capture),
}));

import { CHANNEL_PAGE_SIZE } from './constants';
import { fetchLeadChannelPage } from './read';

const LEAD = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  state.enabled = true;
  state.capture = false;
  state.rows = [];
  state.events = [];
  state.error = null;
  state.filters = [];
  state.reads = 0;
});

describe('leitura da conversa', () => {
  it('não consulta o banco quando a flag está desligada', async () => {
    state.enabled = false;
    const result = await fetchLeadChannelPage({ leadId: LEAD, channel: 'whatsapp' });
    expect(result).toEqual({ success: true, data: { enabled: false } });
    expect(state.filters).toEqual([]);
  });

  it('pede só o canal, sem o teto de 50 da linha do tempo, e devolve o texto ausente', async () => {
    state.rows = [{
      id: '22222222-2222-4222-8222-222222222222',
      type: 'replied',
      channel: 'email',
      message_content: null,
      metadata: { thread_id: 'th-1' },
      ai_generated: false,
      created_at: '2026-11-10T15:00:00.000Z',
    }];
    const result = await fetchLeadChannelPage({ leadId: LEAD, channel: 'email' });
    expect(result.success).toBe(true);
    if (!result.success || !result.data.enabled) throw new Error('pagina');
    expect(result.data.messages[0]?.text).toBe('Resposta detectada, texto não gravado');
    expect(result.data.hasMore).toBe(false);
    expect(state.filters).toContain('eq:channel,email');
    expect(state.filters).toContain(`limit:${CHANNEL_PAGE_SIZE + 1}`);
    expect(state.filters.some((filter) => filter.startsWith('limit:50'))).toBe(false);
  });

  it('marca que há página anterior e usa a linha mais antiga como cursor', async () => {
    state.rows = Array.from({ length: CHANNEL_PAGE_SIZE + 1 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      type: 'sent',
      channel: 'whatsapp',
      message_content: `m${index}`,
      metadata: null,
      ai_generated: false,
      created_at: `2026-11-10T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
    }));
    const result = await fetchLeadChannelPage({ leadId: LEAD, channel: 'whatsapp' });
    if (!result.success || !result.data.enabled) throw new Error('pagina');
    expect(result.data.hasMore).toBe(true);
    expect(result.data.messages).toHaveLength(CHANNEL_PAGE_SIZE);
    expect(result.data.cursor?.id).toBe(state.rows[CHANNEL_PAGE_SIZE - 1] && (state.rows[CHANNEL_PAGE_SIZE - 1] as { id: string }).id);
  });

  it('pagina com o cursor entre aspas, sem injetar filtro extra', async () => {
    await fetchLeadChannelPage({
      leadId: LEAD,
      channel: 'whatsapp',
      before: {
        createdAt: '2026-11-10T15:00:00.000Z',
        id: '22222222-2222-4222-8222-222222222222',
      },
    });
    expect(state.filters).toContain(
      'or:created_at.lt."2026-11-10T15:00:00.000Z",and(created_at.eq."2026-11-10T15:00:00.000Z",id.lt."22222222-2222-4222-8222-222222222222")',
    );
  });

  it('com a captura ligada lê lead_messages e o tique do evento', async () => {
    state.capture = true;
    state.rows = [{
      id: '33333333-3333-4333-8333-333333333333',
      channel: 'whatsapp',
      direction: 'outbound',
      body_text: '',
      body_html: null,
      subject: null,
      media: { type: 'image' },
      thread_id: null,
      ai_generated: false,
      occurred_at: '2026-11-10T15:00:00.000Z',
    }];
    state.events = [{ message_id: '33333333-3333-4333-8333-333333333333', status: 'delivered', occurred_at: '2026-11-10T15:01:00.000Z' }];
    const result = await fetchLeadChannelPage({ leadId: LEAD, channel: 'whatsapp' });
    if (!result.success || !result.data.enabled) throw new Error('pagina');
    expect(result.data.messages[0]).toMatchObject({ text: 'Mídia: imagem', delivery: '✓✓ Entregue' });
    expect(state.filters).toContain('eq:channel,whatsapp');
    expect(state.filters.some((filter) => filter.startsWith('limit:50'))).toBe(false);
  });

  it('recusa lead inválido sem consultar', async () => {
    const result = await fetchLeadChannelPage({ leadId: 'nao-uuid', channel: 'whatsapp' });
    expect(result).toMatchObject({ success: false });
    expect(state.filters).toEqual([]);
  });
});
