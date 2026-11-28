import { describe, expect, it } from 'vitest';

import { alreadyStoredIds, mergeStreams, type RawEntry, type StoredRef, type TimelineRow } from './merge';
import type { ChatMessage } from './model';

function row(id: string, type: string, at: string, externalId: string | null = null): TimelineRow {
  return {
    id,
    type,
    channel: 'email',
    message_content: 'x',
    metadata: null,
    ai_generated: false,
    created_at: at,
    external_id: externalId,
  };
}

function ref(id: string, at: string, providerId: string | null = null, direction: StoredRef['direction'] = 'outbound'): StoredRef {
  return { id, provider_message_id: providerId, direction, occurred_at: at };
}

function entry(id: string, at: string, visible = true): RawEntry {
  const message = visible ? ({ id, createdAt: at } as ChatMessage) : null;
  return { id, at, message };
}

describe('casamento linha do tempo × conversa gravada', () => {
  it('casa pelo id do provedor mesmo longe no tempo', () => {
    const covered = alreadyStoredIds(
      [row('i1', 'sent', '2026-11-20T10:00:00Z', 'msg-1')],
      [ref('m1', '2026-11-20T10:10:00Z', 'msg-1')],
    );
    expect([...covered]).toEqual(['i1']);
  });

  it('casa pelo horário (até 2 min) e cada gravada casa uma vez só', () => {
    const covered = alreadyStoredIds(
      [row('i1', 'sent', '2026-11-20T10:00:00Z'), row('i2', 'sent', '2026-11-20T10:00:30Z')],
      [ref('m1', '2026-11-20T10:00:20Z')],
    );
    expect(covered.size).toBe(1);
    expect(covered.has('i2')).toBe(true);
  });

  it('não casa envio com resposta, nem falha, nem fora da janela', () => {
    const covered = alreadyStoredIds(
      [
        row('i1', 'replied', '2026-11-20T10:00:00Z'),
        row('i2', 'failed', '2026-11-20T10:00:00Z'),
        row('i3', 'sent', '2026-11-20T10:05:00Z'),
      ],
      [ref('m1', '2026-11-20T10:00:00Z'), ref('m2', '2026-11-20T10:00:00Z')],
    );
    expect(covered.size).toBe(0);
  });
});

describe('página com duas fontes', () => {
  it('intercala da mais nova para a mais antiga e respeita o tamanho', () => {
    const page = mergeStreams(
      [
        { hasMore: false, entries: [entry('a', '2026-11-20T12:00:00Z'), entry('c', '2026-11-20T10:00:00Z')] },
        { hasMore: false, entries: [entry('b', '2026-11-20T11:00:00Z'), entry('d', '2026-11-20T09:00:00Z')] },
      ],
      3,
    );
    expect(page.messages.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(page.hasMore).toBe(true);
    expect(page.cursor).toEqual({ createdAt: '2026-11-20T10:00:00Z', id: 'c' });
  });

  it('para onde uma fonte ainda tem linhas não lidas, para não pular mensagem', () => {
    const page = mergeStreams(
      [
        { hasMore: true, entries: [entry('a', '2026-11-20T12:00:00Z'), entry('b', '2026-11-20T11:00:00Z')] },
        { hasMore: false, entries: [entry('old', '2026-11-01T09:00:00Z')] },
      ],
      40,
    );
    expect(page.messages.map((m) => m.id)).toEqual(['a', 'b']);
    expect(page.cursor?.id).toBe('b');
    expect(page.hasMore).toBe(true);
  });

  it('linha escondida avança o cursor mas não vira balão', () => {
    const page = mergeStreams(
      [{ hasMore: false, entries: [entry('a', '2026-11-20T12:00:00Z', false), entry('b', '2026-11-20T11:00:00Z')] }],
      40,
    );
    expect(page.messages.map((m) => m.id)).toEqual(['b']);
    expect(page.hasMore).toBe(false);
    expect(page.cursor?.id).toBe('b');
  });
});
