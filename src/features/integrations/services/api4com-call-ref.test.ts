import { describe, expect, it, vi } from 'vitest';

import {
  buildOriginateMetadata,
  callRefWhere,
  findCallByCallRef,
  isUsableCallRef,
  linkProviderIdToMetadata,
  readCallRef,
  sanitizeExtraMetadata,
} from './api4com-call-ref';

const REF = '6f1c2a3e-1234-4abc-8def-0123456789ab';

describe('isUsableCallRef', () => {
  it('aceita UUID e recusa lixo', () => {
    expect(isUsableCallRef(REF)).toBe(true);
    expect(isUsableCallRef(REF.toUpperCase())).toBe(true);
    expect(isUsableCallRef('')).toBe(false);
    expect(isUsableCallRef('abc')).toBe(false);
    expect(isUsableCallRef('5511999999999')).toBe(false);
    expect(isUsableCallRef(null)).toBe(false);
    expect(isUsableCallRef(123)).toBe(false);
  });
});

describe('buildOriginateMetadata', () => {
  it('sempre envia gateway e callRef em texto', () => {
    expect(buildOriginateMetadata({ gateway: 'flux-org', callRef: REF })).toEqual({
      gateway: 'flux-org',
      callRef: REF,
    });
  });

  it('extra não sobrescreve callRef nem gateway', () => {
    const meta = buildOriginateMetadata({
      gateway: 'flux-org',
      callRef: REF,
      extra: { callRef: 'outro', CALLREF: 'x', gateway: 'hack', campaign: 'c1' },
    });
    expect(meta).toEqual({ gateway: 'flux-org', callRef: REF, campaign: 'c1' });
  });

  it('descarta dado pessoal óbvio do extra', () => {
    const meta = buildOriginateMetadata({
      gateway: 'flux-org',
      callRef: REF,
      extra: {
        phone: '5511999999999',
        leadName: 'Fulano',
        email: 'a@b.com',
        note: 'ligar depois',
        source: 'contato@empresa.com',
        ref: '11999998888',
        texto: 'frase com espaço',
        dialer: 'power',
      },
    });
    expect(meta).toEqual({ gateway: 'flux-org', callRef: REF, dialer: 'power' });
  });

  it('recusa callRef inválido', () => {
    expect(() => buildOriginateMetadata({ gateway: 'g', callRef: 'nope' })).toThrow('callRef inválido');
  });
});

describe('sanitizeExtraMetadata', () => {
  it('aceita só strings simples', () => {
    expect(sanitizeExtraMetadata({ a: 1 as unknown as string, b: 'ok', leadId: REF })).toEqual({ b: 'ok', leadId: REF });
    expect(sanitizeExtraMetadata(undefined)).toEqual({});
  });
});

describe('readCallRef', () => {
  it('lê callRef válido de qualquer metadata', () => {
    expect(readCallRef({ callRef: REF, gateway: 'g' })).toBe(REF);
    expect(readCallRef({ callRef: ` ${REF} ` })).toBe(REF);
  });

  it('recusa ausente ou inválido', () => {
    expect(readCallRef({ callRef: 'abc' })).toBeNull();
    expect(readCallRef({ callRef: '' })).toBeNull();
    expect(readCallRef({})).toBeNull();
    expect(readCallRef(null)).toBeNull();
    expect(readCallRef('x')).toBeNull();
  });
});

describe('callRefWhere', () => {
  it('monta a cláusula LoopBack', () => {
    expect(callRefWhere(REF)).toEqual({ 'metadata.callRef': REF });
  });
});

describe('linkProviderIdToMetadata', () => {
  it('sem primário grava api4com_call_id e preserva o resto', () => {
    const { metadata, changed } = linkProviderIdToMetadata({ callRef: REF, gateway: 'g' }, 'p1');
    expect(changed).toBe(true);
    expect(metadata).toEqual({ callRef: REF, gateway: 'g', api4com_call_id: 'p1' });
  });

  it('mesmo primário não muda nada', () => {
    const { changed } = linkProviderIdToMetadata({ api4com_call_id: 'p1', webhook_linked: true }, 'p1', {
      webhookLinked: true,
    });
    expect(changed).toBe(false);
  });

  it('primário diferente vai para alt_api4com_ids', () => {
    const { metadata } = linkProviderIdToMetadata(
      { api4com_call_id: 'p1', alt_api4com_ids: ['p0'], callRef: REF },
      'p2',
      { webhookLinked: true },
    );
    expect(metadata).toEqual({
      api4com_call_id: 'p1',
      alt_api4com_ids: ['p0', 'p2'],
      callRef: REF,
      webhook_linked: true,
    });
  });
});

describe('findCallByCallRef', () => {
  it('procura pelo id primeiro e depois pelo metadata', async () => {
    const byId = vi.fn().mockResolvedValue(null);
    const byMetadata = vi.fn().mockResolvedValue({ id: 'row' });
    expect(await findCallByCallRef(REF, { byId, byMetadata })).toEqual({ id: 'row' });
    expect(byId).toHaveBeenCalledWith(REF);
    expect(byMetadata).toHaveBeenCalledWith(REF);
  });

  it('para no id quando acha', async () => {
    const byMetadata = vi.fn();
    await findCallByCallRef(REF, { byId: async () => ({ id: REF }), byMetadata });
    expect(byMetadata).not.toHaveBeenCalled();
  });

  it('sem callRef usável não consulta', async () => {
    const byId = vi.fn();
    expect(await findCallByCallRef('lixo', { byId, byMetadata: byId })).toBeNull();
    expect(byId).not.toHaveBeenCalled();
  });
});
