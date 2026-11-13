import { describe, expect, it, vi } from 'vitest';

import {
  isFillCandidate,
  parseFillBodyTextArgs,
  runFillBodyText,
  type FillBodyTextDb,
  type FillCandidateRow,
} from './fill-body-text-script';

const V4 = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
const OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECRET_BODY = 'Proposta confidencial para Roberta';

let seq = 0;
function row(over: Partial<FillCandidateRow> = {}): FillCandidateRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    org_id: V4,
    channel: 'email',
    direction: 'outbound',
    provider: 'gmail',
    body_text: null,
    body_html: `<p>${SECRET_BODY}</p>`,
    created_at: `2026-11-13T11:${String(seq).padStart(2, '0')}:00.000Z`,
    ...over,
  };
}

function fakeDb(rows: FillCandidateRow[]) {
  const updates: Array<{ id: string; text: string }> = [];
  const db: FillBodyTextDb = {
    listCandidates: vi.fn(async (orgId, after, limit) => rows
      .filter((item) => item.org_id === orgId)
      .filter((item) => !after || item.created_at > after.createdAt || (item.created_at === after.createdAt && item.id > after.id))
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .slice(0, limit)),
    updateBodyText: vi.fn(async (_orgId, id, text) => {
      updates.push({ id, text });
      return true;
    }),
  };
  return { db, updates };
}

describe('argumentos do preenchimento de body_text', () => {
  it('exige --org com uuid', () => {
    expect(() => parseFillBodyTextArgs([])).toThrow(/--org/);
    expect(() => parseFillBodyTextArgs(['--org', 'abc'])).toThrow(/--org/);
  });

  it('o padrão é dry-run', () => {
    expect(parseFillBodyTextArgs(['--org', V4])).toEqual({ orgId: V4, apply: false });
    expect(parseFillBodyTextArgs([`--org=${V4}`, '--dry-run'])).toEqual({ orgId: V4, apply: false });
    expect(parseFillBodyTextArgs(['--org', V4, '--apply'])).toEqual({ orgId: V4, apply: true });
  });

  it('--apply com --dry-run é erro, e argumento estranho também', () => {
    expect(() => parseFillBodyTextArgs(['--org', V4, '--apply', '--dry-run'])).toThrow(/só um modo/);
    expect(() => parseFillBodyTextArgs(['--org', V4, '--execute'])).toThrow(/desconhecido/);
  });
});

describe('seleção e contagem', () => {
  it('candidata é HTML com conteúdo e texto nulo ou vazio', () => {
    expect(isFillCandidate({ body_text: null, body_html: '<p>x</p>' })).toBe(true);
    expect(isFillCandidate({ body_text: '  ', body_html: '<p>x</p>' })).toBe(true);
    expect(isFillCandidate({ body_text: 'já tem', body_html: '<p>x</p>' })).toBe(false);
    expect(isFillCandidate({ body_text: null, body_html: '  ' })).toBe(false);
  });

  it('dry-run conta por canal, direção e provider, não grava e não imprime corpo', async () => {
    const rows = [
      row(),
      row(),
      row({ body_html: '<p>&nbsp;</p>' }),
      row({ provider: 'legacy_interactions', body_html: '<b>TOKENLEGADO</b>' }),
      row({ body_text: 'já preenchido' }),
      row({ org_id: OTHER }),
    ];
    const { db, updates } = fakeDb(rows);
    const lines: string[] = [];
    const report = await runFillBodyText({ argv: ['--org', V4], db, log: (line) => lines.push(line), pageSize: 2 });

    expect(report.apply).toBe(false);
    expect(report.total).toEqual({ candidates: 4, fillable: 3, stillEmpty: 1, updated: 0 });
    expect(report.groups['email/outbound/gmail']).toEqual({ candidates: 3, fillable: 2, stillEmpty: 1, updated: 0 });
    expect(report.groups['email/outbound/legacy_interactions']).toEqual({ candidates: 1, fillable: 1, stillEmpty: 0, updated: 0 });
    expect(report.stillEmptyIds).toEqual([rows[2]!.id]);
    expect(updates).toEqual([]);
    expect(db.updateBodyText).not.toHaveBeenCalled();
    const output = lines.join('\n');
    expect(output).toContain('Dry-run: nenhuma escrita.');
    expect(output).not.toContain(SECRET_BODY);
    expect(output).not.toContain('<p>');
    expect(output).not.toContain('TOKENLEGADO');
  });

  it('com --apply grava só o texto convertido das preenchíveis', async () => {
    const rows = [row(), row({ body_html: '<br>' })];
    const { db, updates } = fakeDb(rows);
    const report = await runFillBodyText({ argv: ['--org', V4, '--apply'], db, log: () => {} });
    expect(updates).toEqual([{ id: rows[0]!.id, text: SECRET_BODY }]);
    expect(report.total.updated).toBe(1);
  });

  it('para se a leitura trouxer outra org', async () => {
    const db: FillBodyTextDb = {
      listCandidates: async () => [row({ org_id: OTHER })],
      updateBodyText: vi.fn(),
    };
    await expect(runFillBodyText({ argv: ['--org', V4, '--apply'], db, log: () => {} })).rejects.toThrow(/outra org/);
    expect(db.updateBodyText).not.toHaveBeenCalled();
  });
});
