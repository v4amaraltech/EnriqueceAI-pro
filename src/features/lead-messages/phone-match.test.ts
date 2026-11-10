import { describe, expect, it } from 'vitest';

import { brPhoneVariants } from './phone-match';

describe('telefone BR para achar o contato', () => {
  it('aceita o número com e sem o 9, e com DDI', () => {
    expect(brPhoneVariants('+55 (11) 99999-8888').sort()).toEqual(
      ['1199998888', '11999998888', '551199998888', '5511999998888'].sort(),
    );
  });

  it('não inventa variante para número curto ou fixo', () => {
    expect(brPhoneVariants('99998888')).toEqual([]);
    expect(brPhoneVariants('551132582600')).toEqual(['1132582600', '551132582600']);
  });
});
