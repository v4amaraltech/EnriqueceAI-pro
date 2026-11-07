import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServiceRoleClient } from '@/lib/supabase/service';

import type { ActorIdentity } from '../types';

import {
  claimConversation,
  getContactAccess,
  getOwner,
  listLeadOwners,
  normalizeContactIdentity,
  recordConsent,
  transferConversation,
} from './ownership.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));

type Row = Record<string, unknown>;

interface World {
  flag: boolean;
  leads: Row[];
  members: Row[];
  holds: Row[];
  consent: Row[];
  ownership: Row[];
  events: Row[];
  writes: string[];
}

/**
 * Banco em memoria. As RPCs reproduzem a semantica das funcoes SQL (unicidade
 * do ativo por org+identidade+canal e CAS por version); a atomicidade real e do
 * Postgres. Cada chamada e sincrona, como seria a serializacao do indice unico.
 */
function makeWorld(over: Partial<World> = {}): World {
  return {
    flag: true,
    leads: [
      { id: 'lead-1', org_id: 'org-1' },
      { id: 'lead-2', org_id: 'org-2' },
    ],
    members: [
      { org_id: 'org-1', user_id: 'u1', status: 'active' },
      { org_id: 'org-1', user_id: 'u2', status: 'active' },
      { org_id: 'org-1', user_id: 'u-susp', status: 'suspended' },
      { org_id: 'org-2', user_id: 'u9', status: 'active' },
    ],
    holds: [],
    consent: [],
    ownership: [],
    events: [],
    writes: [],
    ...over,
  };
}

function installClient(w: World) {
  const tables: Record<string, Row[]> = {
    leads: w.leads,
    organization_members: w.members,
    contact_holds: w.holds,
    contact_consent_evidence: w.consent,
    conversation_ownership: w.ownership,
  };

  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let insertRow: Row | null = null;
    const b: Record<string, unknown> = {};
    const run = () => {
      if (table === 'app_flags') {
        return { data: [{ enabled: w.flag }], error: null };
      }
      if (insertRow) {
        w.writes.push(table);
        const row = { id: `${table}-${tables[table]!.length + 1}`, created_at: new Date().toISOString(), ...insertRow };
        tables[table]!.push(row);
        return { data: [{ id: row.id }], error: null };
      }
      const data = (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
      return { data, error: null };
    };
    for (const m of ['select', 'order', 'limit']) b[m] = vi.fn(() => b);
    b.eq = vi.fn((k: string, v: unknown) => {
      filters.push([k, v]);
      return b;
    });
    b.insert = vi.fn((row: Row) => {
      insertRow = row;
      return b;
    });
    b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko);
    return b;
  };

  const rpc = vi.fn(async (fn: string, a: Record<string, unknown>) => {
    w.writes.push(fn);
    const active = () =>
      w.ownership.find(
        (o) =>
          o.org_id === a.p_org_id &&
          o.contact_identity === a.p_contact_identity &&
          o.channel === a.p_channel &&
          o.status === 'active',
      );
    const out = (outcome: string, o?: Row) => ({
      data: [{ outcome, ownership_id: o?.id ?? null, owner_user_id: o?.owner_user_id ?? null, version: o?.version ?? null }],
      error: null,
    });

    if (fn === 'claim_conversation_ownership') {
      if (!w.leads.some((l) => l.id === a.p_lead_id && l.org_id === a.p_org_id)) return out('lead_not_in_org');
      const cur = active();
      if (cur) return out(cur.owner_user_id === a.p_user_id ? 'already_owner' : 'conflict', cur);
      const row: Row = {
        id: `own-${w.ownership.length + 1}`,
        org_id: a.p_org_id,
        lead_id: a.p_lead_id,
        contact_identity: a.p_contact_identity,
        channel: a.p_channel,
        owner_user_id: a.p_user_id,
        status: 'active',
        version: 1,
      };
      w.ownership.push(row);
      w.events.push({ kind: 'claim', ownership_id: row.id, to_user_id: a.p_user_id, actor_source: a.p_actor_source });
      return out('claimed', row);
    }
    if (fn === 'transfer_conversation_ownership') {
      const cur = active();
      if (!cur) return out('not_found');
      if (cur.version !== a.p_expected_version) return out('version_conflict');
      const prev = cur.owner_user_id;
      cur.owner_user_id = a.p_to_user_id;
      cur.status = a.p_to_user_id === null ? 'released' : 'active';
      cur.version = (cur.version as number) + 1;
      w.events.push({
        kind: a.p_to_user_id === null ? 'release' : 'transfer',
        ownership_id: cur.id,
        from_user_id: prev,
        to_user_id: a.p_to_user_id,
        reason: a.p_reason,
      });
      return out(a.p_to_user_id === null ? 'released' : 'transferred', cur);
    }
    return { data: null, error: { message: 'rpc desconhecida' } };
  });

  vi.mocked(createServiceRoleClient).mockReturnValue({ from: vi.fn(from), rpc } as never);
  return { rpc };
}

const actor = (over: Partial<ActorIdentity> = {}): ActorIdentity => ({
  orgId: 'org-1',
  userId: 'u1',
  source: 'app',
  apiKeyId: null,
  ...over,
});

const PHONE = '+55 (16) 99986-7577';

beforeEach(() => {
  vi.mocked(createServiceRoleClient).mockReset();
});

describe('normalizeContactIdentity', () => {
  it('normaliza telefone e e-mail e rejeita invalidos', () => {
    expect(normalizeContactIdentity('whatsapp', PHONE)).toBe('5516999867577');
    expect(normalizeContactIdentity('email', '  Ana@Acme.com ')).toBe('ana@acme.com');
    expect(normalizeContactIdentity('whatsapp', '123')).toBeNull();
    expect(normalizeContactIdentity('email', 'sem-arroba')).toBeNull();
    expect(normalizeContactIdentity('phone', '')).toBeNull();
  });
});

describe('flag conversation_ownership_v1 desligada', () => {
  it('nao escreve nada (claim, transfer, consentimento)', async () => {
    const w = makeWorld({ flag: false });
    const { rpc } = installClient(w);

    const claim = await claimConversation({ actor: actor(), leadId: 'lead-1', contact: PHONE, channel: 'whatsapp', ownerUserId: 'u1' });
    const transfer = await transferConversation({ actor: actor(), contact: PHONE, channel: 'whatsapp', expectedVersion: 1, toUserId: 'u2', reason: 'x' });
    const consent = await recordConsent({ actor: actor(), leadId: 'lead-1', contact: PHONE, channel: 'whatsapp', kind: 'opt_in', source: 'ligacao' });

    for (const r of [claim, transfer, consent]) {
      expect(r).toMatchObject({ success: false, code: 'flag_disabled' });
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(w.writes).toEqual([]);
    expect(w.ownership).toHaveLength(0);
    expect(w.consent).toHaveLength(0);
  });

  it('leituras nao consultam dados e o acesso fecha (fail-closed)', async () => {
    const w = makeWorld({ flag: false });
    installClient(w);
    expect(await getOwner({ orgId: 'org-1', contact: PHONE, channel: 'whatsapp' })).toEqual({ success: true, data: null });
    expect(await listLeadOwners({ orgId: 'org-1', leadId: 'lead-1' })).toEqual({ success: true, data: [] });
    const access = await getContactAccess({ orgId: 'org-1', leadId: 'lead-1', contact: PHONE, channel: 'whatsapp' });
    expect(access).toMatchObject({ success: true, data: { allowed: false, reasons: ['flag_disabled'] } });
  });
});

describe('claim', () => {
  it('registra o dono e a trilha de claim', async () => {
    const w = makeWorld();
    installClient(w);
    const r = await claimConversation({ actor: actor(), leadId: 'lead-1', contact: PHONE, channel: 'whatsapp', ownerUserId: 'u1', provider: 'meta_cloud' });
    expect(r).toMatchObject({ success: true, data: { outcome: 'claimed', ownerUserId: 'u1', version: 1 } });
    expect(w.events).toEqual([expect.objectContaining({ kind: 'claim', to_user_id: 'u1', actor_source: 'app' })]);
  });

  it('claim simultaneo: o segundo falha por conflito e o dono nao muda', async () => {
    const w = makeWorld();
    installClient(w);
    const [a, b] = await Promise.all([
      claimConversation({ actor: actor(), leadId: 'lead-1', contact: PHONE, channel: 'whatsapp', ownerUserId: 'u1' }),
      claimConversation({ actor: actor({ userId: 'u2' }), leadId: 'lead-1', contact: '5516999867577', channel: 'whatsapp', ownerUserId: 'u2' }),
    ]);
    expect(a.success).toBe(true);
    expect(b).toMatchObject({ success: false, code: 'conflict' });
    expect(w.ownership).toHaveLength(1);
    expect(w.ownership[0]).toMatchObject({ owner_user_id: 'u1', version: 1 });
  });

  it('claim repetido do mesmo usuario e idempotente', async () => {
    const w = makeWorld();
    installClient(w);
    const input = { actor: actor(), leadId: 'lead-1', contact: PHONE, channel: 'whatsapp' as const, ownerUserId: 'u1' };
    await claimConversation(input);
    const again = await claimConversation(input);
    expect(again).toMatchObject({ success: true, data: { outcome: 'already_owner', version: 1 } });
    expect(w.events).toHaveLength(1);
  });

  it('lead com varios contatos: uma linha de ownership por identidade', async () => {
    const w = makeWorld();
    installClient(w);
    const base = { actor: actor(), leadId: 'lead-1' };
    const a = await claimConversation({ ...base, contact: '16999867577', channel: 'whatsapp', ownerUserId: 'u1' });
    const b = await claimConversation({ ...base, contact: '11988887777', channel: 'whatsapp', ownerUserId: 'u2' });
    const c = await claimConversation({ ...base, contact: 'ana@acme.com', channel: 'email', ownerUserId: 'u1' });
    expect([a, b, c].every((r) => r.success)).toBe(true);
    const owners = await listLeadOwners({ orgId: 'org-1', leadId: 'lead-1' });
    expect(owners.success && owners.data).toHaveLength(3);
  });

  it('nega lead de outra organizacao e responsavel de outra organizacao', async () => {
    const w = makeWorld();
    const { rpc } = installClient(w);
    const otherLead = await claimConversation({ actor: actor(), leadId: 'lead-2', contact: PHONE, channel: 'whatsapp', ownerUserId: 'u1' });
    const otherUser = await claimConversation({ actor: actor(), leadId: 'lead-1', contact: PHONE, channel: 'whatsapp', ownerUserId: 'u9' });
    const suspended = await claimConversation({ actor: actor(), leadId: 'lead-1', contact: PHONE, channel: 'whatsapp', ownerUserId: 'u-susp' });
    for (const r of [otherLead, otherUser, suspended]) expect(r).toMatchObject({ success: false, code: 'not_found' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejeita contato invalido', async () => {
    installClient(makeWorld());
    const r = await claimConversation({ actor: actor(), leadId: 'lead-1', contact: '12', channel: 'whatsapp', ownerUserId: 'u1' });
    expect(r).toMatchObject({ success: false, code: 'invalid_contact' });
  });
});

describe('transfer', () => {
  async function owned() {
    const w = makeWorld();
    installClient(w);
    await claimConversation({ actor: actor(), leadId: 'lead-1', contact: PHONE, channel: 'whatsapp', ownerUserId: 'u1' });
    return w;
  }

  it('transfere com CAS e audita o handoff', async () => {
    const w = await owned();
    const r = await transferConversation({ actor: actor(), contact: PHONE, channel: 'whatsapp', expectedVersion: 1, toUserId: 'u2', reason: 'SDR de ferias' });
    expect(r).toMatchObject({ success: true, data: { outcome: 'transferred', ownerUserId: 'u2', version: 2 } });
    expect(w.events.at(-1)).toMatchObject({ kind: 'transfer', from_user_id: 'u1', to_user_id: 'u2', reason: 'SDR de ferias' });
  });

  it('versao desatualizada falha e nao altera o dono', async () => {
    const w = await owned();
    await transferConversation({ actor: actor(), contact: PHONE, channel: 'whatsapp', expectedVersion: 1, toUserId: 'u2', reason: 'a' });
    const stale = await transferConversation({ actor: actor(), contact: PHONE, channel: 'whatsapp', expectedVersion: 1, toUserId: 'u1', reason: 'b' });
    expect(stale).toMatchObject({ success: false, code: 'version_conflict' });
    expect(w.ownership[0]).toMatchObject({ owner_user_id: 'u2', version: 2 });
  });

  it('destinatario nulo libera a conversa', async () => {
    const w = await owned();
    const r = await transferConversation({ actor: actor(), contact: PHONE, channel: 'whatsapp', expectedVersion: 1, toUserId: null, reason: 'encerrada' });
    expect(r).toMatchObject({ success: true, data: { outcome: 'released' } });
    expect(w.events.at(-1)).toMatchObject({ kind: 'release' });
    expect(await getOwner({ orgId: 'org-1', contact: PHONE, channel: 'whatsapp' })).toEqual({ success: true, data: null });
  });

  it('exige motivo e destinatario da mesma organizacao', async () => {
    await owned();
    const noReason = await transferConversation({ actor: actor(), contact: PHONE, channel: 'whatsapp', expectedVersion: 1, toUserId: 'u2', reason: '  ' });
    const foreign = await transferConversation({ actor: actor(), contact: PHONE, channel: 'whatsapp', expectedVersion: 1, toUserId: 'u9', reason: 'x' });
    expect(noReason).toMatchObject({ success: false, code: 'invalid_input' });
    expect(foreign).toMatchObject({ success: false, code: 'not_found' });
  });

  it('ator de outra organizacao nao enxerga nem transfere a conversa', async () => {
    const w = await owned();
    const r = await transferConversation({ actor: actor({ orgId: 'org-2', userId: 'u9' }), contact: PHONE, channel: 'whatsapp', expectedVersion: 1, toUserId: 'u9', reason: 'x' });
    expect(r).toMatchObject({ success: false, code: 'not_found' });
    expect(w.ownership[0]).toMatchObject({ owner_user_id: 'u1', version: 1 });
    expect(await getOwner({ orgId: 'org-2', contact: PHONE, channel: 'whatsapp' })).toEqual({ success: true, data: null });
  });
});

describe('consentimento e acesso (integra contact-holds)', () => {
  const access = () => getContactAccess({ orgId: 'org-1', leadId: 'lead-1', contact: PHONE, channel: 'whatsapp' });

  it('sem holds nem opt-out libera e devolve o dono', async () => {
    const w = makeWorld();
    installClient(w);
    await claimConversation({ actor: actor(), leadId: 'lead-1', contact: PHONE, channel: 'whatsapp', ownerUserId: 'u1' });
    const r = await access();
    expect(r).toMatchObject({ success: true, data: { allowed: true, reasons: [], owner: { ownerUserId: 'u1' } } });
  });

  it('opt-out bloqueia; opt-in posterior reabre', async () => {
    const w = makeWorld();
    installClient(w);
    const optOut = await recordConsent({ actor: actor(), leadId: 'lead-1', contact: PHONE, channel: 'whatsapp', kind: 'opt_out', source: 'whatsapp_pediu_para_parar', evidence: { interaction_id: 'i-1' } });
    expect(optOut.success).toBe(true);
    expect(await access()).toMatchObject({ success: true, data: { allowed: false, reasons: ['consent_opted_out'], lastConsent: 'opt_out' } });
  });

  it('hold total bloqueia; hold de prospeccao nao, mas e reportado', async () => {
    const w = makeWorld({ holds: [{ org_id: 'org-1', lead_id: 'lead-1', tipo: 'prospeccao' }] });
    installClient(w);
    expect(await access()).toMatchObject({ success: true, data: { allowed: true, holds: { bloqueado_prospeccao: true, bloqueado_total: false } } });
    w.holds.push({ org_id: 'org-1', lead_id: 'lead-1', tipo: 'total' });
    expect(await access()).toMatchObject({ success: true, data: { allowed: false, reasons: ['hold_total'] } });
  });

  it('holds e consentimento de outra organizacao nao vazam', async () => {
    const w = makeWorld({ holds: [{ org_id: 'org-2', lead_id: 'lead-1', tipo: 'total' }] });
    installClient(w);
    expect(await access()).toMatchObject({ success: true, data: { allowed: true } });
  });

  it('nao registra consentimento para lead de outra organizacao e filtra evidencia sensivel', async () => {
    const w = makeWorld();
    installClient(w);
    const foreign = await recordConsent({ actor: actor(), leadId: 'lead-2', contact: PHONE, channel: 'whatsapp', kind: 'opt_in', source: 'x' });
    expect(foreign).toMatchObject({ success: false, code: 'not_found' });
    const nested = await recordConsent({ actor: actor(), leadId: 'lead-1', contact: PHONE, channel: 'whatsapp', kind: 'opt_in', source: 'x', evidence: { a: { b: 1 } as never } });
    expect(nested).toMatchObject({ success: false, code: 'invalid_input' });
    expect(w.consent).toHaveLength(0);
  });
});
