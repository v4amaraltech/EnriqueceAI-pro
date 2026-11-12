import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => service);
vi.mock('@/lib/security/encryption', () => ({
  decrypt: (v: string) => v.replace(/^enc:/, ''),
  encrypt: (v: string) => `enc:${v}`,
}));

import {
  ORIGINATE_TIMEOUT_MS,
  describeOriginateError,
  getOrgApiCredentials,
  getUserCredentials,
  isRamalLegFailure,
  originateCall,
  toApi4ComCalled,
  waitMsFromErrorMessage,
} from './api4com.service';

type Row = Record<string, unknown> | null;

/** Cliente fake: devolve uma linha por tabela, ignorando os filtros. */
function makeClient(rows: Record<string, Row>) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'not', 'limit']) {
        chain[m] = () => chain;
      }
      chain.maybeSingle = () => Promise.resolve({ data: rows[table] ?? null, error: null });
      return chain;
    },
  };
}

describe('toApi4ComCalled', () => {
  it('mantém DDI 55 e põe o +', () => {
    expect(toApi4ComCalled('+55 (48) 98866-9122')).toBe('+5548988669122');
    expect(toApi4ComCalled('554833328530')).toBe('+554833328530');
  });

  it('acrescenta +55 em número nacional com 10 ou 11 dígitos', () => {
    expect(toApi4ComCalled('(48) 98866-9122')).toBe('+5548988669122');
    expect(toApi4ComCalled('48 3332-8530')).toBe('+554833328530');
  });

  it('rejeita número curto', () => {
    expect(() => toApi4ComCalled('123')).toThrow('Telefone inválido');
  });
});

describe('credenciais', () => {
  it('getUserCredentials usa o token da org quando existe', async () => {
    service.createServiceRoleClient.mockReturnValue(
      makeClient({
        api4com_connections: { org_id: 'org', api_key_encrypted: 'enc:user-token', base_url: 'https://api.api4com.com/api/v1/', ramal: '1014' },
        api4com_org_settings: { api_key_encrypted: 'enc:org-token', base_url: 'https://api.api4com.com/api/v1/' },
      }),
    );
    await expect(getUserCredentials('u1')).resolves.toEqual({
      apiKey: 'org-token',
      baseUrl: 'https://api.api4com.com/api/v1',
      ramal: '1014',
    });
  });

  it('getUserCredentials cai no token da própria linha sem token da org', async () => {
    service.createServiceRoleClient.mockReturnValue(
      makeClient({
        api4com_connections: { org_id: 'org', api_key_encrypted: 'enc:user-token', base_url: null, ramal: '1024' },
        api4com_org_settings: null,
      }),
    );
    await expect(getUserCredentials('u1')).resolves.toEqual({
      apiKey: 'user-token',
      baseUrl: 'https://api.api4com.com/api/v1',
      ramal: '1024',
    });
  });

  it('getUserCredentials devolve null com ramal sem token nenhum', async () => {
    service.createServiceRoleClient.mockReturnValue(
      makeClient({
        api4com_connections: { org_id: 'org', api_key_encrypted: null, base_url: null, ramal: '1024' },
        api4com_org_settings: null,
      }),
    );
    await expect(getUserCredentials('u1')).resolves.toBeNull();
  });

  it('getOrgApiCredentials prefere a org e cai no primeiro token de usuário', async () => {
    const withOrg = makeClient({ api4com_org_settings: { api_key_encrypted: 'enc:org-token', base_url: 'https://eu.api4com.com/api/v1/' } });
    await expect(getOrgApiCredentials('org', withOrg as never)).resolves.toEqual({ apiKey: 'org-token', baseUrl: 'https://eu.api4com.com/api/v1' });

    const legacy = makeClient({
      api4com_org_settings: null,
      api4com_connections: { api_key_encrypted: 'enc:user-token', base_url: null },
    });
    await expect(getOrgApiCredentials('org', legacy as never)).resolves.toEqual({
      apiKey: 'user-token',
      baseUrl: 'https://api.api4com.com/api/v1',
    });
  });
});

describe('originateCall', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    service.createServiceRoleClient.mockReturnValue(
      makeClient({
        api4com_connections: { org_id: 'org', api_key_encrypted: null, base_url: null, ramal: '1014' },
        api4com_org_settings: { api_key_encrypted: 'enc:org-token', base_url: 'https://api.api4com.com/api/v1/' },
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('chama POST /calls com extension, caller, called em E.164 e metadata', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: '200', id: 'call-123', message: 'successful request' }),
    });

    const result = await originateCall('u1', '(48) 98866-9122', { gateway: 'flux-org' });

    expect(result).toEqual({ data: { status: '200', id: 'call-123', message: 'successful request' }, ramal: '1014' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.api4com.com/api/v1/calls');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('org-token');
    expect(JSON.parse(String(init.body))).toEqual({
      extension: '1014',
      caller: '1014',
      called: '+5548988669122',
      metadata: { gateway: 'flux-org' },
    });
  });

  it('não repete a chamada quando a rede falha (evita discar duas vezes)', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));
    await expect(originateCall('u1', '48988669122')).rejects.toThrow('Não foi possível conectar à API4COM');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falha quando a API4COM não devolve id', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: 'ok' }) });
    await expect(originateCall('u1', '48988669122')).rejects.toThrow('não devolveu o id');
  });
});

describe('originateCall — perna do ramal falhou (424 "has been failed")', () => {
  const fetchMock = vi.fn();
  const RAMAL_FAIL = {
    ok: false,
    status: 424,
    text: async () => '{"error":{"statusCode":424,"name":"Error","message":"call from 1014 to +5516982501819 has been failed"}}',
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    service.createServiceRoleClient.mockReturnValue(
      makeClient({
        api4com_connections: { org_id: 'org', api_key_encrypted: null, base_url: null, ramal: '1014' },
        api4com_org_settings: { api_key_encrypted: 'enc:org-token', base_url: 'https://api.api4com.com/api/v1/' },
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('repete UMA vez e devolve a chamada da segunda tentativa', async () => {
    fetchMock.mockResolvedValueOnce(RAMAL_FAIL).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: '200', id: 'call-2', message: 'successful request' }),
    });

    const result = await originateCall('u1', '(16) 98250-1819', {}, { ramalRetryDelayMs: 0 });

    expect(result.data.id).toBe('call-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falhou de novo → propaga o erro cru (sem terceira tentativa)', async () => {
    fetchMock.mockResolvedValue(RAMAL_FAIL);
    await expect(originateCall('u1', '(16) 98250-1819', {}, { ramalRetryDelayMs: 0 })).rejects.toThrow('has been failed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('outro erro 4xx (ex.: ramal não registrado) NÃO repete', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 424, text: async () => '{"error":{"message":"user not registered"}}' });
    await expect(originateCall('u1', '(16) 98250-1819', {}, { ramalRetryDelayMs: 0 })).rejects.toThrow('not registered');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('describeOriginateError', () => {
  it('reconhece só o 424 de perna do ramal', () => {
    expect(isRamalLegFailure('API4COM POST /calls failed (424): {"error":{"message":"call from 1014 to +55 has been failed"}}')).toBe(true);
    expect(isRamalLegFailure('API4COM POST /calls failed (424): {"error":{"message":"user not registered"}}')).toBe(false);
    expect(isRamalLegFailure('API4COM POST /calls failed (500): has been failed')).toBe(false);
  });

  it('traduz os dois 424 conhecidos e deixa o resto como está', () => {
    expect(describeOriginateError('API4COM POST /calls failed (424): {"error":{"message":"call from 1014 to +55 has been failed"}}')).toMatch(/não conseguiu chamar o seu ramal/);
    expect(describeOriginateError('API4COM POST /calls failed (424): {"error":{"message":"user not registered"}}')).toMatch(/não está registrado/);
    expect(describeOriginateError('Telefone inválido')).toBe('Telefone inválido');
  });
});

describe('ORIGINATE_TIMEOUT_MS', () => {
  it('é 90 s, como pede o guia do POST /calls da API4COM', () => {
    expect(ORIGINATE_TIMEOUT_MS).toBe(90_000);
  });
});

describe('describeOriginateError: erros HTTP do POST /calls', () => {
  const NOW = Date.parse('2026-11-12T12:00:00Z');

  it('401: token inválido ou expirado, pede um novo token', () => {
    const msg = describeOriginateError('API4COM POST /calls failed (401): {"error":{"message":"Unauthorized"}}');
    expect(msg).toMatch(/token da API4COM é inválido ou expirou/);
    expect(msg).toMatch(/novo token/);
  });

  it('429 com RateLimit-Reset em segundos: mostra a espera', () => {
    const msg = describeOriginateError(
      'API4COM POST /calls failed (429): Too Many Requests [ratelimit-reset: 12]',
      NOW,
    );
    expect(msg).toMatch(/Muitas tentativas/);
    expect(msg).toContain('Tente de novo em 12 segundos.');
  });

  it('429 com RateLimit-Reset em epoch e com Retry-After', () => {
    const epoch = String(Math.floor(NOW / 1000) + 25);
    expect(
      describeOriginateError(`API4COM POST /calls failed (429): x [ratelimit-reset: ${epoch}]`, NOW),
    ).toContain('Tente de novo em 25 segundos.');
    expect(
      describeOriginateError('API4COM POST /calls failed (429): x [retry-after: 1]', NOW),
    ).toContain('Tente de novo em 1 segundo.');
  });

  it('429 sem cabeçalho: pede para aguardar um minuto', () => {
    const msg = describeOriginateError('API4COM POST /calls failed (429): Too Many Requests', NOW);
    expect(msg).toMatch(/Aguarde um minuto/);
  });

  it('404: ramal não encontrado, orienta sincronizar', () => {
    const msg = describeOriginateError('API4COM POST /calls failed (404): {"error":{"code":"EXTENSION_NOT_FOUND"}}');
    expect(msg).toMatch(/ramal não foi encontrado/);
    expect(msg).toMatch(/Sincronizar ramais/);
  });

  it('503: API indisponível, tentar em alguns segundos', () => {
    expect(describeOriginateError('API4COM POST /calls failed (503): Service Unavailable')).toMatch(
      /temporariamente indisponível/,
    );
  });

  it('os dois 424 continuam com as mesmas mensagens', () => {
    expect(describeOriginateError('API4COM POST /calls failed (424): {"error":{"message":"call from 1014 to +55 has been failed"}}')).toBe(
      'A API4COM não conseguiu chamar o seu ramal. Se você acabou de desligar, aguarde alguns segundos e tente de novo; se persistir, confira se o webphone está verde.',
    );
    expect(describeOriginateError('API4COM POST /calls failed (424): {"error":{"message":"user not registered"}}')).toBe(
      'Seu ramal não está registrado na API4COM. Aguarde o webphone ficar verde (ou abra a extensão) e tente de novo.',
    );
  });

  it('outros erros seguem crus', () => {
    const raw = 'API4COM POST /calls failed (500): boom';
    expect(describeOriginateError(raw)).toBe(raw);
    expect(describeOriginateError('Não foi possível conectar à API4COM. Tente novamente em instantes.')).toBe(
      'Não foi possível conectar à API4COM. Tente novamente em instantes.',
    );
  });

  it('nenhuma mensagem usa travessão', () => {
    for (const status of [401, 404, 429, 503]) {
      expect(describeOriginateError(`API4COM POST /calls failed (${status}): x`)).not.toContain('\u2014');
    }
  });
});

describe('originateCall: 429 leva os cabeçalhos de espera no erro e não repete', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    service.createServiceRoleClient.mockReturnValue(
      makeClient({
        api4com_connections: { org_id: 'org', api_key_encrypted: null, base_url: null, ramal: '1014' },
        api4com_org_settings: { api_key_encrypted: 'enc:org-token', base_url: 'https://api.api4com.com/api/v1/' },
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('anexa RateLimit-Reset e Retry-After ao erro, sem segunda tentativa', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'RateLimit-Reset': '12', 'Retry-After': '12' }),
      text: async () => 'Too Many Requests',
    });

    const err = await originateCall('u1', '48988669122', {}, { ramalRetryDelayMs: 0 }).catch((e: Error) => e);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain('(429)');
    expect(message).toContain('[ratelimit-reset: 12]');
    expect(message).toContain('[retry-after: 12]');
    expect(waitMsFromErrorMessage(message)).toBe(12_000);
    expect(describeOriginateError(message)).toContain('Tente de novo em 12 segundos.');
  });

  it('usa o timeout de 90 s no POST /calls', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'c1', message: 'ok' }) });
    await originateCall('u1', '48988669122');
    expect(timeoutSpy).toHaveBeenCalledWith(90_000);
    timeoutSpy.mockRestore();
  });
});
