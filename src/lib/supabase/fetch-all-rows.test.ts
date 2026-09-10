import { describe, expect, it } from 'vitest';

import { fetchAllRows, type RangeableQuery } from './fetch-all-rows';

/** Simula o PostgREST: devolve a fatia pedida, mas nunca mais que `serverCap`. */
function fakeTable(total: number, serverCap: number) {
  const data = Array.from({ length: total }, (_, i) => i);
  const calls: Array<[number, number]> = [];
  const build = (): RangeableQuery<number> => ({
    range(from, to) {
      calls.push([from, to]);
      const end = Math.min(to + 1, from + serverCap);
      return Promise.resolve({ data: data.slice(from, end), error: null });
    },
  });
  return { build, calls };
}

describe('fetchAllRows', () => {
  it('lê tudo mesmo acima de 10.000 (caso da V4 Amaral: 15.033 linhas)', async () => {
    const t = fakeTable(15_033, 10_000);
    const { rows, truncated } = await fetchAllRows(t.build, { pageSize: 10_000 });
    expect(rows).toHaveLength(15_033);
    expect(rows[15_032]).toBe(15_032);
    expect(truncated).toBe(false);
  });

  it('não pula linhas quando o teto do servidor é MENOR que a página pedida', async () => {
    const t = fakeTable(4_500, 1_000);
    const { rows } = await fetchAllRows(t.build, { pageSize: 5_000 });
    expect(rows).toEqual(Array.from({ length: 4_500 }, (_, i) => i));
    // avança pelo que chegou: 0, 1000, 2000, 3000, 4000, 4500(vazio)
    expect(t.calls.map(([f]) => f)).toEqual([0, 1000, 2000, 3000, 4000, 4500]);
  });

  it('tabela vazia → uma consulta, zero linhas', async () => {
    const t = fakeTable(0, 1_000);
    const { rows, truncated } = await fetchAllRows(t.build);
    expect(rows).toEqual([]);
    expect(truncated).toBe(false);
    expect(t.calls).toHaveLength(1);
  });

  it('para no teto de segurança e avisa que ficou linha de fora', async () => {
    const t = fakeTable(12, 100);
    const { rows, truncated } = await fetchAllRows(t.build, { pageSize: 5, maxRows: 10 });
    expect(rows).toHaveLength(10);
    expect(truncated).toBe(true);
  });

  it('exatamente no teto de segurança sem sobra → não marca truncado', async () => {
    const t = fakeTable(10, 100);
    const { rows, truncated } = await fetchAllRows(t.build, { pageSize: 5, maxRows: 10 });
    expect(rows).toHaveLength(10);
    expect(truncated).toBe(false);
  });

  it('erro do banco vira exceção (nunca número parcial em silêncio)', async () => {
    const build = (): RangeableQuery<number> => ({
      range: () => Promise.resolve({ data: null, error: { message: 'timeout' } }),
    });
    await expect(fetchAllRows(build)).rejects.toThrow('timeout');
  });
});
