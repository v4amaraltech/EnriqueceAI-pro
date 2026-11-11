import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FIXTURE_ACTIVITY } from '@/app/demo/call-workspace/fixture';
import { evaluateFlagRow } from '@/features/contact-engine/services/flag-scope.service';

import { CALL_LEAD_CARD_FLAG, CALL_LEAD_CARD_ORG_ID } from '../services/call-lead-card-flag';
import { contrastRatio, LEAD_CARD_TEXT_PAIRS } from './lead-card-colors';
import {
  buildLeadCard,
  formatLostAgo,
  leadCardFromActivity,
  leadTemperatureLabel,
  openingLine,
  openingTemplates,
  type LeadCardInput,
} from './lead-card';

const NOW = new Date('2026-11-11T15:00:00.000Z');
const MONTH_MS = 30.4375 * 24 * 60 * 60 * 1000;

function input(partial: Partial<LeadCardInput> = {}): LeadCardInput {
  return {
    firstName: 'Contato',
    lastName: 'Fixture',
    nomeFantasia: 'Empresa Fixture',
    razaoSocial: 'Empresa Fixture Ltda',
    telefone: '+5511900000000',
    phones: [{ numero: '1130000000' }],
    jobTitle: 'Coordenador',
    segmento: 'Indústria',
    cnpj: '00000000000191',
    email: 'contato.fixture@example.com',
    leadSource: 'Blackbox',
    canal: 'Google',
    lostAt: '2026-04-17T10:22:48.000Z',
    lossReasonName: 'Deixou de responder',
    lossNotes: 'Cadência concluída sem resposta',
    enrollmentLossNotes: 'nota que não deve vencer',
    previousSdrName: null,
    stepOrder: 3,
    totalSteps: 3,
    now: NOW,
    ...partial,
  };
}

function field(model: ReturnType<typeof buildLeadCard>, id: string) {
  return model.fields.find((item) => item.id === id);
}

describe('cartão do lead', () => {
  it('mapeia os campos e esconde o que não tem dado', () => {
    const model = buildLeadCard(input({
      nomeFantasia: null,
      telefone: null,
      jobTitle: '  ',
      previousSdrName: null,
    }));

    expect(model.name).toBe('Contato Fixture');
    expect(model.company).toBe('Empresa Fixture Ltda');
    expect(model.attemptLabel).toBe('TENTATIVA 3/3');
    expect(field(model, 'telefone')?.value).toBe('1130000000');
    expect(field(model, 'cargo')).toBeUndefined();
    expect(field(model, 'segmento')?.value).toBe('Indústria');
    expect(field(model, 'cnpj')?.value).toBe('00.000.000/0001-91');
    expect(field(model, 'email')?.value).toBe('contato.fixture@example.com');
    expect(field(model, 'origem')?.value).toBe('Blackbox / Google');
    expect(field(model, 'temperatura')?.value).toBe('perdido há 6,8 meses');
    expect(field(model, 'sdr')).toBeUndefined();
    expect(field(model, 'motivo')?.value).toBe('Deixou de responder');
    expect(field(model, 'notas')).toMatchObject({ value: 'Cadência concluída sem resposta', fullWidth: true });
    expect(model.opening).toBe(
      'Contato, parece que a conversa com a V4 ficou parada no meio do caminho. Seria um problema retomarmos em 2 minutos?',
    );
  });

  it('CNPJ vazio vira hífen e a nota da cadência cobre a nota vazia do lead', () => {
    const model = buildLeadCard(input({ cnpj: '   ', lossNotes: '  ', enrollmentLossNotes: 'Nota da cadência' }));
    expect(field(model, 'cnpj')?.value).toBe('-');
    expect(field(model, 'notas')?.value).toBe('Nota da cadência');
  });

  it('não inventa SDR antigo a partir da atividade', () => {
    const model = leadCardFromActivity(FIXTURE_ACTIVITY, 'contato.fixture@example.com', NOW);
    expect(field(model, 'sdr')).toBeUndefined();
    expect(leadTemperatureLabel()).toBeNull();
  });

  it('mostra SDR antigo só quando o nome já veio pronto', () => {
    const model = buildLeadCard(input({ previousSdrName: 'Matheus Martins' }));
    expect(field(model, 'sdr')?.value).toBe('Matheus Martins');
  });

  it('formata o tempo de perda e omite data inválida ou futura', () => {
    expect(formatLostAgo(new Date(NOW.getTime() - MONTH_MS).toISOString(), NOW)).toBe('perdido há 1 mês');
    expect(formatLostAgo(new Date(NOW.getTime() - 2 * MONTH_MS).toISOString(), NOW)).toBe('perdido há 2 meses');
    expect(formatLostAgo(new Date(NOW.getTime() + MONTH_MS).toISOString(), NOW)).toBeNull();
    expect(formatLostAgo('nao-e-data', NOW)).toBeNull();
    expect(formatLostAgo(null, NOW)).toBeNull();
    expect(formatLostAgo('2026-04-17T10:22:48.000Z', NOW)).toBe('perdido há 6,8 meses');
  });

  it('escolhe a abertura pelo motivo e não usa travessão', () => {
    expect(openingLine('Deixou de responder', 'Willian')).toBe(
      'Willian, parece que a conversa com a V4 ficou parada no meio do caminho. Seria um problema retomarmos em 2 minutos?',
    );
    expect(openingLine('  Nunca   Respondeu ', 'Ana')).toContain('Ana, a gente tentou falar');
    expect(openingLine('Não ICP', null)).toMatch(/^A gente entendeu/);
    expect(openingLine('Blocklist', 'Ana')).toBeNull();
    expect(openingLine('SPAM', 'Ana')).toBeNull();
    expect(openingLine('Adolescente/Criança', 'Ana')).toBeNull();
    expect(openingLine('Motivo que não existe', 'Ana')).toBeNull();
    for (const line of [...openingTemplates(), openingLine('Deixou de responder', 'Willian') ?? '']) {
      expect(line).not.toMatch(/[—–]/);
    }
  });

  it('a flag nasce desligada e só liga a V4 Company Amaral', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261111120000_call_lead_card_flag.sql'), 'utf8');
    expect(sql).toContain(`'${CALL_LEAD_CARD_FLAG}'`);
    expect(sql).toMatch(/'call_lead_card_v1',\s*false,/);
    expect(sql).not.toMatch(/'call_lead_card_v1',\s*true,/);
    expect(sql).toContain(CALL_LEAD_CARD_ORG_ID);
    expect(sql).toContain('ON CONFLICT (key) DO NOTHING');
    expect(sql).not.toMatch(/lead_channel_chat|lead_messages/);
    expect(sql.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)).toEqual([CALL_LEAD_CARD_ORG_ID]);

    const row = { enabled: false, allow_org_ids: [CALL_LEAD_CARD_ORG_ID], allow_user_ids: [] as string[] };
    expect(row.enabled).toBe(false);
    expect(evaluateFlagRow(row, { orgId: CALL_LEAD_CARD_ORG_ID })).toBe(true);
    expect(evaluateFlagRow(row, { orgId: '11111111-1111-4111-8111-111111111111' })).toBe(false);
    expect(evaluateFlagRow(row)).toBe(false);
  });

  it('o texto do cartão passa contraste AA nos dois temas', () => {
    for (const pair of LEAD_CARD_TEXT_PAIRS) {
      expect(contrastRatio(pair.foreground, pair.background), pair.name).toBeGreaterThanOrEqual(4.5);
    }
  });
});
