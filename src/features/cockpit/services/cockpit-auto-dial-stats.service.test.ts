import { describe, expect, it } from 'vitest';

import { type AutoDialDb, type Row, makeAutoDialClient } from './auto-dial.testkit';
import { getAutoDialDayStats } from './cockpit-auto-dial-stats.service';

const ORG = 'org-1';
const ME = 'user-1';
/** Sexta 13/11/2026 12:00 BRT; o dia de Brasília começou às 03:00Z. */
const NOW = new Date('2026-11-13T15:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const MOTOR = { cockpit_auto_dial: { attempt_no: 1 } };

let n = 0;
const call = (over: Row = {}): Row => ({
  id: `c${++n}`,
  org_id: ORG,
  user_id: ME,
  lead_id: 'L',
  created_at: ago(60),
  started_at: ago(60),
  answered_at: null,
  duration_seconds: 0,
  status: 'not_connected',
  sdr_disposition: null,
  metadata: MOTOR,
  ...over,
});
const talk = (over: Row = {}): Row =>
  call({
    answered_at: ago(59),
    duration_seconds: 120,
    status: 'completed',
    sdr_disposition: 'relevant_conversation',
    ...over,
  });

function client(calls: Row[]) {
  const db: AutoDialDb = {
    tables: { calls },
    failReads: new Set(),
    reads: [],
    writes: [],
    rpc: undefined as never,
  };
  return { db, client: makeAutoDialClient(db) as never };
}
const stats = (calls: Row[]) => getAutoDialDayStats(client(calls).client, ORG, ME, NOW);

describe('getAutoDialDayStats', () => {
  it('sem ligações: zeros, taxa 0 (sem divisão por zero) e o teto inteiro restante', async () => {
    expect(await stats([])).toEqual({
      callsToday: 0,
      answeredToday: 0,
      ratePct: 0,
      dailyCap: 400,
      remaining: 400,
    });
  });

  it('conversa real × caixa postal × curta (< 50 s) × falha: só a conversa real conta como atendida', async () => {
    const r = await stats([
      talk(), // desfecho do SDR
      call({
        sdr_disposition: 'voicemail',
        answered_at: ago(59),
        duration_seconds: 80,
        status: 'completed',
      }), // caixa postal
      call({ answered_at: ago(59), duration_seconds: 20, status: 'completed' }), // curta, sem desfecho
      call({ answered_at: ago(59), duration_seconds: 90, status: 'completed' }), // conectada >= 50 s, sem desfecho
      call({ sdr_disposition: 'no_answer' }),
      call({ sdr_disposition: 'technical_failure' }),
    ]);
    expect(r).toMatchObject({ callsToday: 6, answeredToday: 2, ratePct: 33, remaining: 394 });
  });

  it('desfecho do IA vale quando o SDR não marcou (aplicado e com confiança)', async () => {
    const ai = (disposition: string, confidence: number) => ({
      ...MOTOR,
      ai_outcome: { status: 'done', disposition, confidence, applied: true, needs_review: false },
    });
    const r = await stats([
      call({ metadata: ai('relevant_conversation', 0.95) }),
      call({ metadata: ai('voicemail', 0.95) }),
    ]);
    expect(r).toMatchObject({ callsToday: 2, answeredToday: 1, ratePct: 50 });
  });

  it('virada do dia em BRT (UTC-3): 02:59Z de hoje é de ontem; 03:00Z é de hoje', async () => {
    const r = await stats([
      talk({ started_at: '2026-11-13T02:59:59.000Z', created_at: '2026-11-13T02:59:59.000Z' }), // ontem 23:59 BRT
      talk({ started_at: '2026-11-13T03:00:00.000Z', created_at: '2026-11-13T03:00:00.000Z' }), // hoje 00:00 BRT
    ]);
    expect(r).toMatchObject({ callsToday: 1, answeredToday: 1, ratePct: 100 });
  });

  it('só ligações DO MOTOR (marcador): manuais e da Execução não contam', async () => {
    const r = await stats([
      talk(),
      talk({ metadata: {} }),
      talk({ metadata: null }),
      talk({ metadata: { outro: true } }),
    ]);
    expect(r).toMatchObject({ callsToday: 1, answeredToday: 1 });
  });

  it('só o usuário e a org certos', async () => {
    const r = await stats([talk(), talk({ user_id: 'outro' }), talk({ org_id: 'org-2' })]);
    expect(r).toMatchObject({ callsToday: 1, answeredToday: 1 });
    const { db, client: c } = client([talk()]);
    await getAutoDialDayStats(c, ORG, ME, NOW);
    expect(db.reads.every((x) => x.eq.org_id === ORG && x.eq.user_id === ME)).toBe(true);
    expect(db.writes).toEqual([]);
  });

  it('teto: restante nunca fica negativo', async () => {
    const r = await stats(Array.from({ length: 401 }, () => call()));
    expect(r).toMatchObject({ callsToday: 401, dailyCap: 400, remaining: 0 });
  });

  it('arredonda a taxa (2 de 3 = 67)', async () => {
    const r = await stats([talk(), talk(), call({ sdr_disposition: 'no_answer' })]);
    expect(r?.ratePct).toBe(67);
  });

  it('erro de leitura (contagem ou ligações) = null, nunca número parcial', async () => {
    const a = client([talk()]);
    a.db.failReads.add('calls');
    expect(await getAutoDialDayStats(a.client, ORG, ME, NOW)).toBeNull();
  });
});
