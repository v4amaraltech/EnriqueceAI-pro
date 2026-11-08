import { vi } from 'vitest';

type Row = Record<string, unknown>;

export interface ConsentWorld {
  flags: Record<string, { enabled: boolean; allow_org_ids?: string[] }>;
  leads: Row[];
  interactions: Row[];
  calls: Row[];
  consent: Row[];
  holds: Row[];
  ownership: Row[];
  /** Tabelas lidas (exceto app_flags) e escritas, para provar "flag desligada = nada acontece". */
  reads: string[];
  writes: string[];
}

export function makeConsentWorld(over: Partial<ConsentWorld> = {}): ConsentWorld {
  return {
    flags: {},
    leads: [
      { id: 'lead-1', org_id: 'org-1' },
      { id: 'lead-2', org_id: 'org-2' },
    ],
    interactions: [],
    calls: [],
    consent: [],
    holds: [],
    ownership: [],
    reads: [],
    writes: [],
    ...over,
  };
}

/** Cliente Supabase em memoria com o subconjunto usado pelo servico de consentimento. */
export function makeConsentClient(w: ConsentWorld) {
  const tables: Record<string, Row[]> = {
    leads: w.leads,
    interactions: w.interactions,
    calls: w.calls,
    contact_consent_evidence: w.consent,
    contact_holds: w.holds,
    conversation_ownership: w.ownership,
  };
  let clock = Date.parse('2026-11-08T10:00:00.000Z');

  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let insertRow: Row | null = null;
    let desc = false;
    let max = Infinity;
    const b: Record<string, unknown> = {};
    const run = () => {
      if (table === 'app_flags') {
        return { data: appFlagRows(), error: null };
      }
      if (insertRow) {
        w.writes.push(table);
        clock += 1000;
        const row = { id: `${table}-${tables[table]!.length + 1}`, created_at: new Date(clock).toISOString(), ...insertRow };
        tables[table]!.push(row);
        return { data: [{ id: row.id }], error: null };
      }
      w.reads.push(table);
      let data = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (desc) data = [...data].sort((a, c) => Date.parse(String(c.created_at)) - Date.parse(String(a.created_at)));
      return { data: data.slice(0, max), error: null };
    };
    let flagKey: string | null = null;
    const appFlagRows = () => {
      const f = flagKey ? w.flags[flagKey] : undefined;
      return f ? [{ enabled: f.enabled, allow_org_ids: f.allow_org_ids ?? [], allow_user_ids: [] }] : [];
    };
    b.select = vi.fn(() => b);
    b.eq = vi.fn((k: string, v: unknown) => {
      if (table === 'app_flags' && k === 'key') flagKey = String(v);
      else filters.push((r) => r[k] === v);
      return b;
    });
    b.neq = vi.fn((k: string, v: unknown) => {
      filters.push((r) => r[k] !== v);
      return b;
    });
    b.order = vi.fn((_k: string, o?: { ascending?: boolean }) => {
      desc = o?.ascending === false;
      return b;
    });
    b.limit = vi.fn((n: number) => {
      max = n;
      return b;
    });
    b.maybeSingle = vi.fn(async () => {
      const res = run() as { data: Row[]; error: null };
      return { data: res.data[0] ?? null, error: null };
    });
    b.insert = vi.fn((row: Row) => {
      insertRow = row;
      return b;
    });
    b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko);
    return b;
  };

  return { from: vi.fn(from) };
}
