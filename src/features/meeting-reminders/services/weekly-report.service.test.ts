import { describe, expect, it } from 'vitest';

import { computeReport, contextOf, renderReportHtml } from './weekly-report.service';

const NOW = new Date('2026-07-23T12:00:00.000Z');
const WEEK_START = new Date('2026-07-16T12:00:00.000Z');

function baseMeetings() {
  return [
    // Semana + exposto + realizada (inbound, s1)
    { lead_id: 'A', assigned_to: 's1', lead_source: 'Blackbox', meeting_starts_at: '2026-07-20T14:00:00.000Z', held: true },
    // Semana + exposto + no-show (inbound, s1)
    { lead_id: 'B', assigned_to: 's1', lead_source: 'Blackbox', meeting_starts_at: '2026-07-18T14:00:00.000Z', held: false },
    // Fora da semana + não exposto + realizada (outbound, s2)
    { lead_id: 'C', assigned_to: 's2', lead_source: 'Outbound', meeting_starts_at: '2026-07-12T14:00:00.000Z', held: true },
    // Fora da semana + não exposto + no-show (outbound, s2)
    { lead_id: 'D', assigned_to: 's2', lead_source: 'Outbound', meeting_starts_at: '2026-07-11T14:00:00.000Z', held: false },
  ];
}

describe('contextOf', () => {
  it('mapeia origem para contexto', () => {
    expect(contextOf('Blackbox')).toBe('inbound');
    expect(contextOf('Leadbroker')).toBe('inbound');
    expect(contextOf('Outbound')).toBe('outbound');
    expect(contextOf(null)).toBe('outro');
    expect(contextOf('Desconhecida')).toBe('outro');
  });
});

describe('computeReport', () => {
  const report = computeReport({
    orgName: 'V4 Amaral',
    meetings: baseMeetings(),
    sentLeadIds: new Set(['A', 'B']),
    sends: [
      { status: 'sent', detail: null },
      { status: 'sent', detail: null },
      { status: 'skipped', detail: 'sdr_sem_gmail' },
      { status: 'failed', detail: 'bounce' },
    ],
    sdrNames: new Map([
      ['s1', 'Ismael'],
      ['s2', 'Matheus'],
    ]),
    weekStart: WEEK_START,
    now: NOW,
  });

  it('acumula overall com/sem lembrete', () => {
    expect(report.cumulativeOverall.all).toEqual({ total: 4, held: 2 });
    expect(report.cumulativeOverall.com).toEqual({ total: 2, held: 1 });
    expect(report.cumulativeOverall.sem).toEqual({ total: 2, held: 1 });
  });

  it('conta a semana apenas com reuniões na janela', () => {
    expect(report.weekOverall.all).toEqual({ total: 2, held: 1 });
    expect(report.weekOverall.com).toEqual({ total: 2, held: 1 });
    expect(report.weekOverall.sem).toEqual({ total: 0, held: 0 });
  });

  it('quebra por SDR usando o nome resolvido', () => {
    const ismael = report.bySdr.find((r) => r.label === 'Ismael');
    const matheus = report.bySdr.find((r) => r.label === 'Matheus');
    expect(ismael?.rates.com).toEqual({ total: 2, held: 1 });
    expect(matheus?.rates.sem).toEqual({ total: 2, held: 1 });
  });

  it('quebra por origem inbound/outbound', () => {
    const inbound = report.byContext.find((r) => r.label === 'inbound');
    const outbound = report.byContext.find((r) => r.label === 'outbound');
    expect(inbound?.rates.all).toEqual({ total: 2, held: 1 });
    expect(outbound?.rates.all).toEqual({ total: 2, held: 1 });
  });

  it('resume envios por status com ocorrências de skip/fail', () => {
    expect(report.sends.sent).toBe(2);
    expect(report.sends.skipped).toBe(1);
    expect(report.sends.failed).toBe(1);
    expect(report.sends.issues).toHaveLength(2);
    expect(report.sends.issues.map((i) => i.label)).toContain('skipped: sdr_sem_gmail');
    expect(report.sends.issues.map((i) => i.label)).toContain('failed: bounce');
  });

  it('cai para responsável vazio quando assigned_to é null', () => {
    const r = computeReport({
      orgName: 'Org',
      meetings: [{ lead_id: 'X', assigned_to: null, lead_source: 'Blackbox', meeting_starts_at: '2026-07-20T14:00:00.000Z', held: true }],
      sentLeadIds: new Set(),
      sends: [],
      sdrNames: new Map(),
      weekStart: WEEK_START,
      now: NOW,
    });
    expect(r.bySdr[0]?.label).toBe('(sem responsável)');
  });
});

describe('renderReportHtml', () => {
  const report = computeReport({
    orgName: 'V4 Amaral',
    meetings: baseMeetings(),
    sentLeadIds: new Set(['A', 'B']),
    sends: [{ status: 'sent', detail: null }],
    sdrNames: new Map([
      ['s1', 'Ismael'],
      ['s2', 'Matheus'],
    ]),
    weekStart: WEEK_START,
    now: NOW,
  });
  const html = renderReportHtml(report);

  it('inclui as três colunas de coorte', () => {
    expect(html).toContain('COM lembrete');
    expect(html).toContain('SEM lembrete');
  });

  it('mostra a taxa formatada em pt-BR e os nomes dos SDRs', () => {
    expect(html).toContain('50,0%');
    expect(html).toContain('Ismael');
    expect(html).toContain('Matheus');
  });

  it('sinaliza amostra pequena (n<30)', () => {
    expect(html).toContain('n&lt;30');
  });

  it('escapa o nome da org', () => {
    const evil = renderReportHtml({ ...report, orgName: '<script>x</script>' });
    expect(evil).not.toContain('<script>x</script>');
    expect(evil).toContain('&lt;script&gt;');
  });
});
