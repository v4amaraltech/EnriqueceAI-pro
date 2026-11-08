import { describe, expect, it } from 'vitest';

import { createSseFilterStream, filterSseBlock } from './sse-filter';

const mine = new Set(['sid-a']);
const ev = (o: unknown) => `data: ${JSON.stringify(o)}`;

describe('filterSseBlock', () => {
  it('descarta evento de sessão de outro usuário', () => {
    expect(filterSseBlock(ev({ sessionId: 'sid-b', qr: 'wa.me/x' }), mine)).toBeNull();
  });
  it('passa evento da própria sessão', () => {
    const b = ev({ sessionId: 'sid-a', paired: true });
    expect(filterSseBlock(b, mine)).toBe(b);
  });
  it('reduz snapshot de sessões às do usuário', () => {
    const out = filterSseBlock(ev({ sessions: [{ id: 'sid-a' }, { id: 'sid-b' }, { sid: 'sid-c' }] }), mine);
    expect(JSON.parse((out ?? '').slice(6))).toEqual({ sessions: [{ id: 'sid-a' }] });
  });
  it('descarta JSON inválido e passa keepalive', () => {
    expect(filterSseBlock('data: {nope', mine)).toBeNull();
    expect(filterSseBlock(': ping', mine)).toBe(': ping');
  });
});

describe('createSseFilterStream', () => {
  it('filtra o stream e recarrega o cache uma vez para sessão nova', async () => {
    let refreshes = 0;
    const stream = createSseFilterStream(async ({ refresh }) => {
      if (refresh) refreshes++;
      return refresh ? new Set(['sid-a', 'sid-new']) : mine;
    });
    const enc = new TextEncoder();
    const w = stream.writable.getWriter();
    const text = new Response(stream.readable).text();
    const all = `${ev({ sessionId: 'sid-b' })}\n\n${ev({ sessionId: 'sid-new' })}\n\n${ev({ sessionId: 'sid-a' })}\n\n`;
    const cut = all.length - 10; // corta no meio de um evento
    await w.write(enc.encode(all.slice(0, cut)));
    await w.write(enc.encode(all.slice(cut)));
    await w.close();
    const out = await text;
    expect(out).toContain('sid-new');
    expect(out).not.toContain('sid-b');
    expect(refreshes).toBeGreaterThanOrEqual(2);
  });
});
