import { beforeEach, describe, expect, it, vi } from 'vitest';

interface World {
  flag: { enabled: boolean; allow_org_ids?: string[] } | null;
  prior: unknown[];
  consent: Array<Record<string, unknown>>;
  inserts: Array<Record<string, unknown>>;
  tables: string[];
}

const w = vi.hoisted(() => ({ flag: null, prior: [], consent: [], inserts: [], tables: [] }) as World);

vi.mock('../../supabase/functions/_shared/supabase-admin.ts', () => {
  const chain = (table: string) => {
    w.tables.push(table);
    let op: 'select' | 'insert' = 'select';
    let payload: Record<string, unknown> | null = null;
    const eqs: Record<string, unknown> = {};
    const c: Record<string, unknown> = {};
    const result = () => {
      if (table === 'app_flags') return { data: w.flag ? [{ ...w.flag, allow_org_ids: w.flag.allow_org_ids ?? [] }] : [], error: null };
      if (table === 'leads') return { data: [{ id: 'lead-1', telefone: '(16) 99986-7577', phones: [] }], error: null };
      if (table === 'interactions') return { data: w.prior, error: null };
      if (table === 'contact_consent_evidence') {
        if (op === 'insert') {
          w.inserts.push(payload!);
          w.consent.push({ ...payload!, created_at: new Date(Date.now() + w.consent.length * 1000).toISOString() });
          return { data: null, error: null };
        }
        const rows = w.consent.filter((r) => Object.entries(eqs).every(([k, v]) => r[k] === v));
        return { data: [...rows].reverse(), error: null };
      }
      return { data: [], error: null };
    };
    for (const m of ['select', 'in', 'neq', 'order', 'limit']) c[m] = () => c;
    c.eq = (k: string, v: unknown) => {
      eqs[k] = v;
      return c;
    };
    c.insert = (p: Record<string, unknown>) => {
      op = 'insert';
      payload = p;
      return c;
    };
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok);
    return c;
  };
  const rpc = () => Promise.resolve({ data: ['lead-1'], error: null });
  return { supabaseAdmin: { from: chain, rpc } };
});

import { captureInboundConsent, isStopRequest } from '../../supabase/functions/_shared/consent-capture';

const ORG = 'org-1';
const reply = (text: string, messageId = 'MSG-1') => ({ phone: '5516999867577', text, messageId, pushName: null });

beforeEach(() => {
  w.flag = { enabled: true };
  w.prior = [];
  w.consent = [];
  w.inserts = [];
  w.tables = [];
});

describe('evolution: captura de consentimento', () => {
  it('flag desligada: nao consulta dados nem grava', async () => {
    w.flag = { enabled: false };
    expect(await captureInboundConsent(ORG, reply('oi'))).toEqual({ status: 'disabled' });
    expect(w.tables.every((t) => t === 'app_flags')).toBe(true);
    expect(w.inserts).toHaveLength(0);
  });

  it('flag ausente: desligada', async () => {
    w.flag = null;
    expect(await captureInboundConsent(ORG, reply('oi'))).toEqual({ status: 'disabled' });
    expect(w.inserts).toHaveLength(0);
  });

  it('org na lista allow_org_ids liga mesmo com enabled=false; outra org nao', async () => {
    w.flag = { enabled: false, allow_org_ids: ['ORG-1'] };
    expect((await captureInboundConsent(ORG, reply('oi'))).status).toBe('recorded');
    expect(await captureInboundConsent('org-2', reply('oi'))).toEqual({ status: 'disabled' });
  });

  it('lead escreveu primeiro: opt_in inbound_message, sem o texto, idempotente', async () => {
    expect(await captureInboundConsent(ORG, reply('quero saber mais'))).toEqual({ status: 'recorded', kind: 'opt_in' });
    expect(await captureInboundConsent(ORG, reply('e o preco?', 'MSG-2'))).toEqual({ status: 'duplicate' });
    expect(w.inserts).toHaveLength(1);
    expect(w.inserts[0]).toMatchObject({
      org_id: ORG, lead_id: 'lead-1', contact_identity: '5516999867577', channel: 'whatsapp',
      kind: 'opt_in', source: 'inbound_message',
    });
    expect(JSON.stringify(w.inserts)).not.toContain('saber mais');
  });

  it('resposta a envio nosso nao grava opt_in', async () => {
    w.prior = [{ id: 'i1' }];
    expect(await captureInboundConsent(ORG, reply('ok'))).toEqual({ status: 'skipped_not_first_contact' });
    expect(w.inserts).toHaveLength(0);
  });

  it('opt_out posterior a um opt_in antigo e gravado (e a mensagem seguinte nao reverte)', async () => {
    await captureInboundConsent(ORG, reply('oi'));
    expect(await captureInboundConsent(ORG, reply('PARE de me mandar mensagem', 'MSG-3'))).toEqual({ status: 'recorded', kind: 'opt_out' });
    expect(await captureInboundConsent(ORG, reply('oi de novo', 'MSG-4'))).not.toMatchObject({ status: 'recorded' });
    expect(w.inserts.map((r) => r.kind)).toEqual(['opt_in', 'opt_out']);
  });

  it('opt_out vigente: opt_in nao e gravado e novo pedido de parar nao empilha', async () => {
    expect(await captureInboundConsent(ORG, reply('parar', 'MSG-1'))).toEqual({ status: 'recorded', kind: 'opt_out' });
    expect(await captureInboundConsent(ORG, reply('oi de novo', 'MSG-2'))).toEqual({ status: 'skipped_opted_out' });
    expect(await captureInboundConsent(ORG, reply('parar', 'MSG-3'))).toEqual({ status: 'already_opted_out' });
    expect(w.inserts.map((r) => r.kind)).toEqual(['opt_out']);
  });

  it('detecta pedido de parar', () => {
    expect(isStopRequest('Não quero mais receber')).toBe(true);
    expect(isStopRequest('Pode me ligar amanhã')).toBe(false);
  });
});
