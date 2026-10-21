import { describe, expect, it } from 'vitest';

import {
  normalizeRamal,
  normalizeSyncEmail,
  pickAccountDomain,
  planExtensionSync,
  type Api4ComExtension,
} from './api4com-extension-sync';

const ext = (ramal: string, email: string | null, extra: Partial<Api4ComExtension> = {}): Api4ComExtension => ({
  id: Number(ramal),
  domain: 'v4amaral.api4com.com',
  ramal,
  senha: 'segredo',
  email_address: email,
  ...extra,
});

describe('normalizeSyncEmail', () => {
  it('põe em minúsculas e tira o sufixo +alias', () => {
    expect(normalizeSyncEmail('Vinicius.Mercante+1@V4company.com')).toBe('vinicius.mercante@v4company.com');
  });

  it('devolve null para vazio ou sem @', () => {
    expect(normalizeSyncEmail('')).toBeNull();
    expect(normalizeSyncEmail(null)).toBeNull();
    expect(normalizeSyncEmail('sem-arroba')).toBeNull();
  });
});

describe('normalizeRamal', () => {
  it('mantém só dígitos', () => {
    expect(normalizeRamal(' 1014 ')).toBe('1014');
    expect(normalizeRamal(1024)).toBe('1024');
    expect(normalizeRamal(null)).toBe('');
  });
});

describe('planExtensionSync', () => {
  const u = {
    vini: 'u-vini',
    ismael: 'u-ismael',
    ana: 'u-ana',
    novo: 'u-novo',
    semEmail: 'u-sem-email',
  };

  const extensions = [
    ext('1014', 'vinicius.mercante+1@v4company.com'),
    ext('1054', 'vinicius.mercante@v4company.com'),
    ext('1024', 'ismael.dobelin@v4company.com'),
    ext('1049', 'ismael.dobelin@v4company.com'),
    ext('1046', 'novo@v4company.com'),
  ];

  it('quem já tem linha casa pelo ramal, mesmo com o e-mail em alias ou duplicado', () => {
    const plan = planExtensionSync(
      extensions,
      [
        { userId: u.vini, email: 'vinicius.mercante@v4company.com' },
        { userId: u.ismael, email: 'ismael.dobelin@v4company.com' },
      ],
      [
        { userId: u.vini, ramal: '1014' },
        { userId: u.ismael, ramal: '1024' },
      ],
    );

    expect(plan.keep.map((k) => [k.userId, k.ramal])).toEqual([
      [u.vini, '1014'],
      [u.ismael, '1024'],
    ]);
    expect(plan.create).toEqual([]);
    expect(plan.ambiguous).toEqual([]);
    expect(plan.unmatched).toEqual([]);
  });

  it('linha cujo ramal sumiu da conta vira missing (não troca de ramal sozinho)', () => {
    const plan = planExtensionSync(
      extensions,
      [{ userId: u.ismael, email: 'ismael.dobelin@v4company.com' }],
      [{ userId: u.ismael, ramal: '1099' }],
    );
    expect(plan.missing).toEqual([{ userId: u.ismael, ramal: '1099' }]);
    expect(plan.keep).toEqual([]);
    expect(plan.create).toEqual([]);
  });

  it('usuário sem linha com um ramal só para o e-mail vira create', () => {
    const plan = planExtensionSync(extensions, [{ userId: u.novo, email: 'Novo@v4company.com' }], []);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]).toMatchObject({ userId: u.novo, email: 'novo@v4company.com' });
    expect(plan.create[0]!.extension.ramal).toBe('1046');
  });

  it('usuário sem linha com dois ramais para o e-mail vira ambiguous', () => {
    const plan = planExtensionSync(
      extensions,
      [{ userId: u.ismael, email: 'ismael.dobelin@v4company.com' }],
      [],
    );
    expect(plan.ambiguous).toEqual([
      { userId: u.ismael, email: 'ismael.dobelin@v4company.com', ramais: ['1024', '1049'] },
    ]);
  });

  it('o alias +1 do ramal conta como o mesmo e-mail', () => {
    const plan = planExtensionSync(
      extensions,
      [{ userId: u.vini, email: 'vinicius.mercante@v4company.com' }],
      [],
    );
    // 1014 (+1) e 1054 (exato) são o mesmo e-mail → ambíguo, nunca escolhe sozinho.
    expect(plan.ambiguous).toEqual([
      { userId: u.vini, email: 'vinicius.mercante@v4company.com', ramais: ['1014', '1054'] },
    ]);
  });

  it('usuário sem ramal na conta ou sem e-mail vira unmatched', () => {
    const plan = planExtensionSync(
      extensions,
      [
        { userId: u.ana, email: 'analuiza@v4companyamaral.com' },
        { userId: u.semEmail, email: null },
      ],
      [],
    );
    expect(plan.unmatched).toEqual([
      { userId: u.ana, email: 'analuiza@v4companyamaral.com' },
      { userId: u.semEmail, email: null },
    ]);
  });

  it('ignora ramais repetidos na lista (primeiro vence) e ramais sem número', () => {
    const plan = planExtensionSync(
      [ext('1014', 'a@x.com', { senha: 'primeira' }), ext('1014', 'a@x.com', { senha: 'segunda' }), ext('', 'b@x.com')],
      [{ userId: 'u-a', email: 'a@x.com' }],
      [{ userId: 'u-a', ramal: '1014' }],
    );
    expect(plan.keep[0]!.extension.senha).toBe('primeira');
  });
});

describe('pickAccountDomain', () => {
  it('escolhe o domínio mais frequente, em minúsculas', () => {
    expect(
      pickAccountDomain([
        ext('1', null, { domain: 'V4amaral.api4com.com' }),
        ext('2', null, { domain: 'v4amaral.api4com.com' }),
        ext('3', null, { domain: 'outro.api4com.com' }),
      ]),
    ).toBe('v4amaral.api4com.com');
  });

  it('devolve null sem ramais', () => {
    expect(pickAccountDomain([])).toBeNull();
  });
});
