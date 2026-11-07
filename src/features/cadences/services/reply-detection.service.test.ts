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

  it('nosso próprio e-mail seguinte na mesma conversa não é resposta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        threadResponse([
          [{ name: 'From', value: 'Ana <analuiza@v4companyamaral.com>' }],
          [
            { name: 'From', value: 'analuiza@v4companyamaral.com' },
            { name: 'Subject', value: 'Re: canais da panco' },
          ],
        ]),
      ),
    );
    expect(await checkThreadForReplyOrBounce('t', 'tok')).toBe('none');
  });

  it('resposta do lead depois do nosso segundo e-mail conta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        threadResponse([
          [{ name: 'From', value: 'analuiza@v4companyamaral.com' }],
          [{ name: 'From', value: 'analuiza@v4companyamaral.com' }],
          [
            { name: 'From', value: 'Lead <cliente@empresa.com>' },
            { name: 'Subject', value: 'Re: canais da panco' },
          ],
        ]),
      ),
    );
    expect(await checkThreadForReplyOrBounce('t', 'tok')).toBe('reply');
  });

  it('resposta que chegou antes do nosso envio não é resposta a ele (despedida da Ana, 26/10)', async () => {
    // m0 = e-mail da cadência, m1 = "não temos interesse" do lead, m2 = nossa despedida
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        threadResponse([
          [{ name: 'From', value: 'Ana <analuiza@v4companyamaral.com>' }],
          [
            { name: 'From', value: 'Nivaldo <nivaldo@falcare.com.br>' },
            { name: 'Subject', value: 'Re: comercial da Falcare' },
          ],
          [{ name: 'From', value: 'Ana <analuiza@v4companyamaral.com>' }],
        ]),
      ),
    );
    expect(await checkThreadForReplyOrBounce('t', 'tok', 'm2')).toBe('none');
  });

  it('resposta depois do nosso envio conta, mesmo com outra resposta antes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        threadResponse([
          [{ name: 'From', value: 'analuiza@v4companyamaral.com' }],
          [{ name: 'From', value: 'cliente@empresa.com' }],
          [{ name: 'From', value: 'analuiza@v4companyamaral.com' }],
          [{ name: 'From', value: 'cliente@empresa.com' }],
        ]),
      ),
    );
    expect(await checkThreadForReplyOrBounce('t', 'tok', 'm2')).toBe('reply');
  });

  it('nosso envio de outra caixa no meio da conversa também é nosso', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        threadResponse([
          [{ name: 'From', value: 'sdr@v4.com' }],
          [{ name: 'From', value: 'Ana <analuiza@v4companyamaral.com>' }],
          [{ name: 'From', value: 'analuiza@v4companyamaral.com' }],
        ]),
      ),
    );
    expect(await checkThreadForReplyOrBounce('t', 'tok', 'm1')).toBe('none');
  });

  it('id do envio fora da conversa: confere tudo depois da 1ª mensagem (linhas antigas)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        threadResponse([[{ name: 'From', value: 'sdr@v4.com' }], [{ name: 'From', value: 'cliente@empresa.com' }]]),
      ),
    );
    expect(await checkThreadForReplyOrBounce('t', 'tok', 'msg-que-nao-esta')).toBe('reply');
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
