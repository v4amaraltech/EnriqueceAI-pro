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
const agoMin = (min: number) => new Date(Date.parse(NOW) - min * 60_000).toISOString();

describe.skipIf(!SUPABASE_RUNNING)('cockpit_recovery_candidates - Integration', () => {
  let admin: SupabaseClient;
  let userId: string;
  let otherUserId: string;
  let orgId: string;
  let otherOrgId: string;
  let cnpjSeq = 0;
  let blocklistId: string;
  let spamId: string;
  let semInteresseId: string;

  const rows = async (args: Record<string, unknown> = {}) => {
    const { data, error } = await admin.rpc('cockpit_recovery_candidates', { p_org_id: orgId, p_target_user_id: userId, p_now: NOW, ...args });
    expect(error?.message ?? null).toBeNull();
    return (data ?? []) as Array<{
      lead_id: string;
      lost_at: string;
      loss_reason_name: string | null;
      calls_today: number;
      attempts_window: number;
      last_call_at: string | null;
      conversation_today: boolean;
      callback_pending: boolean;
      recovery_rank: number;
    }>;
  };
  const ids = async (args: Record<string, unknown> = {}) => (await rows(args)).map((r) => r.lead_id);

  const must = async (op: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await op;
    expect(error?.message ?? null).toBeNull();
  };

  async function addLost(over: Record<string, unknown> = {}, org: string = orgId, owner: string = userId): Promise<string> {
    const { data, error } = await admin
      .from('leads')
      .insert({
        org_id: org,
        cnpj: String(33222333000100 + ++cnpjSeq),
        status: 'unqualified',
        enrichment_status: 'pending',
        telefone: '11999990000',
        assigned_to: owner,
        lost_at: ago(10),
        loss_reason_id: semInteresseId,
        ...over,
      })
      .select('id')
      .single();
    expect(error?.message ?? null).toBeNull();
    return data!.id as string;
  }
  async function addCall(leadId: string, at: string, over: Record<string, unknown> = {}) {
    await must(
      admin.from('calls').insert({ org_id: orgId, lead_id: leadId, user_id: userId, origin: '1000', destination: '11999990000', created_at: at, started_at: at, ...over }),
    );
  }
  async function reason(name: string): Promise<string> {
    const { data, error } = await admin.from('loss_reasons').insert({ org_id: orgId, name }).select('id').single();
    expect(error?.message ?? null).toBeNull();
    return data!.id as string;
  }

  beforeAll(async () => {
    admin = createAdminClient();
    userId = await createTestUser(admin, 'cockpit-recovery-a@test.com', 'test12345678');
    otherUserId = await createTestUser(admin, 'cockpit-recovery-b@test.com', 'test12345678');
    const a = await admin.from('organization_members').select('org_id').eq('user_id', userId).single();
    const b = await admin.from('organization_members').select('org_id').eq('user_id', otherUserId).single();
    orgId = a.data!.org_id as string;
    otherOrgId = b.data!.org_id as string;
    blocklistId = await reason('Blocklist');
    spamId = await reason('SPAM');
    semInteresseId = await reason('Sem interesse');
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
    if (otherUserId) await admin.auth.admin.deleteUser(otherUserId);
  });

  it('D-14: ordem = PERDA MAIS RECENTE primeiro (id desempata)', async () => {
    const old = await addLost({ lost_at: ago(90) });
    const mid = await addLost({ lost_at: ago(30) });
    const recent = await addLost({ lost_at: ago(2) });
    const order = await ids({ p_limit: 5000 });
    expect(order.indexOf(recent)).toBeLessThan(order.indexOf(mid));
    expect(order.indexOf(mid)).toBeLessThan(order.indexOf(old));
    const ranked = await rows({ p_limit: 5000 });
    expect(ranked.map((r) => r.recovery_rank)).toEqual(ranked.map((_, i) => i + 1));
  });

  it('só perdidos da carteira: dono ou closer; outro dono, não perdido, excluído, sem telefone e sem lost_at ficam fora', async () => {
    const asCloser = await addLost({ assigned_to: otherUserId, closer_id: userId });
    const foreignOwner = await addLost({}, orgId, otherUserId);
    const notLost = await addLost({ status: 'contacted', lost_at: null });
    const deleted = await addLost({ deleted_at: ago(1) });
    const noPhone = await addLost({ telefone: null });
    const blankPhone = await addLost({ telefone: '   ' });
    const noLostAt = await addLost({ lost_at: null });
    const list = await ids({ p_limit: 5000 });
    expect(list).toContain(asCloser);
    for (const id of [foreignOwner, notLost, deleted, noPhone, blankPhone, noLostAt]) expect(list).not.toContain(id);
  });

  it('outra organização NUNCA aparece (lead, motivo e ligação)', async () => {
    const foreignLead = await addLost({ loss_reason_id: null }, otherOrgId, userId);
    expect(await ids({ p_limit: 5000 })).not.toContain(foreignLead);
    expect(await ids({ p_limit: 5000, p_org_id: otherOrgId })).toContain(foreignLead);
  });

  it('contact_holds total e prospeccao tiram o lead; conversa não', async () => {
    const total = await addLost();
    const prosp = await addLost();
    const conv = await addLost();
    await must(admin.from('contact_holds').insert([
      { org_id: orgId, lead_id: total, tipo: 'total' },
      { org_id: orgId, lead_id: prosp, tipo: 'prospeccao' },
      { org_id: orgId, lead_id: conv, tipo: 'conversa' },
    ]));
    const list = await ids({ p_limit: 5000 });
    expect(list).not.toContain(total);
    expect(list).not.toContain(prosp);
    expect(list).toContain(conv);
  });

  it('motivos bloqueados (A-D5 + decisão de 16/11) saem pelo NOME; SPAM, Contatos inválidos, Cliente, Cliente oculto e sem motivo continuam', async () => {
    const blockedNames = ['Blocklist', 'Adolescente/Criança', 'Ex-cliente (detrator)', 'Duplicado', 'Engano/Não Lembra', 'Pessoa Física', 'Desqualificado pelo closer'];
    const keptNames = ['SPAM', 'Contatos inválidos', 'Cliente', 'Cliente oculto'];
    const blocked: string[] = [];
    const kept: string[] = [];
    for (const name of blockedNames) blocked.push(await addLost({ loss_reason_id: name === 'Blocklist' ? blocklistId : await reason(name) }));
    for (const name of keptNames) kept.push(await addLost({ loss_reason_id: name === 'SPAM' ? spamId : await reason(name) }));
    const noReason = await addLost({ loss_reason_id: null });
    const list = await ids({ p_limit: 5000 });
    for (const id of blocked) expect(list).not.toContain(id);
    for (const id of [...kept, noReason]) expect(list).toContain(id);
    const row = (await rows({ p_limit: 5000 })).find((r) => r.lead_id === kept[0]);
    expect(row?.loss_reason_name).toBe('SPAM');
    // a lista de motivos bloqueados é parâmetro (sem nova migration)
    expect(await ids({ p_limit: 5000, p_blocked_reason_names: ['SPAM'] })).not.toContain(kept[0]);
    expect(await ids({ p_limit: 5000, p_blocked_reason_names: [] })).toContain(blocked[0]);
  });

  it('A-D4: conversa real DEPOIS da perda tira o lead; antes da perda, caixa postal ou ligação curta não tiram', async () => {
    const talkedAfter = await addLost({ lost_at: ago(10) });
    const talkedBefore = await addLost({ lost_at: ago(10) });
    const voicemail = await addLost({ lost_at: ago(10) });
    const short = await addLost({ lost_at: ago(10) });
    const long50 = await addLost({ lost_at: ago(10) });
    await addCall(talkedAfter, ago(5), { sdr_disposition: 'relevant_conversation', answered_at: ago(5) });
    await addCall(talkedBefore, ago(20), { sdr_disposition: 'relevant_conversation', answered_at: ago(20) });
    await addCall(voicemail, ago(5), { sdr_disposition: 'voicemail', answered_at: ago(5), duration_seconds: 120 });
    await addCall(short, ago(5), { answered_at: ago(5), duration_seconds: 49 });
    await addCall(long50, ago(5), { answered_at: ago(5), duration_seconds: 50 });
    const list = await ids({ p_limit: 5000 });
    expect(list).not.toContain(talkedAfter);
    expect(list).toContain(talkedBefore);
    expect(list).toContain(voicemail);
    expect(list).toContain(short);
    expect(list).not.toContain(long50);
  });

  it('A-D4: a IA aplicada e confiante conta como conversa; sem confiança, em revisão ou não aplicada, não', async () => {
    const aiConv = await addLost();
    const aiLowConf = await addLost();
    const aiReview = await addLost();
    const aiNotApplied = await addLost();
    const aiNoAnswer = await addLost();
    const ai = (over: Record<string, unknown>) => ({ ai_outcome: { status: 'done', disposition: 'relevant_conversation', confidence: 0.9, applied: true, needs_review: false, ...over } });
    await addCall(aiConv, ago(5), { metadata: ai({}) });
    await addCall(aiLowConf, ago(5), { metadata: ai({ confidence: 0.69 }) });
    await addCall(aiReview, ago(5), { metadata: ai({ needs_review: true }) });
    await addCall(aiNotApplied, ago(5), { metadata: ai({ applied: false }) });
    // IA classificou 'no_answer' (não conversa) numa ligação atendida de 120 s: NÃO é conversa (igual a real-conversation.ts)
    await addCall(aiNoAnswer, ago(5), { answered_at: ago(5), duration_seconds: 120, metadata: ai({ disposition: 'no_answer' }) });
    const list = await ids({ p_limit: 5000 });
    expect(list).not.toContain(aiConv);
    for (const id of [aiLowConf, aiReview, aiNotApplied, aiNoAnswer]) expect(list).toContain(id);
  });

  it('retorno vencido mantém na fila quem já conversou depois da perda (FR-23), e informa callback_pending', async () => {
    const withCb = await addLost();
    const withoutCb = await addLost();
    for (const id of [withCb, withoutCb]) await addCall(id, ago(5), { sdr_disposition: 'callback_requested', answered_at: ago(5) });
    await must(admin.from('scheduled_activities').insert({ org_id: orgId, lead_id: withCb, user_id: userId, channel: 'phone', kind: 'return', status: 'pending', scheduled_at: agoMin(30) }));
    const all = await rows({ p_limit: 5000 });
    expect(all.find((r) => r.lead_id === withCb)?.callback_pending).toBe(true);
    expect(all.map((r) => r.lead_id)).not.toContain(withoutCb);
  });

  it('contadores do dia (BRT) e teto de tentativas: 3 ligações hoje tiram o lead; 2 ficam, com calls_today e last_call_at', async () => {
    const two = await addLost();
    const three = await addLost();
    const yesterday = await addLost();
    await addCall(two, agoMin(300));
    await addCall(two, agoMin(120));
    for (const m of [400, 300, 200]) await addCall(three, agoMin(m));
    await addCall(yesterday, '2026-11-14T12:00:00Z');
    const all = await rows({ p_limit: 5000 });
    const r = all.find((x) => x.lead_id === two);
    expect(r).toMatchObject({ calls_today: 2 });
    expect(Date.parse(r!.last_call_at!)).toBe(Date.parse(agoMin(120)));
    expect(all.map((x) => x.lead_id)).not.toContain(three);
    expect(all.find((x) => x.lead_id === yesterday)).toMatchObject({ calls_today: 0, attempts_window: 1 });
    // teto 0 = sem limite
    expect(await ids({ p_limit: 5000, p_max_attempts_per_day: 0 })).toContain(three);
  });

  it('p_exclude_lead_ids (no corpo) e NULL não esvazia a lista', async () => {
    const a = await addLost();
    const b = await addLost();
    const without = await ids({ p_limit: 5000, p_exclude_lead_ids: [a] });
    expect(without).not.toContain(a);
    expect(without).toContain(b);
    expect(await ids({ p_limit: 5000, p_exclude_lead_ids: null })).toContain(a);
  });

  it('p_limit devolve só as primeiras (as mais recentes)', async () => {
    const limited = await rows({ p_limit: 3 });
    expect(limited).toHaveLength(3);
    const all = await rows({ p_limit: 5000 });
    expect(limited.map((r) => r.lead_id)).toEqual(all.slice(0, 3).map((r) => r.lead_id));
  });

  it('determinismo: mesmas entradas, mesma ordem', async () => {
    expect(await ids({ p_limit: 5000 })).toEqual(await ids({ p_limit: 5000 }));
  });

  it('anon e authenticated NÃO executam; service_role sim', async () => {
    const args = { p_org_id: orgId, p_target_user_id: userId };
    const anon = await createAnonClient().rpc('cockpit_recovery_candidates', args);
    expect(anon.error).not.toBeNull();
    const authed = await createAuthenticatedClient('cockpit-recovery-a@test.com', 'test12345678');
    const r = await authed.rpc('cockpit_recovery_candidates', args);
    expect(r.error).not.toBeNull();
    const ok = await admin.rpc('cockpit_recovery_candidates', { ...args, p_now: NOW });
    expect(ok.error).toBeNull();
  });
});
