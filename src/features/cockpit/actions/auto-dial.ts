'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { initiateApi4ComCall } from '@/features/calls/actions/initiate-api4com-call';
import { mergeCallsMetadata } from '@/features/calls/services/merge-calls-metadata';
import { DISPOSITION_OPTIONS } from '@/features/calls/disposition';

import type {
  AutoDialCarrierHangup,
  AutoDialAnsweredClassification,
  AutoDialBlockCode,
  AutoDialConcludeResult,
  AutoDialDialResult,
  AutoDialNextResult,
  AutoDialNoAnswerResult,
} from '../auto-dial.types';
import type { CockpitViewer } from '../types';
import { isCockpitAutoDialEnabled, isCockpitAutoDialLive } from '../services/cockpit-auto-dial-flag';
import { classifyMotorAnsweredCall, concludeMotorCallExternally, confirmMotorOutcome, readMotorCarrierHangup, resolveMotorNoAnswer } from '../services/cockpit-auto-dial-outcome.service';
import { AUTO_DIAL_METADATA_KEY, checkDialGate, countMotorCallsToday, loadMotorHolidays, pickAutoDialLead } from '../services/cockpit-auto-dial.service';
import { armCockpitCallOutcome } from '../services/call-outcome.service';
import { loadLeadCardExtras } from '../services/cockpit-auto-dial-extras.service';
import { buildNextCallCardForLead } from '../services/next-call-card.service';
import { isInvalidNumberError } from '../utils/invalid-number';
import { DEFAULT_AUTO_DIAL_QUEUE } from '../utils/recovery-queue';
import { isDailyCapReached, isWithinDialWindow } from '../utils/auto-dial-rules';

/**
 * Actions do motor automático. Toda action começa por `getAuthOrgIdResult()` → Zod → flag, e as travas
 * (janela, teto, bloqueios, tentativas, dono, telefone) rodam NO SERVIDOR a cada discagem e falham fechadas.
 * O navegador só manda `leadId`/`callId`: telefone e dono nunca vêm dele.
 */

const uuid = z.string().uuid();
const queueSchema = z.enum(['normal', 'recovery']).default(DEFAULT_AUTO_DIAL_QUEUE);
const nextSchema = z.object({
  /** Fila do motor: 'normal' (padrão) ou 'recovery' (perdidos). */
  queue: queueSchema,
  excludeLeadIds: z.array(uuid).max(2000).default([]),
  /** Só do modo simulado: tentativas de mentira desta sessão (não há linha em `calls`). */
  simulatedAttempts: z.record(uuid, z.array(z.string().datetime()).max(10)).optional(),
});
const dialSchema = z.object({
  leadId: uuid,
  queue: queueSchema,
  /** O modo que a página/hook ACREDITA estar (true = ligação real). Se o servidor decidir outro, recusa sem discar. */
  expectLive: z.boolean(),
});
const callSchema = z.object({ callId: uuid });
const noAnswerSchema = z.object({ callId: uuid, notConversation: z.boolean().optional() });
const concludeSchema = z.object({ callId: uuid, kind: z.enum(['scheduled', 'lost', 'callback', 'referred']) });
const confirmSchema = z.object({
  callId: uuid,
  // `referred_contact` é só do Cockpit: aceito aqui sem entrar em DISPOSITION_OPTIONS (seletores das outras telas).
  disposition: z.enum(['referred_contact', ...DISPOSITION_OPTIONS.map((o) => o.value)] as [string, ...string[]]),
  notes: z.string().max(5000).optional(),
});

/** O motor só trabalha na PRÓPRIA carteira do usuário logado (gestor também: nunca na de outro SDR). */
function selfViewer(auth: { orgId: string; userId: string; role: string }): CockpitViewer {
  return {
    viewerId: auth.userId,
    orgId: auth.orgId,
    isManager: auth.role === 'manager',
    targetUserId: auth.userId,
    targetName: '',
    sdrOptions: [],
  };
}

/** `getNextAutoDialCardAction`: próximo lead elegível agora, já com o cartão montado. */
export async function getNextAutoDialCardAction(input: unknown): Promise<ActionResult<AutoDialNextResult>> {
  const parsed = nextSchema.safeParse(input ?? {});
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId } = auth.data;
  const scope = { orgId, userId };
  if (!(await isCockpitAutoDialEnabled(scope))) return { success: true, data: { status: 'disabled' } };

  const now = new Date();
  const client = createServiceRoleClient();
  // Feriados: lista nacional fixa UNIDA à tabela `business_holidays` (C-1); erro de leitura = só a lista fixa.
  const window = isWithinDialWindow(now, await loadMotorHolidays(client));
  if (!window.allowed) return { success: true, data: { status: 'blocked', code: window.code as AutoDialBlockCode } };

  const motorCalls = await countMotorCallsToday(client, orgId, userId, now);
  if (motorCalls === null) return { success: false, error: 'Falha ao conferir o teto do dia' };
  if (isDailyCapReached(motorCalls)) return { success: true, data: { status: 'blocked', code: 'daily_cap' } };

  const viewer = selfViewer(auth.data);
  const picked = await pickAutoDialLead({
    viewer,
    now,
    excludeLeadIds: parsed.data.excludeLeadIds,
    simulatedAttempts: parsed.data.simulatedAttempts,
    queue: parsed.data.queue,
    client,
  });
  if (picked.kind === 'error') return { success: false, error: 'Falha ao escolher o próximo lead' };
  if (picked.kind === 'empty') return { success: true, data: { status: 'empty' } };
  if (picked.kind === 'waiting') return { success: true, data: { status: 'waiting', until: picked.until } };

  // Recuperação: o rótulo "Sem leads quentes, mostrando frio" é da fila normal; aqui o cartão não leva selo de frio/quente.
  const card = await buildNextCallCardForLead({
    viewer,
    leadId: picked.leadId,
    now,
    ranked: picked.result,
    tier: parsed.data.queue === 'recovery' ? undefined : picked.tier,
  });
  if (card.status === 'error') return { success: false, error: card.error };
  if (card.status === 'disabled') return { success: true, data: { status: 'disabled' } };
  if (card.status === 'empty') return { success: true, data: { status: 'empty' } };
  // Contexto extra do painel (origem, motivo e notas da perda, último SDR). Falha de leitura não bloqueia: vira null.
  const leadCardExtras = await loadLeadCardExtras({ client, orgId, leadId: picked.leadId, currentUserId: userId });
  return {
    success: true,
    data: { status: 'ok', card: card.data, tier: picked.tier, live: await isCockpitAutoDialLive(scope), leadCardExtras, queue: parsed.data.queue },
  };
}

/**
 * `dialAutoLeadAction`: confere TODAS as travas e disca. Sem `cockpit_auto_dial_live` (lida aqui, no servidor)
 * devolve `simulated` e NÃO chama a API4COM nem cria linha em `calls`. Com as 3 flags, usa o discador existente do
 * Cockpit (`initiateApi4ComCall`), marca a ligação como do motor (conta no teto) e arma o resultado da IA.
 */
export async function dialAutoLeadAction(input: unknown): Promise<ActionResult<AutoDialDialResult>> {
  const parsed = dialSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, role, supabase } = auth.data;

  const now = new Date();
  const gate = await checkDialGate({ orgId, userId, leadId: parsed.data.leadId, now, queue: parsed.data.queue });
  if (!gate.ok) return { success: true, data: { status: 'refused', code: gate.code } };

  // A página e o servidor precisam concordar no modo (simulado/real) ANTES de qualquer ligação: se as flags mudaram
  // com a página aberta, recusa e pede para recarregar (nada é discado).
  if (gate.live !== parsed.data.expectLive) return { success: true, data: { status: 'refused', code: 'live_mismatch' } };

  // Sem a 3ª flag: simulado. NADA de rede, NADA em `calls`.
  if (!gate.live) return { success: true, data: { status: 'simulated', attemptNo: gate.attemptNo } };

  const result = await initiateApi4ComCall({ phone: gate.phone, leadId: gate.leadId });
  if (!result.success) {
    if (result.code === 'ramal_busy') return { success: true, data: { status: 'ramal_busy', error: result.error } };
    // A-D12: número inválido (422) pula o lead em vez de pausar o motor. Só dá para reconhecer pela mensagem.
    if (isInvalidNumberError(result.error)) return { success: true, data: { status: 'invalid_number', error: result.error } };
    return { success: false, error: result.error };
  }
  const { callId, api4comId } = result.data;

  // Marca a ligação como do motor: o teto de 400/dia conta só estas (C-2). Falha aqui não desfaz a ligação (já foi feita);
  // tenta de novo uma vez. Se ainda falhar, essa ligação não entra no teto, mas o motor SEGUE e confirm/conclude/não atendeu
  // aceitam a ligação do próprio usuário criada há pouco mesmo sem o marcador.
  const marker = { [AUTO_DIAL_METADATA_KEY]: { attempt_no: gate.attemptNo, started_at: now.toISOString() } };
  let marked = await mergeCallsMetadata(supabase, callId, marker, { orgId });
  if (marked.error) marked = await mergeCallsMetadata(supabase, callId, marker, { orgId });
  if (marked.error) console.error('[cockpit-auto-dial] marcador do motor:', marked.error);

  // A IA sugere o desfecho (hold_low_confidence); falha ao armar não afeta a ligação.
  await armCockpitCallOutcome(supabase, { orgId, userId, isManager: role === 'manager' }, callId).catch(() => undefined);

  return { success: true, data: { status: 'dialed', callId, providerCallId: api4comId, attemptNo: gate.attemptNo } };
}

/** FR-6/FR-7: depois de uma ligação do motor sem atendimento. Só a 3ª tentativa do dia grava `no_answer`. */
export async function resolveAutoDialNoAnswerAction(input: unknown): Promise<ActionResult<AutoDialNoAnswerResult>> {
  const parsed = noAnswerSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;
  if (!(await isCockpitAutoDialEnabled({ orgId, userId }))) return { success: true, data: { status: 'refused' } };

  const r = await resolveMotorNoAnswer({ supabase, orgId, userId, callId: parsed.data.callId, now: new Date(), notConversation: parsed.data.notConversation });
  if (r.status === 'error') return { success: false, error: 'Falha ao registrar a ligação não atendida' };
  return { success: true, data: r };
}

/** PR-B: a ligação atendida CONVERSOU? Só quem conversou mostra as três ações; o resto volta para a fila. */
export async function classifyAutoDialAnsweredAction(input: unknown): Promise<ActionResult<AutoDialAnsweredClassification>> {
  const parsed = callSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;
  if (!(await isCockpitAutoDialEnabled({ orgId, userId }))) return { success: true, data: { status: 'refused' } };

  const r = await classifyMotorAnsweredCall({ supabase, orgId, userId, callId: parsed.data.callId });
  if (r.status === 'error') return { success: false, error: 'Falha ao classificar a ligação atendida' };
  return { success: true, data: r };
}

/** A escuta ao vivo desligou esta ligação (caixa postal / não atendeu / número inexistente)? Lê só a marca `auto_hangup`. */
export async function getAutoDialCarrierHangupAction(input: unknown): Promise<ActionResult<AutoDialCarrierHangup>> {
  const parsed = callSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;
  if (!(await isCockpitAutoDialEnabled({ orgId, userId }))) return { success: true, data: { status: 'refused' } };

  const r = await readMotorCarrierHangup({ supabase, orgId, userId, callId: parsed.data.callId });
  if (r.status === 'error') return { success: false, error: 'Falha ao ler a ligação' };
  return { success: true, data: r };
}

/** FR-9: o SDR confirma o desfecho da ligação atendida. Não avança a cadência. */
export async function confirmAutoDialOutcomeAction(input: unknown): Promise<ActionResult<{ confirmed: true }>> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;
  if (!(await isCockpitAutoDialEnabled({ orgId, userId }))) return { success: false, error: 'Discagem desligada' };

  const r = await confirmMotorOutcome({
    supabase,
    orgId,
    userId,
    callId: parsed.data.callId,
    disposition: parsed.data.disposition as Parameters<typeof confirmMotorOutcome>[0]['disposition'],
    notes: parsed.data.notes,
  });
  if (r.status === 'refused') return { success: false, error: 'Ligação não encontrada' };
  if (r.status === 'error') return { success: false, error: 'Falha ao registrar o desfecho' };
  return { success: true, data: { confirmed: true } };
}

/**
 * O SDR agendou reunião ou desqualificou pelo painel durante a ligação do motor: dá à ligação o desfecho mínimo
 * (sem pedir o Confirmar e sem avançar cadência). Só ligação do PRÓPRIO usuário e marcada pelo motor.
 */
export async function concludeAutoDialCallAction(input: unknown): Promise<ActionResult<AutoDialConcludeResult>> {
  const parsed = concludeSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;
  if (!(await isCockpitAutoDialEnabled({ orgId, userId }))) return { success: true, data: { status: 'refused' } };

  const r = await concludeMotorCallExternally({ supabase, orgId, userId, callId: parsed.data.callId, kind: parsed.data.kind });
  if (r.status === 'error') return { success: false, error: 'Falha ao registrar o desfecho da ligação' };
  return { success: true, data: r };
}
