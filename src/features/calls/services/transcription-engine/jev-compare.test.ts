import { describe, expect, it, vi } from 'vitest';

import {
  type CompareSample,
  loadCompareSamples,
  missingCompareEnv,
  parseCompareArgs,
  runJevCompare,
} from './jev-compare';

const SECRET_TEXT = 'Meu nome é Fulano e meu telefone é 11999999999';
const env = {
  JEV_API_KEY: 'sk-typesafe',
  OPENROUTER_API_KEY: 'sk-openrouter',
} as unknown as NodeJS.ProcessEnv;

const sample = (callId: string): CompareSample => ({
  callId,
  input: {
    transcript: SECRET_TEXT,
    utterances: [{ speaker: 'A', text: SECRET_TEXT, start: 0, end: 1 }],
    durationSeconds: 60,
    callType: 'outbound',
  },
});
const samples = [sample('aaaaaaaa-1111'), sample('bbbbbbbb-2222')];

const body = (model: string, outcome: string) => ({
  model,
  usage: { input_tokens: 100 },
  answers: {
    outcome: { type: 'choice', choice: outcome, confidence: 0.9 },
    interest: { type: 'score', score: 2, confidence: 0.9 },
    has_objections: { type: 'noul', noul: 0.05 },
    next_step_suggestion: { type: 'choice', choice: 'callback', confidence: 0.9 },
  },
});

async function run(argv: string[], fetchImpl: typeof fetch) {
  const lines: string[] = [];
  const res = await runJevCompare({
    args: parseCompareArgs(argv),
    env,
    samples,
    log: (l) => lines.push(l),
    fetchImpl,
    now: () => 0,
  });
  return { ...res, out: lines.join('\n') };
}

describe('argumentos e envs', () => {
  it('padrão é dry-run com 15; limite máximo 30', () => {
    expect(parseCompareArgs([])).toEqual({ send: false, limit: 15, envFile: '.env.local' });
    expect(parseCompareArgs(['--send', '--limit', '30'])).toMatchObject({ send: true, limit: 30 });
    expect(() => parseCompareArgs(['--limit', '31'])).toThrow('de 1 a 30');
    expect(() => parseCompareArgs(['--sned'])).toThrow('Argumento desconhecido');
  });

  it('diz só os nomes que faltam; chaves do JEV só com --send', () => {
    const none = {} as NodeJS.ProcessEnv;
    expect(missingCompareEnv(none, false)).toEqual([
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]);
    expect(missingCompareEnv(none, true)).toEqual(
      expect.arrayContaining(['JEV_API_KEY (ou TYPESAFE_API_KEY)', 'OPENROUTER_API_KEY']),
    );
  });
});

describe('runJevCompare', () => {
  it('dry-run lista ids curtos e não chama ninguém', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { out, exitCode } = await run([], fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out).toContain('aaaaaaaa bbbbbbbb');
    expect(exitCode).toBe(0);
  });

  it('--send compara as três respostas sem imprimir texto nem chaves', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(new URL(url).host);
      const or = url.includes('openrouter');
      return new Response(
        JSON.stringify(
          body(or ? 'typesafe/jev-1.14' : 'jev-1.14.0', or ? 'not_interested' : 'callback'),
        ),
      );
    }) as unknown as typeof fetch;
    const { out } = await run(['--send'], fetchImpl);
    expect(urls.slice(0, 3)).toEqual(['api.typesafe.ai', 'api.typesafe.ai', 'openrouter.ai']);
    expect(out).toMatch(/outcome\s+2\/2 \(100%\)\s+0\/2 \(0%\)/);
    expect(out).toContain('modelo: typesafe/jev-1.14 (2)');
    expect(out).toContain('total 200');
    expect(out).not.toContain('Fulano');
    expect(out).not.toContain('11999999999');
    expect(out).not.toContain('sk-');
  });

  it.each([
    [401, 'chave recusada'],
    [402, 'sem crédito'],
  ])('HTTP %i da OpenRouter para tudo e diz qual foi', async (status, why) => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('openrouter')
        ? new Response('{}', { status })
        : new Response(JSON.stringify(body('jev', 'callback'))),
    ) as unknown as typeof fetch;
    const { out, exitCode } = await run(['--send'], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(out).toContain(`Parado: OpenRouter devolveu HTTP ${status} (${why}).`);
    expect(exitCode).toBe(1);
  });

  it('outros erros são contados por provedor e a execução segue', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('openrouter')) return new Response(SECRET_TEXT); // JSON inválido
      return new Response('{}', { status: 500 });
    }) as unknown as typeof fetch;
    const { out } = await run(['--send'], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(out).toContain('erros: jev_http_500 (2)');
    expect(out).toContain('erros: SyntaxError (2)');
    expect(out).not.toContain('Fulano');
  });
});

describe('loadCompareSamples', () => {
  it('só faz select e monta a entrada igual à do motor', async () => {
    const used: string[] = [];
    const tables: Record<string, unknown[]> = {
      call_qualifications: [{ call_id: 'c1' }, { call_id: 'c2' }, { call_id: 'c3' }],
      call_transcripts_v2: [
        { call_id: 'c1', text: '  ', utterances: [], speakers_count: 1, error: null },
        { call_id: 'c2', text: 'oi', utterances: null, speakers_count: 2, error: null },
        { call_id: 'c3', text: 'olá', utterances: [], speakers_count: 2, error: null },
      ],
      calls: [
        { id: 'c1', duration_seconds: 40, type: 'outbound' },
        { id: 'c2', duration_seconds: 50, type: 'inbound' },
        { id: 'c3', duration_seconds: 60, type: 'outbound' },
      ],
    };
    const db = {
      from(table: string) {
        const target = {
          then: (res: (v: unknown) => unknown) =>
            Promise.resolve({ data: tables[table], error: null }).then(res),
        };
        const builder: unknown = new Proxy(target, {
          get(t, prop: string) {
            if (prop === 'then') return t.then;
            used.push(prop);
            return () => builder;
          },
        });
        return builder;
      },
    };
    const out = await loadCompareSamples(db as never, 'org', 1);
    expect(out).toEqual([
      {
        callId: 'c2',
        input: {
          transcript: 'oi',
          utterances: [],
          durationSeconds: 50,
          callType: 'inbound',
          durationWarning: false,
          speakersCount: 2,
        },
      },
    ]);
    expect([...new Set(used)].sort()).toEqual(['eq', 'in', 'limit', 'order', 'select']);
  });
});
