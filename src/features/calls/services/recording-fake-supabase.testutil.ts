/**
 * Supabase em memória só para os testes de gravação. Cobre o subconjunto de
 * filtros usado por recording-storage/recording-repair. Sem rede, sem DB.
 */
import { applyMergeCallsMetadataRpc, type MergeCallsMetadataArgs } from '@tests/mocks/merge-calls-metadata';

export type Row = Record<string, unknown>;

export interface FakeSupabase {
  client: never;
  calls: Row[];
  uploads: Array<{ path: string; buffer: Buffer }>;
  storage: Map<string, Buffer>;
  updates: Array<{ id: unknown; payload: Row }>;
}

function readCol(row: Row, col: string): unknown {
  const m = /^(\w+)->>(\w+)$/.exec(col);
  if (!m) return row[col];
  const obj = row[m[1]!] as Row | null | undefined;
  const v = obj?.[m[2]!];
  return v === undefined || v === null ? null : String(v);
}

/** Áudio fake: o "conteúdo" do buffer é `dur:<segundos>`. O mock de measureAudioSeconds lê isso. */
export function fakeAudio(seconds: number): Buffer {
  return Buffer.from(`dur:${seconds}`);
}
export function fakeAudioSeconds(buffer: Buffer): number | null {
  const m = /^dur:([\d.]+)$/.exec(buffer.toString());
  return m ? Number(m[1]) : null;
}

export function makeFakeSupabase(initialCalls: Row[], initialStorage: Record<string, Buffer> = {}): FakeSupabase {
  const calls = initialCalls;
  const storage = new Map<string, Buffer>(Object.entries(initialStorage));
  const uploads: FakeSupabase['uploads'] = [];
  const updates: FakeSupabase['updates'] = [];

  const makeQuery = () => {
    const preds: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let sortCol: string | null = null;
    let max = Infinity;
    const run = (): Row[] => {
      let rows = calls.filter((r) => preds.every((p) => p(r)));
      if (sortCol) rows = [...rows].sort((a, b) => String(a[sortCol!]).localeCompare(String(b[sortCol!])));
      rows = rows.slice(0, max);
      if (patch) {
        for (const r of rows) {
          Object.assign(r, patch);
          updates.push({ id: r.id, payload: patch });
        }
      }
      return rows;
    };
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.update = (p: Row) => {
      patch = p;
      return q;
    };
    q.eq = (c: string, v: unknown) => (preds.push((r) => readCol(r, c) === v), q);
    q.neq = (c: string, v: unknown) => (preds.push((r) => readCol(r, c) !== v), q);
    q.gt = (c: string, v: unknown) => (preds.push((r) => (readCol(r, c) as number | string) > (v as number | string)), q);
    q.gte = (c: string, v: unknown) => (preds.push((r) => (readCol(r, c) as number | string) >= (v as number | string)), q);
    q.not = (c: string) => (preds.push((r) => readCol(r, c) !== null && readCol(r, c) !== undefined), q);
    q.order = (c: string) => ((sortCol = c), q);
    q.limit = (n: number) => ((max = n), q);
    q.single = () => Promise.resolve({ data: run()[0] ?? null, error: null });
    q.maybeSingle = q.single;
    q.then = (resolve: (v: unknown) => void) => resolve({ data: run(), error: null });
    return q;
  };

  const client = {
    from: () => makeQuery(),
    // RPC merge_calls_metadata: metadata || patch na linha, como no banco.
    rpc: (fn: string, args: MergeCallsMetadataArgs) => {
      if (fn !== 'merge_calls_metadata') return Promise.resolve({ data: null, error: { message: `rpc desconhecida: ${fn}` } });
      const r = applyMergeCallsMetadataRpc(calls, args);
      if (r.affected > 0) updates.push({ id: args.p_id, payload: { metadata: args.p_patch } });
      return Promise.resolve({ data: r.data, error: null });
    },
    storage: {
      from: () => ({
        upload: (path: string, buffer: Buffer) => {
          uploads.push({ path, buffer });
          storage.set(path, buffer);
          return Promise.resolve({ error: null });
        },
        download: (path: string) => {
          const b = storage.get(path);
          return Promise.resolve(b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: 'nf' } });
        },
      }),
    },
  };

  return { client: client as never, calls, uploads, storage, updates };
}

/** Resposta de download fake com eTag. */
export function fakeAudioResponse(seconds: number, etag: string | null = null) {
  const buf = fakeAudio(seconds);
  return {
    ok: true,
    arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
    headers: { get: (h: string) => (h.toLowerCase() === 'etag' ? etag : null) },
  };
}
