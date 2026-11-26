import { describe, expect, it } from 'vitest';

import { COLD_LEAD_LABEL, COLD_ORDER_DEFAULTS, buildCandidatesRpcArgs, chunk } from './cold-lead-order';

const viewer = { orgId: 'org-1', targetUserId: 'u1' };
const NOW = new Date('2026-11-15T12:00:00Z');

describe('buildCandidatesRpcArgs', () => {
  it('usa os padrões aprovados e o relógio explícito', () => {
    const a = buildCandidatesRpcArgs(viewer, NOW);
    expect(a).toMatchObject({
      p_org_id: 'org-1',
      p_target_user_id: 'u1',
      p_now: '2026-11-15T12:00:00.000Z',
      p_daily_cap: 2,
      p_recent_days: 7,
      p_attempts_window_days: 30,
      p_max_attempts: 6,
      p_signal_window_days: 90,
      p_cold_limit: COLD_ORDER_DEFAULTS.coldLimit,
      p_exclude_lead_ids: [],
    });
    expect(a.p_bant_field_names).toEqual(['B (Budget)', 'A (Autoridade)', 'N (Necessidade)', 'T (Timing)']);
  });

  it('manda os excluídos (sem repetição) no argumento, não na URL', () => {
    expect(buildCandidatesRpcArgs(viewer, NOW, ['a', 'b', 'a']).p_exclude_lead_ids).toEqual(['a', 'b']);
  });

  it('só desfechos com ponto > 0 contam como interesse', () => {
    expect(buildCandidatesRpcArgs(viewer, NOW).p_interest_dispositions.sort()).toEqual(
      ['answered_no_progress', 'callback_requested', 'referred_contact', 'relevant_conversation'].sort(),
    );
  });

  it('mesma entrada, mesma saída', () => {
    expect(buildCandidatesRpcArgs(viewer, NOW, ['x'])).toEqual(buildCandidatesRpcArgs(viewer, NOW, ['x']));
  });
});

describe('constantes e chunk', () => {
  it('rótulo aprovado (DP-4)', () => expect(COLD_LEAD_LABEL).toBe('Sem leads quentes, mostrando frio'));
  it('divide em blocos', () => expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]));
});
