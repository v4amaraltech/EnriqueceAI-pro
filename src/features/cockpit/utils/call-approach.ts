import type { CallApproach, CallContext } from '../types';

const SUMMARY_LIMIT = 200;
const HIGH_FIT = 70;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const SOURCE_LABELS: Record<string, string> = {
  email: 'e-mail',
  whatsapp: 'WhatsApp',
  phone: 'telefone',
  linkedin: 'LinkedIn',
  crm: 'CRM',
  research: 'pesquisa',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** Tempo relativo em pt-BR ("há 3 horas"). Datas inválidas ou futuras viram "agora". */
export function relativeTimePt(iso: string, now: Date): string {
  const diff = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < MINUTE_MS) return 'agora';
  if (diff < HOUR_MS) {
    const m = Math.floor(diff / MINUTE_MS);
    return `há ${m} ${m === 1 ? 'minuto' : 'minutos'}`;
  }
  if (diff < DAY_MS) {
    const h = Math.floor(diff / HOUR_MS);
    return `há ${h} ${h === 1 ? 'hora' : 'horas'}`;
  }
  const d = Math.floor(diff / DAY_MS);
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
}

function truncate(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}

/** Resumo curto: resumo/anotação da última ligação, senão trecho da última interação; null sem dados. */
export function summarizeContext(ctx: CallContext): string | null {
  const fromCall = ctx.calls.find((c) => c.summary?.trim())?.summary;
  if (fromCall) return truncate(fromCall, SUMMARY_LIMIT);
  const fromInteraction = ctx.interactions.find((i) => i.excerpt?.trim())?.excerpt;
  return fromInteraction ? truncate(fromInteraction, SUMMARY_LIMIT) : null;
}

/**
 * Abordagem sugerida v0. Função pura e determinística: mesmas entradas, mesma
 * saída. Só usa o que já está no contexto; ausência de dado vira orientação
 * para perguntar, nunca um fato inventado.
 */
export function suggestApproach(ctx: CallContext): CallApproach {
  const who = ctx.decisionMaker.name ?? 'o responsável';
  const company = ctx.company.name;
  const lastSignal = ctx.signals[0];
  const via = lastSignal ? sourceLabel(lastSignal.source) : 'contato anterior';

  let headline: string;
  let opening: string;
  let goal: string;
  switch (ctx.whyNow.code) {
    case 'replied':
      headline = 'Retomar a conversa iniciada pelo lead';
      opening = `Oi, ${who}. Vi que você respondeu por ${via} e quis falar rapidinho sobre isso.`;
      goal = 'Combinar o próximo passo ou marcar uma reunião';
      break;
    case 'callback_requested':
      headline = 'Retornar como combinado';
      opening = `Oi, ${who}. Estou ligando como você pediu para conversarmos sobre ${company}.`;
      goal = 'Confirmar o melhor horário e avançar a conversa';
      break;
    case 'meeting_no_show':
      headline = 'Reagendar a reunião não realizada';
      opening = `Oi, ${who}. Não conseguimos nos falar na reunião e queria entender o melhor momento para remarcar.`;
      goal = 'Reagendar a reunião';
      break;
    case 'engaged':
      headline = 'Aproveitar o interesse recente';
      opening = `Oi, ${who}. Vi que você interagiu com nosso contato por ${via} e quis entender se faz sentido conversarmos.`;
      goal = 'Entender o interesse e propor uma conversa curta';
      break;
    default:
      headline = 'Primeira abordagem curta';
      opening = `Oi, ${who}. Aqui é da nossa equipe comercial e queria entender rapidamente se faz sentido conversarmos com a ${company}.`;
      goal = 'Apresentar-se e validar se há encaixe';
  }

  const points: string[] = [];

  const lastSummary = summarizeContext(ctx);
  if (ctx.calls.some((c) => c.summary?.trim()) && lastSummary) points.push(`Retome o que ficou da última ligação: ${lastSummary}`);

  const recent = ctx.calls.slice(0, 2);
  if (recent.length === 2 && recent.every((c) => !c.connected)) {
    points.push('As duas últimas ligações não conectaram, tente outro horário');
  }

  if (ctx.objections === null) {
    points.push('Sem dados de objeções: pergunte o que poderia impedir avançar');
  } else if (ctx.objections.length > 0) {
    points.push(`Objeções já registradas: ${ctx.objections.join('; ')}`);
  }

  if (!ctx.decisionMaker.name) points.push('Sem nome do contato: confirme quem decide');
  else if (!ctx.decisionMaker.jobTitle) points.push('Confirme o cargo e se a pessoa decide a compra');

  if (ctx.company.segmento) points.push(`Segmento: ${ctx.company.segmento}`);
  if (ctx.scores.fit != null && ctx.scores.fit >= HIGH_FIT) points.push(`Bom encaixe com o perfil ideal (fit ${ctx.scores.fit})`);

  return { version: 'v0', headline, opening, goal, points };
}
