import { describe, expect, it } from 'vitest';

import {
  ENGINE_FLAG_KEYS,
  PAUSE_ORDER,
  SAFETY_FLAGS,
  deriveGatewayMode,
  summarizeFlag,
} from './pilot-status.service';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

describe('summarizeFlag', () => {
  it('linha ausente: desligada e marcada como ausente', () => {
    expect(summarizeFlag('dispatcher_v1', undefined, ORG_A)).toMatchObject({
      present: false,
      effectiveForOrg: false,
    });
  });

  it('desligada com listas vazias: desligada para a org (igual a hoje)', () => {
    const f = summarizeFlag(
      'dispatcher_v1',
      { key: 'dispatcher_v1', enabled: false, allow_org_ids: [], allow_user_ids: [] },
      ORG_A,
    );
    expect(f).toMatchObject({
      globalEnabled: false,
      orgListed: false,
      userRestricted: false,
      effectiveForOrg: false,
    });
  });

  it('só a org listada aparece como ligada; outra org não vê a lista nem o efeito', () => {
    const row = {
      key: 'dispatcher_v1',
      enabled: false,
      allow_org_ids: [ORG_A],
      allow_user_ids: ['u'],
    };
    expect(summarizeFlag(row.key, row, ORG_A)).toMatchObject({
      orgListed: true,
      userRestricted: true,
      effectiveForOrg: true,
    });
    const other = summarizeFlag(row.key, row, ORG_B);
    expect(other).toMatchObject({ orgListed: false, effectiveForOrg: false });
    expect(JSON.stringify(other)).not.toContain(ORG_A);
  });
});

describe('deriveGatewayMode', () => {
  const st = (key: string, on: boolean) => ({
    key,
    present: true,
    globalEnabled: on,
    orgListed: false,
    userRestricted: false,
    effectiveForOrg: on,
  });
  it('off, shadow e enforced (enforced vence)', () => {
    expect(
      deriveGatewayMode([st('send_gateway_shadow', false), st('send_gateway_enforced', false)]),
    ).toBe('off');
    expect(
      deriveGatewayMode([st('send_gateway_shadow', true), st('send_gateway_enforced', false)]),
    ).toBe('shadow');
    expect(
      deriveGatewayMode([st('send_gateway_shadow', true), st('send_gateway_enforced', true)]),
    ).toBe('enforced');
  });
});

describe('ordem de pausa', () => {
  it('envio primeiro e flags de segurança nunca entram na pausa (rollback não é bypass)', () => {
    expect(PAUSE_ORDER[0]).toBe('dispatcher_v1');
    expect(PAUSE_ORDER[1]).toBe('send_outbox_enqueue');
    for (const k of SAFETY_FLAGS) expect(PAUSE_ORDER).not.toContain(k);
    for (const k of [...PAUSE_ORDER, ...SAFETY_FLAGS]) expect(ENGINE_FLAG_KEYS).toContain(k);
    expect(PAUSE_ORDER.length + SAFETY_FLAGS.length).toBe(ENGINE_FLAG_KEYS.length);
  });
});
