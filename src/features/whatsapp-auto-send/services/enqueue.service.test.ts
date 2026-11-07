import { describe, expect, it } from 'vitest';

import { autoSendKey, isHandledByAutoSend } from '../utils/auto-step';
import { buildQueueRows } from './enqueue.service';

const step = { id: 'step-2', cadence_id: 'cad-1', step_order: 2, cadence: { status: 'active', type: 'standard', executor: null } };
const enrollment = (over: Record<string, unknown> = {}) => ({
  id: 'enr-1',
  cadence_id: 'cad-1',
  lead_id: 'lead-1',
  current_step: 2,
  lead: { org_id: 'org-1', assigned_to: 'sdr-1', whatsapp_invalid_at: null },
  ...over,
});

describe('buildQueueRows', () => {
  it('enfileira na fila do SDR dono do lead quando o passo atual é WhatsApp automático (critério 1)', () => {
    expect(buildQueueRows([step], [enrollment()])).toEqual([
      { org_id: 'org-1', sender_user_id: 'sdr-1', lead_id: 'lead-1', enrollment_id: 'enr-1', cadence_id: 'cad-1', step_id: 'step-2' },
    ]);
  });

  it('ignora inscrição em outro passo', () => {
    expect(buildQueueRows([step], [enrollment({ current_step: 3 })])).toEqual([]);
  });

  it('lead sem SDR responsável não entra na fila (critério 15)', () => {
    expect(
      buildQueueRows([step], [enrollment({ lead: { org_id: 'org-1', assigned_to: null, whatsapp_invalid_at: null } })]),
    ).toEqual([]);
  });

  it('lead marcado como "Não é WhatsApp" não entra na fila', () => {
    expect(
      buildQueueRows([step], [enrollment({ lead: { org_id: 'org-1', assigned_to: 'sdr-1', whatsapp_invalid_at: '2026-11-01' } })]),
    ).toEqual([]);
  });
});

describe('isHandledByAutoSend (fila de Atividades)', () => {
  const lead = { assigned_to: 'sdr-1' };
  const auto = { id: 'step-2', channel: 'whatsapp', auto_send: true, template_id: 'tpl-1' };
  const none = new Set<string>();

  it('passo automático sai da fila do SDR', () => {
    expect(isHandledByAutoSend(auto, lead, 'enr-1', none)).toBe(true);
  });

  it('passo sem a opção continua manual (critério 2)', () => {
    expect(isHandledByAutoSend({ ...auto, auto_send: false }, lead, 'enr-1', none)).toBe(false);
    expect(isHandledByAutoSend({ ...auto, channel: 'email' }, lead, 'enr-1', none)).toBe(false);
  });

  it('sem template ou sem dono continua manual (critério 15)', () => {
    expect(isHandledByAutoSend({ ...auto, template_id: null }, lead, 'enr-1', none)).toBe(false);
    expect(isHandledByAutoSend(auto, { assigned_to: null }, 'enr-1', none)).toBe(false);
  });

  it('envio automático que falhou de vez volta como tarefa manual', () => {
    expect(isHandledByAutoSend(auto, lead, 'enr-1', new Set([autoSendKey('enr-1', 'step-2')]))).toBe(false);
  });
});
