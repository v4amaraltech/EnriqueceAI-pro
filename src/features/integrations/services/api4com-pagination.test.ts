import { describe, expect, it } from 'vitest';

import { api4comNextPage, api4comPagination } from './api4com-pagination';

describe('paginação do GET /calls', () => {
  it('lê de meta (formato atual da API4COM)', () => {
    expect(api4comNextPage({ data: [], meta: { nextPage: 3 } })).toBe(3);
    expect(api4comPagination({ meta: { totalPageCount: 7 } })?.totalPageCount).toBe(7);
  });

  it('meta prevalece sobre metadata', () => {
    expect(api4comNextPage({ meta: { nextPage: null }, metadata: { nextPage: 9 } })).toBeNull();
    expect(api4comNextPage({ meta: { nextPage: 2 }, metadata: { nextPage: 9 } })).toBe(2);
  });

  it('metadata só como fallback', () => {
    expect(api4comNextPage({ data: [], metadata: { nextPage: 4 } })).toBe(4);
  });

  it('sem paginação, fim ou valor inválido: null', () => {
    expect(api4comNextPage({ data: [] })).toBeNull();
    expect(api4comNextPage({ meta: { nextPage: null } })).toBeNull();
    expect(api4comNextPage({ meta: { nextPage: '2' } })).toBeNull();
    expect(api4comNextPage([])).toBeNull();
    expect(api4comNextPage(null)).toBeNull();
  });
});
