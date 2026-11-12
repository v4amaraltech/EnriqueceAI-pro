import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CRM_AUTO_UPDATE_MIN_CONFIDENCE } from './constants';
import {
  type CrmDecisionInput,
  decideCrmAutoUpdate,
  mapOutcomeToDisposition,
  proposeLeadStatus,
  resolveCrmAutoUpdateMode,
} from './decision';

const V4_AMARAL = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';

function input(over: {
  mode?: CrmDecisionInput['mode'];
  qualification?: Partial<CrmDecisionInput['qualification']>;
  call?: Partial<CrmDecisionInput['call']>;
  lead?: CrmDecisionInput['lead'];
  transcript_text?: string | null;
  qualification_summary?: string | null;
} = {}): CrmDecisionInput {
  return {
    mode: over.mode ?? 'shadow',
    qualification: {
      status: 'completed',
      outcome: 'callback',
      next_step_suggestion: 'callback',
      confidence: 0.9,
      needs_review: false,
      ...over.qualification,
    },
    call: {
      lead_id: 'lead-1',
      sdr_disposition: null,
      legacy_ai_outcome_applied: false,
      ...over.call,
    },
    lead: over.lead === undefined ? { status: 'new' } : over.lead,
    transcript_text: over.transcript_text === undefined ? 'Olá, pode me ligar amanhã?' : over.transcript_text,
    qualification_summary: over.qualification_summary ?? null,
  };
}

describe('decideCrmAutoUpdate', () => {
  it('not_connected sem prompt de caixa postal: voicemail, nunca atendeu sem avanço', () => {
    const d = decideCrmAutoUpdate(
      input({
        qualification: { outcome: 'not_connected', next_step_suggestion: 'not_connected' },
        transcript_text: 'Alô? Alô? Ninguém responde.',
      }),
    );
    expect(d.verdict).toBe('would_apply');
    expect(d.proposed).toEqual({
      disposition: 'voicemail',
      next_activity: { type: 'retry', channel: 'phone' },
      lead_status: null,
    });
  });

  it('regressão 3e597c42: URA "essa pessoa não está disponível" vira voicemail', () => {
    const transcript =
      'Se você disser seu nome e o motivo da ligação, poderei ver se esta pessoa está disponível. ' +
      'Oi, aqui é o Fulano da V4. Essa pessoa não está disponível.';
    const d = decideCrmAutoUpdate(
      input({
        qualification: { outcome: 'not_connected', next_step_suggestion: 'not_connected', confidence: 0.84 },
        transcript_text: transcript,
      }),
    );
    expect(d.verdict).toBe('would_apply');
    expect(d.proposed?.disposition).toBe('voicemail');
    expect(d.proposed?.disposition).not.toBe('answered_no_progress');
    expect(d.proposed?.next_activity).toEqual({ type: 'retry', channel: 'phone' });
    expect(d.opt_out.requested).toBe(false);

    // O caso real foi skip só por no_lead; a disposition continua certa.
    const noLead = decideCrmAutoUpdate(
      input({
        qualification: { outcome: 'not_connected', next_step_suggestion: 'not_connected', confidence: 0.84 },
        call: { lead_id: null },
        lead: null,
        transcript_text: transcript,
      }),
    );
    expect(noLead.skip_reason).toBe('no_lead');
    expect(noLead.proposed?.disposition).toBe('voicemail');
  });

  it('not_connected com transcrição vazia ou nula: nunca atendeu sem avanço', () => {
    for (const transcript_text of [null, '', '   ']) {
      const d = decideCrmAutoUpdate(
        input({
          qualification: { outcome: 'not_connected', next_step_suggestion: 'not_connected' },
          transcript_text,
        }),
      );
      expect(d.proposed?.disposition).toBe('voicemail');
      expect(d.proposed?.next_activity.type).toBe('retry');
    }
  });

  it('desfecho voicemail: voicemail e nova tentativa', () => {
    const d = decideCrmAutoUpdate(input({ qualification: { outcome: 'voicemail', next_step_suggestion: 'none' } }));
    expect(d.proposed).toEqual({
      disposition: 'voicemail',
      next_activity: { type: 'retry', channel: 'phone' },
      lead_status: null,
    });
  });

  it('caixa postal: disposition voicemail e nova tentativa pela cadência', () => {
    const d = decideCrmAutoUpdate(
      input({
        qualification: { outcome: 'not_connected', next_step_suggestion: 'not_connected' },
        transcript_text: 'Sua chamada está sendo encaminhada para a caixa postal. Deixe sua mensagem após o sinal.',
      }),
    );
    expect(d.verdict).toBe('would_apply');
    expect(d.proposed?.disposition).toBe('voicemail');
    expect(d.proposed?.next_activity.type).toBe('retry');
    expect(d.proposed?.lead_status).toBeNull();
  });

  it('conectou e marcou reunião: conversa relevante, reunião e lead qualificado', () => {
    const d = decideCrmAutoUpdate(
      input({ qualification: { outcome: 'meeting_booked', next_step_suggestion: 'meeting' } }),
    );
    expect(d.verdict).toBe('would_apply');
    expect(d.proposed).toEqual({
      disposition: 'relevant_conversation',
      next_activity: { type: 'meeting', channel: null },
      lead_status: { from: 'new', to: 'qualified' },
    });
  });

  it('conectou e pediu retorno: callback_requested, retorno por telefone, lead contatado', () => {
    const d = decideCrmAutoUpdate(input());
    expect(d.verdict).toBe('would_apply');
    expect(d.proposed).toEqual({
      disposition: 'callback_requested',
      next_activity: { type: 'callback', channel: 'phone' },
      lead_status: { from: 'new', to: 'contacted' },
    });
  });

  it('needs_review: nunca aplica, mas guarda a proposta para comparação', () => {
    const d = decideCrmAutoUpdate(input({ qualification: { needs_review: true, confidence: 0.99 } }));
    expect(d.verdict).toBe('skip');
    expect(d.skip_reason).toBe('needs_review');
    expect(d.proposed?.disposition).toBe('callback_requested');
  });

  it('SDR já registrou: não sobrescreve', () => {
    const d = decideCrmAutoUpdate(input({ call: { sdr_disposition: 'relevant_conversation' } }));
    expect(d.verdict).toBe('skip');
    expect(d.skip_reason).toBe('already_dispositioned');
    expect(d.proposed?.disposition).toBe('callback_requested');
  });

  it('fluxo antigo do Power Dialer já aplicou: também conta como registrado', () => {
    const d = decideCrmAutoUpdate(input({ call: { legacy_ai_outcome_applied: true } }));
    expect(d.skip_reason).toBe('already_dispositioned');
  });

  it('confiança baixa ou ausente: skip low_confidence', () => {
    expect(
      decideCrmAutoUpdate(input({ qualification: { confidence: CRM_AUTO_UPDATE_MIN_CONFIDENCE - 0.01 } })).skip_reason,
    ).toBe('low_confidence');
    expect(decideCrmAutoUpdate(input({ qualification: { confidence: null } })).skip_reason).toBe('low_confidence');
    expect(
      decideCrmAutoUpdate(input({ qualification: { confidence: CRM_AUTO_UPDATE_MIN_CONFIDENCE } })).verdict,
    ).toBe('would_apply');
  });

  it('needs_review vence o SDR já registrado (motivo mais forte primeiro)', () => {
    const d = decideCrmAutoUpdate(
      input({ qualification: { needs_review: true }, call: { sdr_disposition: 'voicemail' } }),
    );
    expect(d.skip_reason).toBe('needs_review');
  });

  it('modo off: org_not_allowed', () => {
    expect(decideCrmAutoUpdate(input({ mode: 'off' })).skip_reason).toBe('org_not_allowed');
  });

  it('qualificação não concluída: sem proposta', () => {
    const d = decideCrmAutoUpdate(input({ qualification: { status: 'failed' } }));
    expect(d.skip_reason).toBe('qualification_not_completed');
    expect(d.proposed).toBeNull();
  });

  it('desfecho other: unmapped_outcome sem proposta', () => {
    const d = decideCrmAutoUpdate(input({ qualification: { outcome: 'other', next_step_suggestion: 'none' } }));
    expect(d.skip_reason).toBe('unmapped_outcome');
    expect(d.proposed).toBeNull();
  });

  it('ligação sem lead: no_lead', () => {
    const d = decideCrmAutoUpdate(input({ call: { lead_id: null }, lead: null }));
    expect(d.skip_reason).toBe('no_lead');
    expect(d.proposed?.lead_status).toBeNull();
  });

  it('não interessado sem opt-out: mapeamento de hoje e pode aplicar com confiança alta', () => {
    const d = decideCrmAutoUpdate(
      input({
        qualification: { outcome: 'not_interested', next_step_suggestion: 'none', confidence: 0.9 },
        transcript_text: 'Não tenho interesse, obrigado. Agora não, estamos sem orçamento.',
      }),
    );
    expect(d.verdict).toBe('would_apply');
    expect(d.skip_reason).toBeNull();
    expect(d.opt_out.requested).toBe(false);
    expect(d.proposed).toEqual({
      disposition: 'answered_no_progress',
      next_activity: { type: 'none', channel: null },
      lead_status: { from: 'new', to: 'contacted' },
    });
  });

  it('opt-out 2482208d: "tira meu e-mail, elimina meu telefone" vira skip opt_out_requested', () => {
    const d = decideCrmAutoUpdate(
      input({
        qualification: { outcome: 'not_interested', next_step_suggestion: 'none', confidence: 0.91 },
        transcript_text:
          'Não, não tenho interesse. Olha, faz um favor, tira meu e-mail, elimina meu telefone, não quero mais isso.',
      }),
    );
    expect(d.verdict).toBe('skip');
    expect(d.skip_reason).toBe('opt_out_requested');
    expect(d.opt_out).toEqual({
      requested: true,
      channels: ['email', 'phone'],
      patterns: ['remove_contact'],
    });
    // A proposta segue calculada para comparação, mas nunca é aplicada.
    expect(d.proposed?.disposition).toBe('answered_no_progress');
  });

  it('opt-out edbbed96: pedido para apagar contato e WhatsApp vira skip opt_out_requested', () => {
    const d = decideCrmAutoUpdate(
      input({
        qualification: { outcome: 'not_interested', next_step_suggestion: 'none', confidence: 0.85 },
        transcript_text:
          'Eu já falei que não. Pode apagar o meu contato aí, e me apaga do seu WhatsApp também, tá bom? Obrigado.',
      }),
    );
    expect(d.verdict).toBe('skip');
    expect(d.skip_reason).toBe('opt_out_requested');
    expect(d.opt_out.requested).toBe(true);
    expect(d.opt_out.channels).toEqual(['whatsapp', 'list']);
  });

  it('opt-out vence needs_review, SDR já registrado e ligação sem lead (para ser contado)', () => {
    const text = 'Por favor me tira da lista de vocês.';
    expect(decideCrmAutoUpdate(input({ qualification: { needs_review: true }, transcript_text: text })).skip_reason).toBe(
      'opt_out_requested',
    );
    expect(decideCrmAutoUpdate(input({ call: { sdr_disposition: 'voicemail' }, transcript_text: text })).skip_reason).toBe(
      'opt_out_requested',
    );
    expect(decideCrmAutoUpdate(input({ call: { lead_id: null }, lead: null, transcript_text: text })).skip_reason).toBe(
      'opt_out_requested',
    );
    // org fora do shadow continua org_not_allowed.
    expect(decideCrmAutoUpdate(input({ mode: 'off', transcript_text: text })).skip_reason).toBe('org_not_allowed');
  });

  it('opt-out também é lido no resumo da qualificação', () => {
    const d = decideCrmAutoUpdate(
      input({
        qualification: { outcome: 'not_interested', next_step_suggestion: 'none' },
        transcript_text: 'Não, obrigado.',
        qualification_summary: 'Lead pediu para remover o telefone da base.',
      }),
    );
    expect(d.skip_reason).toBe('opt_out_requested');
    expect(d.opt_out.channels).toContain('phone');
  });
});

describe('proposeLeadStatus', () => {
  it('nunca regride nem mexe em lead fechado', () => {
    expect(proposeLeadStatus('meeting_booked', 'qualified')).toBeNull();
    expect(proposeLeadStatus('meeting_booked', 'won')).toBeNull();
    expect(proposeLeadStatus('callback', 'unqualified')).toBeNull();
    expect(proposeLeadStatus('callback', 'archived')).toBeNull();
    expect(proposeLeadStatus('callback', 'contacted')).toBeNull();
    expect(proposeLeadStatus('not_connected', 'new')).toBeNull();
    expect(proposeLeadStatus('meeting_booked', 'contacted')).toEqual({ from: 'contacted', to: 'qualified' });
  });
});

describe('mapOutcomeToDisposition', () => {
  it('cobre os desfechos do JEV', () => {
    expect(mapOutcomeToDisposition('interested_no_next_step')).toBe('relevant_conversation');
    expect(mapOutcomeToDisposition('other')).toBeNull();
    expect(mapOutcomeToDisposition(null)).toBeNull();
  });

  it('not_connected e voicemail nunca viram answered_no_progress', () => {
    expect(mapOutcomeToDisposition('not_connected')).toBe('voicemail');
    expect(mapOutcomeToDisposition('voicemail')).toBe('voicemail');
  });
});

describe('resolveCrmAutoUpdateMode', () => {
  const off = { enabled: false, allow_org_ids: [], allow_user_ids: [] };
  const shadowV4 = { enabled: false, allow_org_ids: [V4_AMARAL], allow_user_ids: [] };

  it('padrão da migration (tudo desligado): off', () => {
    expect(resolveCrmAutoUpdateMode(off, off, V4_AMARAL)).toBe('off');
    expect(resolveCrmAutoUpdateMode(null, null, V4_AMARAL)).toBe('off');
  });

  it('V4 em allow_org_ids da flag shadow: shadow; outra org continua off', () => {
    expect(resolveCrmAutoUpdateMode(shadowV4, off, V4_AMARAL)).toBe('shadow');
    expect(resolveCrmAutoUpdateMode(shadowV4, off, 'outra-org')).toBe('off');
  });

  it('live exige a org listada nas duas flags; enabled global na live é ignorado', () => {
    expect(resolveCrmAutoUpdateMode(shadowV4, { ...off, enabled: true }, V4_AMARAL)).toBe('shadow');
    expect(resolveCrmAutoUpdateMode(shadowV4, { ...off, allow_org_ids: [V4_AMARAL] }, V4_AMARAL)).toBe('live');
    expect(resolveCrmAutoUpdateMode(off, { ...off, allow_org_ids: [V4_AMARAL] }, V4_AMARAL)).toBe('off');
  });
});

describe('migration crm_auto_update_shadow', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20261111200000_crm_auto_update_shadow.sql'),
    'utf8',
  );

  it('cria as duas flags desligadas e com listas vazias', () => {
    expect(sql).toMatch(/'crm_auto_update_v1',\s*false,\s*'[^']*',\s*'\{\}',\s*'\{\}'/);
    expect(sql).toMatch(/'crm_auto_update_v1_live',\s*false,\s*'[^']*',\s*'\{\}',\s*'\{\}'/);
    expect(sql).not.toContain(V4_AMARAL);
  });

  it('é aditiva: não altera nem apaga dados existentes', () => {
    expect(sql).not.toMatch(/\bUPDATE\s+public\.(calls|leads|scheduled_activities|interactions|call_qualifications)\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+public\.(calls|leads|scheduled_activities|interactions|call_qualifications|call_transcripts_v2)\b/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
  });

  it('log é idempotente por ligação, append-only e com RLS', () => {
    expect(sql).toContain('UNIQUE (call_id)');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.crm_auto_update_shadow_log');
    expect(sql).toContain('ALTER TABLE public.crm_auto_update_shadow_log ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('public.user_org_id()');
    expect(sql).not.toMatch(/GRANT[^;]*(UPDATE|DELETE)[^;]*crm_auto_update_shadow_log/);
  });
});

describe('migration crm_auto_update_shadow_opt_out (v1.1)', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20261112120000_crm_auto_update_shadow_opt_out.sql'),
    'utf8',
  );

  it('amplia o CHECK de skip_reason com opt_out_requested mantendo os motivos antigos', () => {
    expect(sql).toContain("'opt_out_requested'");
    for (const reason of [
      'org_not_allowed',
      'qualification_not_completed',
      'needs_review',
      'low_confidence',
      'unmapped_outcome',
      'already_dispositioned',
      'no_lead',
    ]) {
      expect(sql).toContain(`'${reason}'`);
    }
    expect(sql).toContain("conname <> 'crm_auto_update_shadow_log_verdict_reason'");
  });

  it('acrescenta skipped_opt_out_requested no fim da view diária', () => {
    expect(sql).toMatch(/AS next_activity_agreement_rate,[\s\S]*AS skipped_opt_out_requested\s+FROM public\.crm_auto_update_shadow_comparison/);
    expect(sql).not.toMatch(/CREATE OR REPLACE VIEW public\.crm_auto_update_shadow_comparison/);
  });

  it('é aditiva e não mexe em dados nem em outras tabelas', () => {
    expect(sql).not.toMatch(/\bUPDATE\s+public\./i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|VIEW|TRIGGER)\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+public\.(calls|leads|scheduled_activities|interactions|call_qualifications|call_transcripts_v2|app_flags)\b/i);
    expect(sql).not.toMatch(/app_flags/);
  });
});
