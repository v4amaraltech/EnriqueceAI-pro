import { describe, expect, it } from 'vitest';

import { type MarkerRepairCall, type MarkerRepairLog, planMarkerRepair } from './marker-repair';

const ID = '9f038ff7-0000-4000-8000-000000000002';

const call = (over: Partial<MarkerRepairCall> = {}): MarkerRepairCall => ({
  id: ID,
  org_id: 'org-v4',
  sdr_disposition: 'no_answer',
  metadata: { audio_stats: { lossPercent: 0 } },
  ...over,
});

const log = (over: Partial<MarkerRepairLog> = {}): MarkerRepairLog => ({
  call_id: ID,
  applied: true,
  applied_at: '2026-11-13T14:00:00.000Z',
  rules_version: 'hangup_v1',
  qualification_id: null,
  proposed_changes: { disposition: 'no_answer' },
  ...over,
});

describe('planMarkerRepair', () => {
  it('desfecho gravado, marcador sumido e log applied: repõe só o marcador', () => {
    expect(planMarkerRepair(ID, call(), [log()])).toEqual({
      action: 'restore',
      callId: ID,
      orgId: 'org-v4',
      patch: {
        crm_auto_update: {
          applied: true,
          disposition: 'no_answer',
          applied_at: '2026-11-13T14:00:00.000Z',
          rules_version: 'hangup_v1',
          source: 'crm_auto_update_v1_live',
        },
      },
    });
  });

  it('caixa postal JEV mantém o qualification_id do log', () => {
    const plan = planMarkerRepair(ID, call({ sdr_disposition: 'voicemail' }), [
      log({
        rules_version: 'v1.1',
        qualification_id: 'q-1',
        proposed_changes: { disposition: 'voicemail' },
      }),
    ]);
    expect(plan.action === 'restore' && plan.patch.crm_auto_update.qualification_id).toBe('q-1');
  });

  it('pula quando não há o que repor', () => {
    expect(planMarkerRepair(ID, null, [log()])).toMatchObject({
      action: 'skip',
      reason: 'call_not_found',
    });
    expect(
      planMarkerRepair(ID, call({ metadata: { crm_auto_update: { applied: true } } }), [log()]),
    ).toMatchObject({
      reason: 'marker_present',
    });
    expect(planMarkerRepair(ID, call({ sdr_disposition: null }), [log()])).toMatchObject({
      reason: 'no_disposition',
    });
    expect(planMarkerRepair(ID, call(), [log({ applied: false })])).toMatchObject({
      reason: 'no_applied_log',
    });
    expect(
      planMarkerRepair(ID, call({ sdr_disposition: 'relevant_conversation' }), [log()]),
    ).toMatchObject({
      reason: 'disposition_mismatch',
    });
  });
});
