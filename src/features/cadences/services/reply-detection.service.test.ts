import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkThreadForReplyOrBounce, mailboxCandidates } from './reply-detection.service';

describe('mailboxCandidates', () => {
  it('usa só o remetente gravado pelo motor quando existe', () => {
    expect(
      mailboxCandidates({ metadata: { sender_user_id: 'sdr' }, performed_by: 'criador' }, 'dono'),
    ).toEqual(['sdr']);
  });

  it('linha antiga: tenta o dono do lead e depois o criador da cadência', () => {
    expect(mailboxCandidates({ metadata: { thread_id: 't' }, performed_by: 'criador' }, 'dono')).toEqual([
      'dono',
      'criador',
    ]);
  });

  it('não repete a caixa quando dono e criador são a mesma pessoa', () => {
    expect(mailboxCandidates({ metadata: null, performed_by: 'vini' }, 'vini')).toEqual(['vini']);
  });

  it('lead sem dono: só o criador', () => {
    expect(mailboxCandidates({ metadata: null, performed_by: 'criador' }, null)).toEqual(['criador']);
  });
});

function threadResponse(messages: Array<Array<{ name: string; value: string }>>) {
  return new Response(
    JSON.stringify({ messages: messages.map((headers, i) => ({ id: `m${i}`, payload: { headers } })) }),
    { status: 200 },
  );
}

describe('checkThreadForReplyOrBounce', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('404 = conversa não está nesta caixa', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    expect(await checkThreadForReplyOrBounce('t', 'tok')).toBe('not_found');
  });

  it('outros erros do Gmail são transitórios', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    expect(await checkThreadForReplyOrBounce('t', 'tok')).toBe('error');
  });

  it('só a mensagem enviada = sem resposta', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(threadResponse([[{ name: 'From', value: 'sdr@v4.com' }]])));
    expect(await checkThreadForReplyOrBounce('t', 'tok')).toBe('none');
  });

  it('resposta de pessoa = reply', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        threadResponse([
          [{ name: 'From', value: 'sdr@v4.com' }],
          [
            { name: 'From', value: 'cliente@empresa.com' },
            { name: 'Subject', value: 'Re: Proposta' },
          ],
        ]),
      ),
    );
    expect(await checkThreadForReplyOrBounce('t', 'tok')).toBe('reply');
  });

  it('resposta automática de férias não conta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        threadResponse([
          [{ name: 'From', value: 'sdr@v4.com' }],
          [
            { name: 'From', value: 'cliente@empresa.com' },
            { name: 'Subject', value: 'Resposta automática: Proposta' },
          ],
        ]),
      ),
    );
    expect(await checkThreadForReplyOrBounce('t', 'tok')).toBe('none');
  });

  it('mailer-daemon = bounce', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        threadResponse([[{ name: 'From', value: 'sdr@v4.com' }], [{ name: 'From', value: 'Mailer-Daemon <x@google.com>' }]]),
      ),
    );
    expect(await checkThreadForReplyOrBounce('t', 'tok')).toBe('bounce');
  });
});
