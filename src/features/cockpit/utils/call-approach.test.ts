import { describe, expect, it } from 'vitest';

import type { CallContext } from '../types';

import { relativeTimePt, suggestApproach, summarizeContext } from './call-approach';

const base = (over: Partial<CallContext> = {}): CallContext => ({
  leadId: 'l1',
  whyNow: { code: 'no_signal', label: 'Sem sinal recente' },
  company: { name: 'Acme', cnpj: null, segmento: null, porte: null, status: 'new' },
  decisionMaker: { name: 'Ana Souza', jobTitle: 'Diretora', email: null, phone: '11999990000', partners: [] },
  signals: [],
  interactions: [],
  interactionsPage: { page: 1, perPage: 5, total: 0, hasMore: false },
  calls: [],
  callsPage: { page: 1, perPage: 5, total: 0, hasMore: false },
  objections: null,
  scores: { fit: null, engagement: null },
  missing: ['objections'],
  ...over,
});

describe('suggestApproach v0', () => {
  it.each([
    ['replied', 'Retomar a conversa iniciada pelo lead'],
    ['callback_requested', 'Retornar como combinado'],
    ['meeting_no_show', 'Reagendar a reunião não realizada'],
    ['engaged', 'Aproveitar o interesse recente'],
    ['no_signal', 'Primeira abordagem curta'],
  ] as const)('escolhe a abordagem para %s', (code, headline) => {
    const a = suggestApproach(base({ whyNow: { code, label: 'x' } }));
    expect(a.version).toBe('v0');
    expect(a.headline).toBe(headline);
  });

  it('é determinística', () => {
    const ctx = base({ whyNow: { code: 'replied', label: 'x' }, signals: [{ kind: 'replied', source: 'email', at: '2026-11-06T10:00:00Z' }] });
    expect(suggestApproach(ctx)).toEqual(suggestApproach(ctx));
    expect(suggestApproach(ctx).opening).toContain('e-mail');
  });

  it('objeções null orienta a perguntar, sem inventar', () => {
    expect(suggestApproach(base()).points.join(' ')).toContain('Sem dados de objeções');
  });

  it('usa objeções registradas quando existem', () => {
    expect(suggestApproach(base({ objections: ['preço'] })).points).toContain('Objeções já registradas: preço');
  });

  it('pede confirmação do decisor sem nome', () => {
    const ctx = base({ decisionMaker: { name: null, jobTitle: null, email: null, phone: null, partners: [] } });
    const a = suggestApproach(ctx);
    expect(a.opening).toContain('o responsável');
    expect(a.points).toContain('Sem nome do contato: confirme quem decide');
  });

  it('retoma a última ligação e avisa de duas não conectadas', () => {
    const call = { id: 'c', at: '2026-11-01T10:00:00Z', durationSeconds: 0, connected: false, status: 'x', outcome: null };
    const a = suggestApproach(base({ calls: [{ ...call, summary: 'Pediu proposta' }, { ...call, id: 'c2', summary: null }] }));
    expect(a.points).toContain('Retome o que ficou da última ligação: Pediu proposta');
    expect(a.points).toContain('As duas últimas ligações não conectaram, tente outro horário');
  });

  it('inclui segmento e fit alto', () => {
    const a = suggestApproach(base({ company: { name: 'Acme', cnpj: null, segmento: 'Software', porte: null, status: 'new' }, scores: { fit: 85, engagement: null } }));
    expect(a.points).toContain('Segmento: Software');
    expect(a.points).toContain('Bom encaixe com o perfil ideal (fit 85)');
  });

  it('não usa travessões', () => {
    const a = suggestApproach(base({ whyNow: { code: 'engaged', label: 'x' } }));
    expect(JSON.stringify(a)).not.toMatch(/[—–]/);
  });
});

describe('relativeTimePt e summarizeContext', () => {
  const now = new Date('2026-11-07T12:00:00Z');
  it('formata tempo relativo', () => {
    expect(relativeTimePt('2026-11-07T11:59:30Z', now)).toBe('agora');
    expect(relativeTimePt('2026-11-07T11:00:00Z', now)).toBe('há 1 hora');
    expect(relativeTimePt('2026-11-05T12:00:00Z', now)).toBe('há 2 dias');
  });
  it('resumo é null sem dados', () => {
    expect(summarizeContext(base())).toBeNull();
  });
});
