import { vi } from 'vitest';

import { createServiceRoleClient } from '@/lib/supabase/service';

/**
 * Banco em memoria para testar dispatcher e reconciliacao (PR08).
 *
 * Nao ha Postgres neste ambiente, entao as RPCs reproduzem a semantica de
 * 20261107170000_send_outbox.sql e 20261107180000_dispatcher_reconciliation.sql
 * (CAS por version, lease, revalidacao de supressao, transicoes de reconcile_send).
 * A atomicidade real e do banco e fica para teste de integracao com Postgres.
 * Quem usa precisa de `vi.mock('@/lib/supabase/service', ...)`.
 */

export type Row = Record<string, unknown>;

export interface World {
  /** Relogio em ms. */
  now: number;
  flags: Record<string, boolean>;
  flagReadError: boolean;
  holds: Row[];
  consent: Row[];
  outbox: Row[];
  events: Row[];
  rpcCalls: string[];
  /** Quantas proximas chamadas a confirm_send devolvem erro de escrita. */
  confirmFailures: number;
}

export function makeWorld(over: Partial<World> = {}): World {
  return {
    now: Date.parse('2026-11-07T12:00:00Z'),
    flags: { dispatcher_v1: true, send_outbox_enqueue: true },
    flagReadError: false,
    holds: [],
    consent: [],
    outbox: [],
    events: [],
    rpcCalls: [],
    confirmFailures: 0,
    ...over,
  };
}

let seq = 0;

export function seedOutbox(w: World, over: Row = {}, commandOver: Row = {}): Row {
  seq += 1;
  const row: Row = {
    id: `ob-${seq}`,
    org_id: 'org-1',
    lead_id: 'lead-1',
    channel: 'whatsapp',
    contact_identity: '5516999867577',
    idempotency_key: `org-1:lead-1:whatsapp:enr:step:${seq}`,
    provider: 'meta_cloud',
    status: 'pending',
    lease_owner: null,
    lease_expires_at: null,
    attempts: 0,
    version: 1,
    external_id: null,
    last_error: null,
    created_at: w.now + seq,
    updated_at: w.now,
    command: {
      provider: 'meta_cloud',
      senderInstanceId: 'conn-1',
      requiresTemplate: false,
      templateId: null,
      ownershipVersion: 1,
      payloadHash: '',
      decidedAt: new Date(w.now).toISOString(),
      expiresAt: new Date(w.now + 15 * 60_000).toISOString(),
      ...commandOver,
    },
    ...over,
  };
  w.outbox.push(row);
  return row;
}

const ISO_COLUMNS = ['lease_expires_at', 'updated_at', 'created_at'];

export function installOutboxWorld(w: World) {
  const iso = (ms: number) => new Date(ms).toISOString();
  const event = (o: Row, kind: string, detail: Row = {}) =>
    w.events.push({ org_id: o.org_id, outbox_id: o.id, kind, detail });
  const touch = (o: Row) => {
    o.updated_at = w.now;
  };

  const suppression = (o: Row): string | null => {
    const hold = w.holds.find((h) => h.org_id === o.org_id && h.lead_id === o.lead_id);
    if (hold) return `hold_${hold.tipo}`;
    const last = w.consent
      .filter((c) => c.org_id === o.org_id && c.contact_identity === o.contact_identity && c.channel === o.channel)
      .at(-1);
    return last?.kind === 'opt_out' ? 'consent_opted_out' : null;
  };

  const project = (o: Row): Row => {
    const out: Row = { ...o };
    for (const c of ISO_COLUMNS) if (typeof out[c] === 'number') out[c] = iso(out[c] as number);
    return out;
  };

  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let orderKey: string | null = null;
    let ascending = true;
    let max = Infinity;
    const b: Record<string, unknown> = {};
    b.select = vi.fn(() => b);
    b.eq = vi.fn((k: string, v: unknown) => (filters.push((r) => r[k] === v), b));
    b.in = vi.fn((k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b));
    b.lt = vi.fn((k: string, v: unknown) => {
      const limit = typeof v === 'string' ? Date.parse(v) : (v as number);
      filters.push((r) => typeof r[k] === 'number' && (r[k] as number) < limit);
      return b;
    });
    b.order = vi.fn((k: string, o?: { ascending?: boolean }) => ((orderKey = k), (ascending = o?.ascending ?? true), b));
    b.limit = vi.fn((n: number) => ((max = n), b));
    b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
      if (table === 'app_flags') {
        if (w.flagReadError) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(ok, ko);
        const f: Array<(r: Row) => boolean> = filters;
        const rows = Object.entries(w.flags).map(([key, enabled]) => ({ key, enabled }) as Row);
        return Promise.resolve({ data: rows.filter((r) => f.every((fn) => fn(r))), error: null }).then(ok, ko);
      }
      if (table === 'send_outbox') {
        let rows = w.outbox.filter((r) => filters.every((fn) => fn(r)));
        if (orderKey) {
          const k = orderKey;
          rows = [...rows].sort((x, y) => ((x[k] as number) - (y[k] as number)) * (ascending ? 1 : -1));
        }
        return Promise.resolve({ data: rows.slice(0, max).map(project), error: null }).then(ok, ko);
      }
      return Promise.resolve({ data: [], error: null }).then(ok, ko);
    };
    return b;
  };

  const rpc = vi.fn(async (fn: string, a: Record<string, unknown>) => {
    w.rpcCalls.push(fn);

    if (fn === 'claim_send') {
      let uncertain = 0;
      let suppressed = 0;
      for (const o of w.outbox) {
        if (o.org_id === a.p_org_id && o.status === 'sending' && (o.lease_expires_at as number) < w.now) {
          o.status = 'uncertain';
          o.version = (o.version as number) + 1;
          touch(o);
          event(o, 'lease_expired');
          event(o, 'uncertain');
          uncertain++;
        }
      }
      for (;;) {
        const cand = w.outbox
          .filter(
            (o) =>
              o.org_id === a.p_org_id &&
              (o.status === 'pending' || (o.status === 'reserved' && (o.lease_expires_at as number) < w.now)),
          )
          .sort((x, y) => (x.created_at as number) - (y.created_at as number))[0];
        if (!cand) {
          return { data: [{ outcome: 'empty', suppressed_count: suppressed, uncertain_count: uncertain }], error: null };
        }
        const reason = suppression(cand);
        if (reason) {
          cand.status = 'suppressed';
          cand.lease_owner = null;
          cand.lease_expires_at = null;
          cand.version = (cand.version as number) + 1;
          touch(cand);
          event(cand, 'suppressed', { reason, stage: 'claim' });
          suppressed++;
          continue;
        }
        cand.status = 'reserved';
        cand.lease_owner = a.p_lease_owner;
        cand.lease_expires_at = w.now + (a.p_lease_seconds as number) * 1000;
        cand.attempts = (cand.attempts as number) + 1;
        cand.version = (cand.version as number) + 1;
        touch(cand);
        event(cand, 'reserved');
        return {
          data: [
            {
              outcome: 'claimed',
              outbox_id: cand.id,
              command: cand.command,
              provider: cand.provider,
              channel: cand.channel,
              lead_id: cand.lead_id,
              version: cand.version,
              attempts: cand.attempts,
              lease_expires_at: iso(cand.lease_expires_at as number),
              suppressed_count: suppressed,
              uncertain_count: uncertain,
            },
          ],
          error: null,
        };
      }
    }

    if (fn === 'confirm_send') {
      if (w.confirmFailures > 0) {
        w.confirmFailures--;
        return { data: null, error: { message: 'write failed' } };
      }
      const o = w.outbox.find((r) => r.id === a.p_outbox_id && r.org_id === a.p_org_id);
      const out = (outcome: string) => ({
        data: [{ outcome, outbox_id: o?.id ?? null, status: o?.status ?? null, version: o?.version ?? null }],
        error: null,
      });
      if (!o) return out('not_found');
      if (o.version !== a.p_expected_version) return out('version_conflict');
      if (o.lease_owner !== a.p_lease_owner) return out('lease_mismatch');
      const target = a.p_target as string;
      const ok =
        (o.status === 'reserved' && ['sending', 'cancelled', 'failed'].includes(target)) ||
        (o.status === 'sending' && ['sent', 'failed', 'uncertain'].includes(target));
      if (!ok) return out('invalid_transition');
      if (target === 'sending') {
        const reason = suppression(o);
        if (reason) {
          o.status = 'suppressed';
          o.lease_owner = null;
          o.lease_expires_at = null;
          o.version = (o.version as number) + 1;
          touch(o);
          event(o, 'suppressed', { reason, stage: 'pre_send' });
          return out('suppressed');
        }
      }
      o.status = target;
      o.version = (o.version as number) + 1;
      if (target === 'sent') o.external_id = a.p_external_id;
      if (target === 'failed' || target === 'uncertain') o.last_error = a.p_error;
      if (target !== 'sending') {
        o.lease_owner = null;
        o.lease_expires_at = null;
      }
      touch(o);
      event(o, target, target === 'sent' ? { has_external_id: true } : a.p_error ? { error: a.p_error } : {});
      return out('confirmed');
    }

    if (fn === 'reconcile_send') {
      const o = w.outbox.find((r) => r.id === a.p_outbox_id && r.org_id === a.p_org_id);
      const out = (outcome: string) => ({
        data: [{ outcome, outbox_id: o?.id ?? null, status: o?.status ?? null, version: o?.version ?? null }],
        error: null,
      });
      const target = a.p_target as string;
      if (!['sent', 'delivered', 'failed', 'pending', 'cancelled'].includes(target) || !a.p_source) return out('invalid_input');
      if (!o) return out('not_found');
      if (o.version !== a.p_expected_version) return out('version_conflict');
      const ext = (a.p_external_id as string | null) || null;
      if (ext && o.external_id && o.external_id !== ext) return out('external_id_mismatch');
      const open = o.status === 'uncertain' || (o.status === 'sending' && (o.lease_expires_at as number) < w.now);
      let allowed = false;
      if (open) allowed = true;
      else if (o.status === 'sent') {
        if (target === 'sent') return out('noop');
        allowed = ['delivered', 'failed'].includes(target);
      } else if (o.status === 'delivered' && ['sent', 'delivered', 'failed'].includes(target)) return out('noop');
      else if (o.status === 'failed' && target === 'failed') return out('noop');
      else if (o.status === 'cancelled' && target === 'cancelled') return out('noop');
      if (!allowed) return out('invalid_transition');
      const finalExt = ext ?? (o.external_id as string | null);
      if (['sent', 'delivered'].includes(target) && !finalExt) return out('invalid_input');
      o.status = target;
      o.version = (o.version as number) + 1;
      if (['sent', 'delivered'].includes(target)) o.external_id = finalExt;
      if (a.p_command_patch) o.command = { ...(o.command as Row), ...(a.p_command_patch as Row) };
      o.lease_owner = null;
      o.lease_expires_at = null;
      touch(o);
      event(o, 'reconciled', { source: a.p_source, to: target });
      if (target === 'failed' || target === 'cancelled') o.last_error = a.p_error ?? o.last_error;
      event(o, target === 'pending' ? 'retry_scheduled' : target, a.p_error ? { error: a.p_error } : {});
      return out('confirmed');
    }

    return { data: null, error: { message: 'rpc desconhecida' } };
  });

  vi.mocked(createServiceRoleClient).mockReturnValue({ from: vi.fn(from), rpc } as never);
  return { rpc };
}
