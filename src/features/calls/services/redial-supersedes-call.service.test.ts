import { describe, expect, it, vi } from 'vitest';

import { makeAutoDialClient, type AutoDialDb, type Row } from '@/features/cockpit/services/auto-dial.testkit';
import { AUTO_DIAL_METADATA_KEY } from '@/features/cockpit/services/cockpit-auto-dial.service';

import { wasSupersededByRedial } from './redial-supersedes-call.service';

const NOW = new Date('2026-11-13T15:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const A = { id: 'A', org_id: 'org-1', lead_id: 'lead-1', created_at: ago(10) };

const redial = (id: string, of: string | null, over: Row = {}): Row => ({
  id, org_id: 'org-1', lead_id: 'lead-1', created_at: ago(5), answered_at: null, hangup_cause: 'NO_ANSWER', duration_seconds: 0,
  status: 'not_connected', sdr_disposition: null, metadata: { [AUTO_DIAL_METADATA_KEY]: of ? { redial_of: of } : {} }, ...over,
});
const answered = { answered_at: ago(4), hangup_cause: 'NORMAL_CLEARING', duration_seconds: 90 };

function run(calls: Row[], failReads: string[] = []) {
  const db: AutoDialDb = { tables: { calls }, failReads: new Set(failReads), reads: [], writes: [], rpc: vi.fn() };
  return { db, result: wasSupersededByRedial(makeAutoDialClient(db) as never, A, NOW) };
}

describe('wasSupersededByRedial', () => {
  it('religação atendida, com conversa marcada pelo SDR, ou ainda no ar: assumiu', async () => {
    expect(await run([redial('B', 'A', answered)]).result).toBe(true);
    expect(await run([redial('B', 'A', { sdr_disposition: 'relevant_conversation' })]).result).toBe(true);
    expect(await run([redial('B', 'A', { hangup_cause: null })]).result).toBe(true);
    expect(await run([redial('B', 'A', { answered_at: ago(4), hangup_cause: null })]).result).toBe(true);
  });

  it('cadeia A<-B<-C: B não atendeu, C conversou', async () => {
    const calls = [redial('C', 'B', { ...answered, created_at: ago(2) }), redial('B', 'A')];
    expect(await run(calls).result).toBe(true);
  });

  it('não atendeu, caixa postal, escuta desligou ou sem término há mais de 20 min: não assumiu', async () => {
    const amd = { [AUTO_DIAL_METADATA_KEY]: { redial_of: 'A' }, live_amd: { prediction: 'voicemail', confidence: 0.95 } };
    for (const over of [
      {},
      { ...answered, sdr_disposition: 'voicemail' },
      { ...answered, duration_seconds: 20, metadata: amd },
      { hangup_cause: null, created_at: ago(25) },
    ]) {
      expect(await run([redial('B', 'A', over)]).result).toBe(false);
    }
  });

  it('ligação mais nova que não é religação desta, de outro lead ou outra org: não conta', async () => {
    const calls = [
      redial('X', null, answered),
      redial('Y', 'outra', answered),
      redial('B', 'A', { ...answered, org_id: 'org-2' }),
      redial('C', 'A', { ...answered, lead_id: 'lead-2' }),
    ];
    const { db, result } = run(calls);
    expect(await result).toBe(false);
    expect(db.reads[0]?.eq).toMatchObject({ org_id: 'org-1', lead_id: 'lead-1' });
    expect(db.writes).toEqual([]);
  });

  it('falha de leitura: null', async () => {
    expect(await run([], ['calls']).result).toBeNull();
  });
});
