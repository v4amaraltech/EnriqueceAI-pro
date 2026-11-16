import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createAdminClient,
  createAnonClient,
  createAuthenticatedClient,
  createTestUser,
  shouldRunIntegration,
} from '../helpers/supabase-test-client';

// Só contra Supabase LOCAL (mesma trava de rls-policies.test.ts). Sem ele, tudo é pulado.
const SUPABASE_RUNNING = shouldRunIntegration();

const NOW = '2026-11-15T15:00:00Z'; // 12h em Brasília
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.parse(NOW) - days * DAY).toISOString();
const DISPOSITIONS = ['relevant_conversation', 'callback_requested', 'answered_no_progress'];
const BANT = ['B (Budget)', 'A (Autoridade)', 'N (Necessidade)', 'T (Timing)'];

describe.skipIf(!SUPABASE_RUNNING)('cockpit_next_call_candidates - Integration', () => {
  let admin: SupabaseClient;
  let userId: string;
  let otherUserId: string;
  let orgId: string;
  let otherOrgId: string;
  let cadenceId: string;
  let cnpjSeq = 0;

  const call = (args: Record<string, unknown> = {}) =>
    admin.rpc('cockpit_next_call_candidates', {
      p_org_id: orgId,
      p_target_user_id: userId,
      p_interest_dispositions: DISPOSITIONS,
      p_bant_field_names: BANT,
      p_now: NOW,
      ...args,
    });

  const rows = async (args: Record<string, unknown> = {}) => {
    const { data, error } = await call(args);
    expect(error).toBeNull();
    return (data ?? []) as Array<{ lead_id: string; maybe_hot: boolean; cold_rank: number | null; over_attempts: boolean; calls_today: number }>;
  };
  const coldOrder = async (args: Record<string, unknown> = {}) =>
    (await rows(args))
      .filter((r) => r.cold_rank != null)
      .sort((a, b) => a.cold_rank! - b.cold_rank!)
      .map((r) => r.lead_id);

  async function addLead(org: string, owner: string, over: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await admin
      .from('leads')
      .insert({
        org_id: org,
        cnpj: String(11222333000100 + ++cnpjSeq),
        status: 'contacted',
        enrichment_status: 'pending',
        telefone: '11999990000',
        assigned_to: owner,
        ...over,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    return data!.id as string;
  }
  const must = async (op: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await op;
    expect(error?.message ?? null).toBeNull();
  };
  async function addCalls(leadId: string, n: number, at: string) {
    const { error } = await admin.from('calls').insert(
      Array.from({ length: n }, () => ({ org_id: orgId, lead_id: leadId, user_id: userId, origin: '1000', destination: '11999990000', created_at: at, started_at: at })),
    );
    expect(error).toBeNull();
  }
  async function addEnrollment(leadId: string, due: string) {
    const { error } = await admin.from('cadence_enrollments').insert({ org_id: orgId, lead_id: leadId, cadence_id: cadenceId, status: 'active', next_step_due: due });
    expect(error).toBeNull();
  }

  beforeAll(async () => {
    admin = createAdminClient();
    userId = await createTestUser(admin, 'cockpit-cold-a@test.com', 'test12345678');
    otherUserId = await createTestUser(admin, 'cockpit-cold-b@test.com', 'test12345678');
    const a = await admin.from('organization_members').select('org_id').eq('user_id', userId).single();
    const b = await admin.from('organization_members').select('org_id').eq('user_id', otherUserId).single();
    orgId = a.data!.org_id as string;
    otherOrgId = b.data!.org_id as string;
    const cad = await admin.from('cadences').insert({ org_id: orgId, name: 'Cold test' }).select('id').single();
    cadenceId = cad.data!.id as string;
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
    if (otherUserId) await admin.auth.admin.deleteUser(otherUserId);
  });

  it('ordem do frio: cadência vencida < futura < sem cadência, e vencida mais antiga primeiro', async () => {
    const none = await addLead(orgId, userId);
    const future = await addLead(orgId, userId);
    const dueOld = await addLead(orgId, userId);
    const dueNew = await addLead(orgId, userId);
    await addEnrollment(future, ago(-2));
    await addEnrollment(dueOld, ago(5));
    await addEnrollment(dueNew, ago(1));
    const order = await coldOrder({ p_cold_limit: 500 });
    const pos = (id: string) => order.indexOf(id);
    expect(pos(dueOld)).toBeLessThan(pos(dueNew));
    expect(pos(dueNew)).toBeLessThan(pos(future));
    expect(pos(future)).toBeLessThan(pos(none));
  });

  it('desempates: menos tentativas recentes, depois ligação mais antiga', async () => {
    const fewer = await addLead(orgId, userId);
    const more = await addLead(orgId, userId);
    const olderCall = await addLead(orgId, userId);
    const newerCall = await addLead(orgId, userId);
    await addCalls(more, 2, ago(3));
    await addCalls(fewer, 1, ago(3));
    await addCalls(olderCall, 1, ago(20)); // fora da janela de 7 dias, dentro da de 30
    await addCalls(newerCall, 1, ago(10));
    const order = await coldOrder({ p_cold_limit: 500, p_daily_cap: 0 });
    expect(order.indexOf(olderCall)).toBeLessThan(order.indexOf(newerCall));
    expect(order.indexOf(fewer)).toBeLessThan(order.indexOf(more));
  });

  it('mais de 6 ligações em 30 dias desce para o fim, sem sair', async () => {
    const heavy = await addLead(orgId, userId);
    await addCalls(heavy, 7, ago(10));
    const all = await rows({ p_cold_limit: 500, p_daily_cap: 0 });
    const heavyRow = all.find((r) => r.lead_id === heavy)!;
    expect(heavyRow.over_attempts).toBe(true);
    const order = (await coldOrder({ p_cold_limit: 500, p_daily_cap: 0 }));
    expect(order[order.length - 1]).toBe(heavy);
  });

  it('teto de 2 por dia (dia de Brasília): estourou, sai da ordem do frio; cap 0 desliga', async () => {
    const capped = await addLead(orgId, userId);
    await addCalls(capped, 2, '2026-11-15T13:00:00Z'); // 10h BRT = hoje
    expect(await coldOrder({ p_cold_limit: 500 })).not.toContain(capped);
    expect(await coldOrder({ p_cold_limit: 500, p_daily_cap: 0 })).toContain(capped);
  });

  it('o dia é o de Brasília: 23h BRT de ontem não conta como hoje', async () => {
    const lateYesterday = await addLead(orgId, userId);
    await addCalls(lateYesterday, 2, '2026-11-15T01:30:00Z'); // 22h30 BRT de 14/11
    expect(await coldOrder({ p_cold_limit: 500 })).toContain(lateYesterday);
  });

  it('possível quente: resposta, reunião, desfecho do SDR, desfecho da IA, BANT e correção humana', async () => {
    const replied = await addLead(orgId, userId);
    const meeting = await addLead(orgId, userId);
    const sdrOutcome = await addLead(orgId, userId);
    const aiOutcome = await addLead(orgId, userId);
    const sentOnly = await addLead(orgId, userId);
    const bant = await addLead(orgId, userId);
    const bantEmpty = await addLead(orgId, userId);
    const corrected = await addLead(orgId, userId);

    const field = await admin.from('custom_fields').insert({ org_id: orgId, field_name: 'B (Budget)', field_type: 'text' }).select('id').single();
    expect(field.error?.message ?? null).toBeNull();
    const fieldId = field.data!.id as string;
    await must(admin.from('leads').update({ custom_field_values: { [fieldId]: 'R$ 5 mil/mês' } }).eq('id', bant));
    await must(admin.from('leads').update({ custom_field_values: { [fieldId]: '   ' } }).eq('id', bantEmpty));

    await must(
      admin.from('interactions').insert([
        { org_id: orgId, lead_id: replied, channel: 'email', type: 'replied', created_at: ago(2) },
        { org_id: orgId, lead_id: meeting, channel: 'email', type: 'meeting_scheduled', created_at: ago(2) },
        { org_id: orgId, lead_id: sentOnly, channel: 'email', type: 'sent', created_at: ago(1) },
        { org_id: orgId, lead_id: sentOnly, channel: 'email', type: 'opened', created_at: ago(1) },
      ]),
    );
    await must(
      admin.from('calls').insert([
        { org_id: orgId, lead_id: sdrOutcome, user_id: userId, origin: '1', destination: '1', sdr_disposition: 'callback_requested', created_at: ago(2) },
        { org_id: orgId, lead_id: aiOutcome, user_id: userId, origin: '1', destination: '1', metadata: { ai_outcome: { status: 'done', disposition: 'relevant_conversation' } }, created_at: ago(2) },
      ]),
    );
    await must(
      admin.from('decision_events').insert({
        org_id: orgId,
        lead_id: corrected,
        event_type: 'human_correction',
        model_version: 'call_priority_v2.0',
        source: 'human',
        idempotency_key: `correction:${corrected}:it`,
        payload: { interest_set: 50 },
        actor_user_id: userId,
      }),
    );

    const hot = new Map((await rows({ p_cold_limit: 500, p_daily_cap: 0 })).map((r) => [r.lead_id, r.maybe_hot]));
    for (const id of [replied, meeting, sdrOutcome, aiOutcome, bant, corrected]) expect(hot.get(id)).toBe(true);
    expect(hot.get(sentOnly)).toBe(false); // envio/abertura NÃO esquenta (DP-7)
    expect(hot.get(bantEmpty)).toBe(false); // BANT em branco não conta
  });

  it('última ligação de todo o histórico: há 40 dias vem ANTES de há 20 dias e de ontem, e DEPOIS de nunca ligado', async () => {
    const never = await addLead(orgId, userId);
    const old40 = await addLead(orgId, userId);
    const mid20 = await addLead(orgId, userId);
    const yesterday = await addLead(orgId, userId);
    await addCalls(old40, 1, ago(40)); // fora da janela de 30 dias
    await addCalls(mid20, 1, ago(20));
    await addCalls(yesterday, 1, ago(1));
    const order = await coldOrder({ p_cold_limit: 500, p_daily_cap: 0 });
    const pos = (id: string) => order.indexOf(id);
    expect(pos(never)).toBeGreaterThanOrEqual(0);
    expect(pos(never)).toBeLessThan(pos(old40));
    expect(pos(old40)).toBeLessThan(pos(mid20));
    expect(pos(old40)).toBeLessThan(pos(yesterday));
  });

  it('p_exclude_lead_ids NULL não esvazia a carteira', async () => {
    const lead = await addLead(orgId, userId);
    expect((await rows({ p_cold_limit: 500, p_exclude_lead_ids: null })).map((r) => r.lead_id)).toContain(lead);
  });

  it('filtros: contact_holds total, excluídos da sessão, outra org e outro dono não aparecem', async () => {
    const held = await addLead(orgId, userId);
    const excluded = await addLead(orgId, userId);
    const foreignOwner = await addLead(orgId, otherUserId);
    const otherOrgLead = await addLead(otherOrgId, userId);
    const noPhone = await addLead(orgId, userId, { telefone: null });
    const archived = await addLead(orgId, userId, { status: 'archived' });
    await must(admin.from('contact_holds').insert({ org_id: orgId, lead_id: held, tipo: 'total' }));
    const ids = (await rows({ p_cold_limit: 500, p_daily_cap: 0, p_exclude_lead_ids: [excluded] })).map((r) => r.lead_id);
    for (const id of [held, excluded, foreignOwner, otherOrgLead, noPhone, archived]) expect(ids).not.toContain(id);
  });

  it('determinismo: mesmas entradas, mesma ordem', async () => {
    expect(await coldOrder({ p_cold_limit: 500 })).toEqual(await coldOrder({ p_cold_limit: 500 }));
  });

  it('anon e authenticated NÃO executam; service_role sim', async () => {
    const args = { p_org_id: orgId, p_target_user_id: userId, p_interest_dispositions: DISPOSITIONS, p_bant_field_names: BANT };
    const anon = await createAnonClient().rpc('cockpit_next_call_candidates', args);
    expect(anon.error).not.toBeNull();
    const authed = await createAuthenticatedClient('cockpit-cold-a@test.com', 'test12345678');
    const r = await authed.rpc('cockpit_next_call_candidates', args);
    expect(r.error).not.toBeNull();
    expect((await call()).error).toBeNull();
  });
});
