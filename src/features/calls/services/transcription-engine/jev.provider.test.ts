import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type JevResponse,
  createJevClient,
  mapJevResponse,
  resolveJevProvider,
  resolveJevProviderName,
  toJevInput,
} from './jev.client';
import { defaultEngineDeps } from './orchestrator';

const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/systemone';

const env = (over: Record<string, string>) => over as unknown as NodeJS.ProcessEnv;
const bothKeys = { JEV_API_KEY: 'sk-typesafe', OPENROUTER_API_KEY: 'sk-openrouter' };

const SECRET_TEXT = 'texto sigiloso da ligação';
const input = toJevInput(
  { duration_seconds: 60, type: 'outbound' },
  { text: SECRET_TEXT, utterances: [{ speaker: 'A', text: SECRET_TEXT, start: 0, end: 1 }] },
);

const answers = (over: Record<string, unknown> = {}) =>
  ({
    outcome: { type: 'choice', choice: 'callback', confidence: 0.9 },
    interest: { type: 'score', score: 2, confidence: 0.9 },
    has_objections: { type: 'noul', noul: 0.05 },
    next_step_suggestion: { type: 'choice', choice: 'callback', confidence: 0.9 },
    ...over,
  }) as unknown as JevResponse['answers'];

const reply = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('escolha do provedor', () => {
  it('padrão é typesafe, também com JEV_PROVIDER vazio', () => {
    expect(resolveJevProviderName(env({}))).toBe('typesafe');
    expect(resolveJevProviderName(env({ JEV_PROVIDER: '' }))).toBe('typesafe');
    expect(resolveJevProviderName(env({ JEV_PROVIDER: 'typesafe' }))).toBe('typesafe');
    expect(resolveJevProviderName(env({ JEV_PROVIDER: 'openrouter' }))).toBe('openrouter');
  });

  it('valor desconhecido cai em typesafe com aviso, sem imprimir o valor nem chaves', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = resolveJevProvider(env({ ...bothKeys, JEV_PROVIDER: 'sk-colada-no-lugar-errado' }));
    expect(cfg).toMatchObject({ name: 'typesafe', url: TYPESAFE_URL, apiKey: 'sk-typesafe' });
    expect(warn).toHaveBeenCalledTimes(1);
    const printed = warn.mock.calls.flat().join(' ');
    expect(printed).not.toContain('sk-');
    expect(printed).toContain('aceitos: "typesafe", "openrouter"');
  });

  it('URL, modelo e chave vêm juntos do mesmo provedor', () => {
    expect(resolveJevProvider(env(bothKeys))).toEqual({
      name: 'typesafe',
      url: TYPESAFE_URL,
      model: 'jev-latest',
      apiKey: 'sk-typesafe',
    });
    expect(resolveJevProvider(env({ ...bothKeys, JEV_PROVIDER: 'openrouter' }))).toEqual({
      name: 'openrouter',
      url: OPENROUTER_URL,
      model: 'jev-latest',
      apiKey: 'sk-openrouter',
    });
    expect(resolveJevProvider(env({ TYPESAFE_API_KEY: 'sk-apelido' }))?.apiKey).toBe('sk-apelido');
  });

  it('sem a chave do provedor escolhido não há fallback para o outro', () => {
    expect(
      resolveJevProvider(
        env({ JEV_PROVIDER: 'openrouter', JEV_API_KEY: 'a', TYPESAFE_API_KEY: 'b' }),
      ),
    ).toBeNull();
    expect(resolveJevProvider(env({ OPENROUTER_API_KEY: 'c' }))).toBeNull();
  });

  it('motor: openrouter sem OPENROUTER_API_KEY fica sem cliente (jev_not_configured)', () => {
    vi.stubEnv('JEV_PROVIDER', 'openrouter');
    vi.stubEnv('JEV_API_KEY', 'sk-typesafe');
    vi.stubEnv('OPENROUTER_API_KEY', '');
    expect(defaultEngineDeps({} as never).jev()).toBeNull();
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-openrouter');
    expect(defaultEngineDeps({} as never).jev()).not.toBeNull();
  });

  it.each([
    ['typesafe', TYPESAFE_URL, 'sk-typesafe', 'sk-openrouter'],
    ['openrouter', OPENROUTER_URL, 'sk-openrouter', 'sk-typesafe'],
  ] as const)('%s: chama só a própria URL com a própria chave', async (name, url, mine, other) => {
    const fetchImpl = reply({ answers: answers() });
    const provider = resolveJevProvider(env({ ...bothKeys, JEV_PROVIDER: name }))!;
    await createJevClient({ provider, fetchImpl }).qualify(input);
    const [calledUrl, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(calledUrl).toBe(url);
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${mine}` });
    expect(JSON.stringify(init)).not.toContain(other);
    expect(JSON.parse(init?.body as string)).toMatchObject({ model: 'jev-latest' });
  });

  it('erro HTTP traz só o status, sem chave nem texto da ligação', async () => {
    const provider = resolveJevProvider(env(bothKeys), 'openrouter')!;
    const fetchImpl = reply({ error: { message: `${SECRET_TEXT} sk-openrouter` } }, 402);
    await expect(createJevClient({ provider, fetchImpl }).qualify(input)).rejects.toThrow(
      /^jev_http_402$/,
    );
  });

  it('o nome de modelo devolvido pela OpenRouter é gravado como veio', () => {
    const q = mapJevResponse({ model: 'typesafe/jev-1.14-20260917', answers: answers() }, input);
    expect(q.model).toBe('typesafe/jev-1.14-20260917');
  });
});

describe('custo', () => {
  const byTokens = 0.000042; // 1000 tokens a US$ 0,042 por milhão
  const costFor = async (name: 'typesafe' | 'openrouter', usage: Record<string, unknown>) => {
    const provider = resolveJevProvider(env(bothKeys), name)!;
    const fetchImpl = reply({ answers: answers(), usage: { input_tokens: 1000, ...usage } });
    return (await createJevClient({ provider, fetchImpl }).qualify(input)).costUsd;
  };

  it.each([0.00003, 0])('openrouter grava o usage.cost cobrado (%d)', async (cost) => {
    expect(await costFor('openrouter', { cost })).toBe(cost);
  });

  it('openrouter sem cost usa a conta por tokens', async () => {
    expect(await costFor('openrouter', {})).toBeCloseTo(byTokens, 8);
  });

  it.each([-1, null, '0.5', {}])(
    'openrouter com cost inválido (%o) usa os tokens',
    async (cost) => {
      expect(await costFor('openrouter', { cost })).toBeCloseTo(byTokens, 8);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('cost não finito (%d) usa os tokens', (cost) => {
    const q = mapJevResponse(
      { answers: answers(), usage: { input_tokens: 1000, cost } },
      input,
      'openrouter',
    );
    expect(q.costUsd).toBeCloseTo(byTokens, 8);
  });

  it('typesafe ignora cost', async () => {
    expect(await costFor('typesafe', { cost: 0.5 })).toBeCloseTo(byTokens, 8);
  });
});

describe('recusa ou pergunta ausente', () => {
  const required = ['outcome', 'interest', 'has_objections', 'next_step_suggestion'];

  it.each(required)('recusa em %s não vira resultado', (key) => {
    expect(() =>
      mapJevResponse({ answers: answers({ [key]: { type: 'refusal' } }) }, input),
    ).toThrow('jev_incomplete_answers');
  });

  it.each(required)('%s ausente não vira resultado', (key) => {
    expect(() => mapJevResponse({ answers: answers({ [key]: undefined }) }, input)).toThrow(
      'jev_incomplete_answers',
    );
  });

  it('recusa em perguntas opcionais de ICP não entra no resumo', () => {
    const q = mapJevResponse({ answers: answers({ monthly_revenue: { type: 'refusal' } }) }, input);
    expect(q.summary).not.toContain('ICP');
  });
});
