import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CONSENT_CAPTURE_FLAG_KEY } from '@/features/contact-engine/services/consent-capture.service';
import { makeConsentClient, makeConsentWorld, type ConsentWorld } from '@/features/contact-engine/services/consent-capture.testkit';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { getVerbalConsentState, recordVerbalConsent } from './verbal-consent.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));

const NOW = new Date('2026-11-08T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const sdr = { orgId: 'org-1', userId: 'u1', isManager: false };

function setup(over: Partial<ConsentWorld> = {}) {
  const w = makeConsentWorld({
    flags: { [CONSENT_CAPTURE_FLAG_KEY]: { enabled: true } },
    leads: [
      { id: 'lead-1', org_id: 'org-1', telefone: '(16) 99986-7577', assigned_to: 'u1', closer_id: null },
      { id: 'lead-3', org_id: 'org-1', telefone: '11988887777', assigned_to: 'u-outro', closer_id: null },
      { id: 'lead-2', org_id: 'org-2', telefone: '11977776666', assigned_to: 'u9', closer_id: null },
    ],
    calls: [
      { id: 'call-1', org_id: 'org-1', user_id: 'u1', lead_id: 'lead-1', destination: '+5516999867577', started_at: minutesAgo(5), answered_at: minutesAgo(5), hangup_cause: null, duration_seconds: 0 },
      { id: 'call-noans', org_id: 'org-1', user_id: 'u1', lead_id: 'lead-1', destination: '+5516999867577', started_at: minutesAgo(2), answered_at: null, hangup_cause: 'NO_ANSWER', duration_seconds: 0 },
      { id: 'call-dialing', org_id: 'org-1', user_id: 'u1', lead_id: 'lead-1', destination: '+5516999867577', started_at: minutesAgo(0), answered_at: null, hangup_cause: null, duration_seconds: 0 },
      { id: 'call-old', org_id: 'org-1', user_id: 'u1', lead_id: 'lead-1', destination: '+5516999867577', started_at: minutesAgo(120), answered_at: minutesAgo(120), hangup_cause: null, duration_seconds: 60 },
      { id: 'call-other-lead', org_id: 'org-1', user_id: 'u-outro', lead_id: 'lead-3', destination: '11988887777', started_at: minutesAgo(5), answered_at: minutesAgo(5), hangup_cause: null, duration_seconds: 0 },
      { id: 'call-org2', org_id: 'org-2', user_id: 'u9', lead_id: 'lead-2', destination: '11977776666', started_at: minutesAgo(5), answered_at: minutesAgo(5), hangup_cause: null, duration_seconds: 0 },
    ],
    ...over,
  });
  const client = makeConsentClient(w) as unknown as SupabaseClient;
  vi.mocked(createServiceRoleClient).mockReturnValue(client as never);
  return { w, client };
}

describe('aceite verbal de WhatsApp na ligacao', () => {
  beforeEach(() => vi.mocked(createServiceRoleClient).mockReset());

  it('grava opt_in call_verbal_consent com call_id, usuario e identidade 55...', async () => {
    const { w, client } = setup();
    expect(await getVerbalConsentState(client, sdr, 'call-1', NOW)).toBe('available');
    expect(await recordVerbalConsent(client, sdr, 'call-1', NOW)).toEqual({ status: 'recorded' });
    expect(w.consent).toHaveLength(1);
    expect(w.consent[0]).toMatchObject({
      org_id: 'org-1',
      lead_id: 'lead-1',
      contact_identity: '5516999867577',
      channel: 'whatsapp',
      kind: 'opt_in',
      source: 'call_verbal_consent',
      created_by: 'u1',
      evidence: { ref: 'call:call-1', call_id: 'call-1', registered_by: 'u1', origin: 'cockpit_call' },
    });
    expect(await getVerbalConsentState(client, sdr, 'call-1', NOW)).toBe('recorded');
  });

  it('idempotente por call_id', async () => {
    const { w, client } = setup();
    await recordVerbalConsent(client, sdr, 'call-1', NOW);
    expect(await recordVerbalConsent(client, sdr, 'call-1', NOW)).toEqual({ status: 'already_recorded' });
    expect(w.consent).toHaveLength(1);
  });

  it('outra organizacao negada: ligacao e lead de outra org nao gravam', async () => {
    const { w, client } = setup();
    expect(await recordVerbalConsent(client, sdr, 'call-org2', NOW)).toEqual({ status: 'not_found' });
    expect(await getVerbalConsentState(client, sdr, 'call-org2', NOW)).toBe('unavailable');
    const intruder = { orgId: 'org-2', userId: 'u9', isManager: true };
    expect(await recordVerbalConsent(client, intruder, 'call-1', NOW)).toEqual({ status: 'not_found' });
    expect(w.consent).toHaveLength(0);
  });

  it('respeita a visibilidade: SDR sem relacao com a ligacao ou o lead e negado; gestor da mesma org pode', async () => {
    const { w, client } = setup();
    expect(await recordVerbalConsent(client, sdr, 'call-other-lead', NOW)).toEqual({ status: 'not_found' });
    expect(w.consent).toHaveLength(0);
    const manager = { orgId: 'org-1', userId: 'mgr', isManager: true };
    expect((await recordVerbalConsent(client, manager, 'call-other-lead', NOW)).status).toBe('recorded');
    expect(w.consent[0]).toMatchObject({ contact_identity: '5511988887777', created_by: 'mgr' });
  });

  it('sem ligacao atendida: negado e nada gravado', async () => {
    const { w, client } = setup();
    expect(await recordVerbalConsent(client, sdr, 'call-noans', NOW)).toEqual({ status: 'not_answered' });
    expect(await recordVerbalConsent(client, sdr, 'call-dialing', NOW)).toEqual({ status: 'not_answered' });
    expect(await getVerbalConsentState(client, sdr, 'call-noans', NOW)).toBe('unavailable');
    expect(await getVerbalConsentState(client, sdr, 'call-dialing', NOW)).toBe('unknown');
    expect(w.consent).toHaveLength(0);
  });

  it('fora da janela apos o atendimento: negado', async () => {
    const { w, client } = setup();
    expect(await recordVerbalConsent(client, sdr, 'call-old', NOW)).toEqual({ status: 'window_expired' });
    expect(await getVerbalConsentState(client, sdr, 'call-old', NOW)).toBe('unavailable');
    expect(w.consent).toHaveLength(0);
  });

  it('opt_out vigente vence o aceite verbal', async () => {
    const { w, client } = setup({
      consent: [{ id: 'c0', org_id: 'org-1', lead_id: 'lead-1', contact_identity: '5516999867577', channel: 'whatsapp', kind: 'opt_out', source: 'inbound_stop_request', evidence: { ref: 'm1' }, created_at: minutesAgo(60) }],
    });
    expect(await recordVerbalConsent(client, sdr, 'call-1', NOW)).toEqual({ status: 'opted_out' });
    expect(w.consent).toHaveLength(1);
  });

  it('flag desligada na camada de captura: nada gravado', async () => {
    const { w, client } = setup({ flags: { [CONSENT_CAPTURE_FLAG_KEY]: { enabled: false } } });
    expect((await recordVerbalConsent(client, sdr, 'call-1', NOW)).status).toBe('error');
    expect(w.consent).toHaveLength(0);
    expect(w.writes).toEqual([]);
  });
});
