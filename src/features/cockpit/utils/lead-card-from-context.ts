import type { AutoDialLeadCardExtras } from '../auto-dial.types';
import type { CallContext } from '../types';

import { AUTO_DIAL_RULES } from './auto-dial-rules';
import { buildLeadCard, type LeadCardModel } from './lead-card';

/** Data mais recente entre interações, ligações e sinais do contexto (ISO), ou null. */
export function lastContactAt(ctx: CallContext): string | null {
  const dates = [...ctx.interactions.map((i) => i.at), ...ctx.calls.map((c) => c.at), ...ctx.signals.map((s) => s.at)]
    .filter((d) => !Number.isNaN(new Date(d).getTime()))
    .sort();
  return dates.at(-1) ?? null;
}

/**
 * Cartão do lead do MOTOR (o motor trabalha com `leadId`): contexto do cartão do servidor + `leadCardExtras`.
 * "TENTATIVA n/3" = tentativa do dia. Extras nulos/ausentes simplesmente não aparecem.
 *  - TEMPERATURA = "cadastrado há X" quando há `createdAt` (senão, último contato).
 *  - Motivo e notas da perda NÃO entram na grade: o painel os mostra num bloco próprio. O motivo só escolhe a abertura.
 */
export function leadCardFromCallContext(
  ctx: CallContext,
  attemptNo: number | null,
  now?: Date,
  extras?: AutoDialLeadCardExtras | null,
): LeadCardModel {
  const [first, ...rest] = (ctx.decisionMaker.name ?? '').trim().split(/\s+/).filter(Boolean);
  const model = buildLeadCard({
    firstName: first ?? null,
    lastName: rest.join(' ') || null,
    nomeFantasia: ctx.company.name,
    razaoSocial: null,
    telefone: ctx.decisionMaker.phone,
    phones: null,
    jobTitle: ctx.decisionMaker.jobTitle,
    segmento: ctx.company.segmento,
    cnpj: ctx.company.cnpj,
    email: ctx.decisionMaker.email,
    leadSource: extras?.leadSource ?? null,
    canal: extras?.canal ?? null,
    // `lostAt` fica de fora: com ele a temperatura viraria "perdido há X"; a perda tem bloco próprio.
    lostAt: null,
    lossReasonName: extras?.lossReasonName ?? null,
    lossNotes: null,
    enrollmentLossNotes: null,
    previousSdrName: extras?.previousSdr?.name ?? null,
    stepOrder: Math.max(1, attemptNo ?? 1),
    totalSteps: AUTO_DIAL_RULES.maxAttemptsPerDay,
    lastInteractionAt: extras?.createdAt ? null : lastContactAt(ctx),
    createdAt: extras?.createdAt ?? null,
    callScript: null,
    now,
  });
  return { ...model, fields: model.fields.filter((f) => f.id !== 'motivo' && f.id !== 'notas') };
}
