import { describe, expect, it } from 'vitest';

import {
  clampInt,
  httpStatusFor,
  isTerminalEvent,
  parseClaimRequest,
  parseExternalStepEvent,
  type ConfirmResult,
} from './external-step';

const EVENT = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const EXEC = '0f8fad5b-d9cb-469f-a165-70867728950e';
const CAD = '16fd2706-8baf-433b-82eb-8c7fada847da';

describe('parseExternalStepEvent', () => {
  it('aceita o payload da outbox do V4 Call como ele sai', () => {
    const r = parseExternalStepEvent({
      evento: 'chamada_finalizada',
      event_id: EVENT,
      execution_id: EXEC,
      call_sid: 'CA123',
      resultado: { confirmado: true, resumo: 'ok' },
      transcricao: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ eventId: EVENT, executionId: EXEC, evento: 'chamada_finalizada', callSid: 'CA123' });
    expect(r.value.resultado).toEqual({ confirmado: true, resumo: 'ok' });
    expect(r.value.performedBy).toBeNull();
  });

  it('lê execution_id de metadata_entrada quando não vem no topo', () => {
    const r = parseExternalStepEvent({ evento: 'caixa_postal', event_id: EVENT, metadata_entrada: { execution_id: EXEC } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.executionId).toBe(EXEC);
  });

  it('rejeita sem event_id, sem execution_id ou sem evento', () => {
    expect(parseExternalStepEvent({ evento: 'x', execution_id: EXEC }).ok).toBe(false);
    expect(parseExternalStepEvent({ evento: 'x', event_id: EVENT }).ok).toBe(false);
    expect(parseExternalStepEvent({ event_id: EVENT, execution_id: EXEC }).ok).toBe(false);
    expect(parseExternalStepEvent({ evento: 'x', event_id: 'nao-uuid', execution_id: EXEC }).ok).toBe(false);
    expect(parseExternalStepEvent(null).ok).toBe(false);
  });

  it('rejeita performed_by que não é uuid', () => {
    const r = parseExternalStepEvent({ evento: 'x', event_id: EVENT, execution_id: EXEC, performed_by: 'ana' });
    expect(r.ok).toBe(false);
  });
});

describe('isTerminalEvent', () => {
  it('só os três eventos terminais avançam o passo', () => {
    expect(isTerminalEvent('chamada_finalizada')).toBe(true);
    expect(isTerminalEvent('caixa_postal')).toBe(true);
    expect(isTerminalEvent('chamada_falhou')).toBe(true);
    expect(isTerminalEvent('initiated')).toBe(false);
    expect(isTerminalEvent(undefined)).toBe(false);
  });
});

describe('parseClaimRequest', () => {
  it('usa os padrões phone/10/15min e descarta ids inválidos', () => {
    const r = parseClaimRequest({ cadence_ids: [CAD, 'lixo'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ cadenceIds: [CAD], channel: 'phone', limit: 10, leaseMinutes: 15, owner: null });
  });

  it('limita limit e lease aos tetos', () => {
    const r = parseClaimRequest({ cadence_ids: [CAD], limit: 999, lease_minutes: '0', owner: 'n8n-exec-1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ limit: 100, leaseMinutes: 1, owner: 'n8n-exec-1' });
  });

  it('rejeita sem cadence_ids e canal desconhecido', () => {
    expect(parseClaimRequest({}).ok).toBe(false);
    expect(parseClaimRequest({ cadence_ids: [CAD], channel: 'pombo' }).ok).toBe(false);
  });
});

describe('clampInt', () => {
  it('cai no fallback quando não é número', () => {
    expect(clampInt('abc', 7, 1, 10)).toBe(7);
    expect(clampInt(undefined, 7, 1, 10)).toBe(7);
    expect(clampInt(3.9, 7, 1, 10)).toBe(3);
  });
});

describe('httpStatusFor', () => {
  const base: ConfirmResult = {
    aplicado: false, duplicado: false, motivo: '', enrollment_id: null, lead_id: null, cadence_id: null,
    step_id: null, interaction_id: null, advanced: false, completed: false, new_step: null,
  };
  it('404 só para execution_id desconhecida; duplicado e tardio são 200', () => {
    expect(httpStatusFor({ ...base, motivo: 'execution_id_desconhecida' })).toBe(404);
    expect(httpStatusFor({ ...base, duplicado: true, motivo: 'event_id_ja_processado' })).toBe(200);
    expect(httpStatusFor({ ...base, motivo: 'passo_ja_avancado' })).toBe(200);
    expect(httpStatusFor({ ...base, aplicado: true, motivo: 'aplicado' })).toBe(200);
  });
});
