import { describe, expect, it } from 'vitest';

import {
  type Api4ComConnectionScopeRow,
  pickApi4ComConnectionForRamal,
  resolveApi4ComOrgScope,
} from './api4com-org-scope';

const AMARAL = 'org-amaral';
const JULIO = 'org-julio';

function conn(org_id: string, ramal: string, sip_domain: string | null = null): Api4ComConnectionScopeRow {
  return { org_id, user_id: `${org_id}-${ramal}`, ramal, sip_domain };
}

// Cenário real de 10/set/2026: Amaral mapeada (1 conexão com domínio), Julio sem
// domínio, e o ramal 1024 existindo nas duas contas.
const today = [
  conn(AMARAL, '1014', 'v4amaral.api4com.com'),
  conn(AMARAL, '1024'),
  conn(AMARAL, '1028'),
  conn(JULIO, '1023'),
  conn(JULIO, '1024'),
];

describe('resolveApi4ComOrgScope', () => {
  it('evento do domínio da Amaral → só Amaral (qualquer conexão da org com o domínio basta)', () => {
    expect(resolveApi4ComOrgScope(today, 'v4amaral.api4com.com')).toEqual([AMARAL]);
  });

  it('ignora caixa e espaços no domínio', () => {
    expect(resolveApi4ComOrgScope(today, '  V4Amaral.API4COM.com ')).toEqual([AMARAL]);
  });

  it('domínio desconhecido → só orgs ainda sem domínio (Julio), NUNCA a Amaral já mapeada', () => {
    expect(resolveApi4ComOrgScope(today, 'v4juliocesar.api4com.com')).toEqual([JULIO]);
  });

  it('payload sem domínio → mesmas regras do domínio desconhecido', () => {
    expect(resolveApi4ComOrgScope(today, undefined)).toEqual([JULIO]);
  });

  it('com as duas orgs mapeadas, cada domínio vai para a sua org e domínio alheio vai para ninguém', () => {
    const mapped = [...today, conn(JULIO, '1025', 'v4juliocesar.api4com.com')];
    expect(resolveApi4ComOrgScope(mapped, 'v4juliocesar.api4com.com')).toEqual([JULIO]);
    expect(resolveApi4ComOrgScope(mapped, 'v4amaral.api4com.com')).toEqual([AMARAL]);
    expect(resolveApi4ComOrgScope(mapped, 'outra.api4com.com')).toEqual([]);
  });

  it('nenhuma org mapeada → todas (comportamento antigo)', () => {
    const none = [conn(AMARAL, '1024'), conn(JULIO, '1024')];
    expect(resolveApi4ComOrgScope(none, 'qualquer.api4com.com').sort()).toEqual([AMARAL, JULIO]);
  });
});

describe('pickApi4ComConnectionForRamal', () => {
  it('ramal repetido entre contas: escolhe o da org do escopo', () => {
    expect(pickApi4ComConnectionForRamal(today, [JULIO], '1024')?.org_id).toBe(JULIO);
    expect(pickApi4ComConnectionForRamal(today, [AMARAL], '1024')?.org_id).toBe(AMARAL);
  });

  it('fora do escopo ou ambíguo → null (não chuta)', () => {
    expect(pickApi4ComConnectionForRamal(today, [JULIO], '1028')).toBeNull();
    expect(pickApi4ComConnectionForRamal(today, [], '1024')).toBeNull();
    expect(pickApi4ComConnectionForRamal(today, [AMARAL, JULIO], '1024')).toBeNull();
  });
});
