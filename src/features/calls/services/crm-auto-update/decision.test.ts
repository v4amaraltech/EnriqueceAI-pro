import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CRM_AUTO_UPDATE_LIVE_VOICEMAIL_MIN_CONFIDENCE, CRM_AUTO_UPDATE_MIN_CONFIDENCE } from './constants';
import {
  type CrmDecisionInput,
  decideCrmAutoUpdate,
  mapOutcomeToDisposition,
  proposeLeadStatus,
  resolveCrmAutoUpdateMode,
  shouldApplyLiveVoicemail,
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

describe('shouldApplyLiveVoicemail', () => {
  const live = (over: Partial<Parameters<typeof shouldApplyLiveVoicemail>[0]> = {}) =>
    shouldApplyLiveVoicemail({
      mode: 'live',
      decision: { verdict: 'would_apply' },
      outcome: 'voicemail',
      confidence: 0.85,
      ...over,
    });

  it('corte da escrita é 0,85 inclusive e não mexe no 0,75 do would_apply', () => {
    expect(CRM_AUTO_UPDATE_LIVE_VOICEMAIL_MIN_CONFIDENCE).toBe(0.85);
    expect(CRM_AUTO_UPDATE_MIN_CONFIDENCE).toBe(0.75);
    expect(live({ confidence: 0.85 })).toBe(true);
    expect(live({ confidence: 0.99 })).toBe(true);
    expect(live({ confidence: 0.84 })).toBe(false);
    expect(live({ confidence: 0.8499 })).toBe(false);
    expect(live({ confidence: null })).toBe(false);
    expect(live({ confidence: Number.NaN })).toBe(false);
  });

  it('só o outcome JEV exato voicemail: not_connected (que também propõe voicemail) fica de fora', () => {
    expect(live({ outcome: 'not_connected', confidence: 0.99 })).toBe(false);
    expect(live({ outcome: 'meeting_booked', confidence: 0.99 })).toBe(false);
    expect(live({ outcome: 'callback', confidence: 0.99 })).toBe(false);
    expect(live({ outcome: 'not_interested', confidence: 0.99 })).toBe(false);
    expect(live({ outcome: 'Voicemail' })).toBe(false);
    expect(live({ outcome: null })).toBe(false);
  });

  it('só em live e só com would_apply', () => {
    expect(live({ mode: 'shadow', confidence: 0.99 })).toBe(false);
    expect(live({ mode: 'off', confidence: 0.99 })).toBe(false);
    expect(live({ decision: { verdict: 'skip' }, confidence: 0.99 })).toBe(false);
  });

  it('integra com a decisão: SDR já registrado, opt-out e needs_review nunca escrevem', () => {
    const vm = { outcome: 'voicemail', next_step_suggestion: 'retry', confidence: 0.99 };
    const cases = [
      input({ mode: 'live', qualification: vm, call: { sdr_disposition: 'no_answer' } }),
      input({ mode: 'live', qualification: { ...vm, needs_review: true } }),
      input({ mode: 'live', qualification: vm, transcript_text: 'Tira meu telefone da lista.' }),
      input({ mode: 'live', qualification: vm, call: { lead_id: null } }),
    ];
    for (const c of cases) {
      const decision = decideCrmAutoUpdate(c);
      expect(decision.verdict).toBe('skip');
      expect(shouldApplyLiveVoicemail({ mode: 'live', decision, outcome: 'voicemail', confidence: 0.99 })).toBe(false);
    }
    const ok = decideCrmAutoUpdate(input({ mode: 'live', qualification: vm }));
    expect(ok.verdict).toBe('would_apply');
    expect(ok.proposed).toEqual({
      disposition: 'voicemail',
      next_activity: { type: 'retry', channel: 'phone' },
      lead_status: null,
    });
  });
});

describe('migration crm_auto_update_live_voicemail', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20261112200000_crm_auto_update_live_voicemail.sql'),
    'utf8',
  );

  it('acrescenta applied/applied_at com CHECK amarrado a live + would_apply', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS applied boolean NOT NULL DEFAULT false');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS applied_at timestamptz');
    expect(sql).toMatch(/\(applied = false AND applied_at IS NULL\)/);
    expect(sql).toMatch(/applied = true AND applied_at IS NOT NULL AND mode = 'live' AND verdict = 'would_apply'/);
  });

  it('a nossa escrita vira auto_applied antes de agree/disagree nas três comparações', () => {
    const body = sql.slice(sql.indexOf('CREATE OR REPLACE VIEW public.crm_auto_update_shadow_comparison'));
    const cases = body.match(/CASE\s+WHEN g\.proposed_[a-z_]+ IS NULL THEN 'no_proposal'[\s\S]*?END AS [a-z_]+_comparison/g) ?? [];
    expect(cases).toHaveLength(3);
    for (const c of cases) {
      expect(c.indexOf("'auto_applied'")).toBeGreaterThan(-1);
      expect(c.indexOf("'auto_applied'")).toBeLessThan(c.indexOf("'pending_sdr'"));
      expect(c.indexOf("'auto_applied'")).toBeLessThan(c.indexOf("'agree'"));
      expect(c).toContain("'legacy_ai'");
    }
  });

  it('colunas novas só no fim das views, preservando skipped_opt_out_requested', () => {
    expect(sql).toMatch(/END AS next_activity_comparison,\s+g\.auto_applied,\s+g\.auto_applied_at\s+FROM grouped g/);
    expect(sql).toMatch(/AS skipped_opt_out_requested,[\s\S]*AS applied_live\s+FROM public\.crm_auto_update_shadow_comparison/);
    expect(sql).toContain('security_invoker = true');
    expect(sql).toContain('GRANT SELECT ON public.crm_auto_update_shadow_comparison TO service_role');
  });

  it('não liga flag, não lista org e não mexe em dados do log nem do CRM', () => {
    expect(sql).not.toContain(V4_AMARAL);
    // Só o note muda: nenhuma cláusula SET/VALUES mexe em enabled ou allow_org_ids.
    expect(sql).not.toMatch(/SET\s+(enabled|allow_org_ids)\b/i);
    expect(sql).not.toMatch(/,\s*(enabled|allow_org_ids)\s*=/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.app_flags/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|VIEW|TRIGGER)\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+public\.(?!app_flags\b)/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+public\.(calls|leads|scheduled_activities|interactions|call_qualifications|call_transcripts_v2|app_flags)\b/i);
    expect(sql).not.toMatch(/GRANT[^;]*(UPDATE|DELETE)[^;]*crm_auto_update_shadow_log/);
    expect(sql).toMatch(/UPDATE public\.app_flags\s+SET note = '[^']*'\s+WHERE key = 'crm_auto_update_v1_live';/);
  });

  it('sem travessão', () => {
    expect(sql).not.toMatch(/[\u2013\u2014]/);
  });
});
