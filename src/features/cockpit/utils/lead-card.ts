import type { PendingActivity } from '@/features/activities/types';

import { usefulCallScript } from './call-history';

const MONTH_MS = 30.4375 * 24 * 60 * 60 * 1000;

/**
 * Rótulo quente, morno ou frio. Essa escala não existe no produto, então
 * fica de fora. A frase do cartão vem de formatCardTemperature.
 */
export function leadTemperatureLabel(): null {
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "há 1 dia", "há 12 dias" ou "há X meses". Data inválida ou futura some. */
export function formatAgo(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const elapsed = now.getTime() - then.getTime();
  if (!(elapsed > 0)) return null;
  const days = elapsed / DAY_MS;
  if (days < 1) return 'há menos de 1 dia';
  if (days < 29.5) {
    const shown = Math.max(1, Math.round(days));
    return shown === 1 ? 'há 1 dia' : `há ${shown} dias`;
  }
  const raw = elapsed / MONTH_MS;
  const rounded = Math.round(raw * 10) / 10;
  const shown = rounded < 0.1 ? 0.1 : rounded;
  const digits = Number.isInteger(shown) ? 0 : 1;
  const quantity = shown.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: 1 });
  const unit = shown === 1 ? 'mês' : 'meses';
  return `há ${quantity} ${unit}`;
}

/** Temperatura sempre preenchida. Perda vence. Sem data, o texto é "Sem dados". */
export function formatCardTemperature(input: {
  lostAt: string | null | undefined;
  lastInteractionAt: string | null | undefined;
  createdAt: string | null | undefined;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const lost = formatLostAgo(input.lostAt, now);
  if (lost) return lost;
  const last = formatAgo(input.lastInteractionAt, now);
  if (last) return `último contato ${last}`;
  const created = formatAgo(input.createdAt, now);
  if (created) return `cadastrado ${created}`;
  return 'Sem dados';
}

/** "perdido há X meses" a partir de `lost_at`. Data inválida ou futura some. */
export function formatLostAgo(lostAt: string | null | undefined, now: Date = new Date()): string | null {
  if (!lostAt) return null;
  const lost = new Date(lostAt);
  if (Number.isNaN(lost.getTime())) return null;
  const raw = (now.getTime() - lost.getTime()) / MONTH_MS;
  if (!(raw > 0)) return null;
  const rounded = Math.round(raw * 10) / 10;
  const shown = rounded < 0.1 ? 0.1 : rounded;
  const digits = Number.isInteger(shown) ? 0 : 1;
  const quantity = shown.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: 1 });
  const unit = shown === 1 ? 'mês' : 'meses';
  return `perdido há ${quantity} ${unit}`;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeReason(value: string | null | undefined): string | null {
  const trimmed = clean(value);
  if (!trimmed) return null;
  return trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Aberturas estáticas, sem LLM. A chave é o nome do motivo, sem acento e em
 * minúsculas. Blocklist, SPAM e menor de idade não ganham frase: não sugerimos
 * retomar esses contatos.
 */
const OPENING_BODY: Record<string, string> = {
  'deixou de responder': 'parece que a conversa com a V4 ficou parada no meio do caminho. Seria um problema retomarmos em 2 minutos?',
  'nunca respondeu': 'a gente tentou falar algumas vezes e não conseguiu. Seria um problema eu explicar em 2 minutos por que liguei?',
  'sem interesse': 'da última vez o assunto não parecia prioridade. Seria um problema eu checar se algo mudou?',
  'sem timing': 'na última conversa o momento não era agora. Seria um problema retomarmos por 2 minutos para ver se a janela abriu?',
  'sem budget': 'orçamento foi o ponto que travou a conversa. Seria um problema eu entender se isso ainda vale?',
  'sem necessidade': 'na época não havia uma necessidade clara. Seria um problema eu confirmar se isso continua igual?',
  'sem autoridade': 'da última vez a decisão não estava com você. Seria um problema eu perguntar quem precisa ouvir isso agora?',
  'nao icp': 'a gente entendeu que o perfil não encaixava. Seria um problema eu confirmar isso em 1 minuto antes de encerrar?',
  'contatos invalidos': 'o contato que a gente tinha não funcionou. Seria um problema eu confirmar se este número é o melhor?',
  duplicado: 'parece que já existia outro cadastro nosso. Seria um problema eu confirmar com quem devo falar?',
  cliente: 'vocês já são clientes. Seria um problema eu checar se há algo em aberto com a V4?',
  'cliente oculto': 'a gente suspeitou de um contato de avaliação. Seria um problema eu confirmar o contexto desta ligação?',
  'ex-cliente (detrator)': 'a experiência anterior com a V4 não foi boa. Seria um problema eu ouvir o que ficou pendente?',
  'engano/nao lembra': 'pode ser que a conversa anterior não tenha ficado clara. Seria um problema eu relembrar em 2 minutos quem somos?',
  'pessoa fisica': 'o cadastro ficou como pessoa física. Seria um problema eu confirmar se faz sentido continuar?',
  'servico fora de escopo': 'o que vocês precisam ficou fora do que a V4 entrega. Seria um problema eu confirmar se o pedido mudou?',
};

const NO_RESUME = new Set(['blocklist', 'spam', 'adolescente/crianca']);

function withName(firstName: string | null | undefined, body: string): string {
  const name = clean(firstName);
  if (!name) return body.charAt(0).toLocaleUpperCase('pt-BR') + body.slice(1);
  return `${name}, ${body}`;
}

function scriptHint(script: string | null | undefined): string | null {
  const text = usefulCallScript(script);
  if (!text) return null;
  const sentence = text.split(/(?<=[.!?])\s/)[0]?.trim() ?? text;
  const clipped = sentence.length > 90 ? `${sentence.slice(0, 87)}...` : sentence;
  return /[.!?]$/.test(clipped) ? clipped : `${clipped}.`;
}

/** Abertura do motivo de perda. Sem motivo, ou motivo sem modelo, devolve null. */
export function openingLine(reasonName: string | null | undefined, firstName: string | null | undefined): string | null {
  const key = normalizeReason(reasonName);
  if (!key || NO_RESUME.has(key)) return null;
  const body = OPENING_BODY[key];
  if (!body) return null;
  return withName(firstName, body);
}

/** Abertura sempre preenchida. Lead ativo usa tentativa, segmento e o roteiro do passo. */
export function suggestedOpening(input: {
  firstName: string | null | undefined;
  segmento: string | null | undefined;
  lossReasonName: string | null | undefined;
  stepOrder: number;
  totalSteps: number;
  callScript: string | null | undefined;
}): string {
  const key = normalizeReason(input.lossReasonName);
  if (key && NO_RESUME.has(key)) {
    return withName(input.firstName, 'este cadastro está em uma restrição. Não retome a conversa.');
  }
  const lost = key ? OPENING_BODY[key] : undefined;
  if (lost) return withName(input.firstName, lost);

  const attempt = `tentativa ${input.stepOrder} de ${input.totalSteps}`;
  const hint = scriptHint(input.callScript);
  const segment = clean(input.segmento);
  if (hint) {
    return withName(input.firstName, `na ${attempt}, o passo pede: ${hint} Seria um problema eu seguir por 2 minutos?`);
  }
  if (segment) {
    return withName(input.firstName, `esta é a ${attempt}. A empresa está no segmento ${segment}. Seria um problema eu falar por 2 minutos?`);
  }
  return withName(input.firstName, `esta é a ${attempt}. Seria um problema eu explicar em 2 minutos o motivo do contato?`);
}

export function openingTemplates(): string[] {
  return Object.values(OPENING_BODY);
}

function displayPhone(raw: string): string {
  if (raw.startsWith('+')) return raw;
  const compact = raw.replace(/\s/g, '');
  if (/^\d{12,15}$/.test(compact)) return `+${compact}`;
  return raw;
}

function phoneValue(telefone: string | null | undefined, phones: Array<{ numero?: string | null }> | null | undefined): string | null {
  const direct = clean(telefone);
  if (direct) return displayPhone(direct);
  for (const phone of phones ?? []) {
    const number = clean(phone?.numero);
    if (number) return displayPhone(number);
  }
  return null;
}

function formatCnpj(cnpj: string | null | undefined): string {
  const trimmed = cnpj?.trim() ?? '';
  if (!trimmed) return '-';
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length !== 14) return trimmed;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export interface LeadCardInput {
  firstName: string | null;
  lastName: string | null;
  nomeFantasia: string | null;
  razaoSocial: string | null;
  telefone: string | null;
  phones: Array<{ numero?: string | null }> | null;
  jobTitle: string | null;
  segmento: string | null;
  cnpj: string | null;
  email: string | null;
  leadSource: string | null;
  canal: string | null;
  lostAt: string | null;
  lossReasonName: string | null;
  lossNotes: string | null;
  enrollmentLossNotes: string | null;
  /**
   * SDR anterior. Não há histórico de atribuição no produto: fica null e o
   * campo some. Só aparece se quem chama entregar um nome já conhecido.
   */
  previousSdrName: string | null;
  stepOrder: number;
  totalSteps: number;
  lastInteractionAt?: string | null;
  createdAt?: string | null;
  callScript?: string | null;
  now?: Date;
}

export interface LeadCardField {
  id: string;
  label: string;
  value: string;
  fullWidth?: boolean;
}

export interface LeadCardModel {
  attemptLabel: string;
  name: string | null;
  company: string | null;
  fields: LeadCardField[];
  opening: string;
}

export function buildLeadCard(input: LeadCardInput): LeadCardModel {
  const now = input.now ?? new Date();
  const name = [clean(input.firstName), clean(input.lastName)].filter(Boolean).join(' ') || null;
  const company = clean(input.nomeFantasia) ?? clean(input.razaoSocial);
  const fields: LeadCardField[] = [];

  const push = (id: string, label: string, value: string | null, fullWidth = false) => {
    if (!value) return;
    fields.push({ id, label, value, fullWidth });
  };

  push('telefone', 'Telefone', phoneValue(input.telefone, input.phones));
  push('cargo', 'Cargo', clean(input.jobTitle));
  push('segmento', 'Segmento', clean(input.segmento));
  fields.push({ id: 'cnpj', label: 'CNPJ', value: formatCnpj(input.cnpj) });
  push('email', 'E-mail', clean(input.email));
  const origem = [clean(input.leadSource), clean(input.canal)].filter(Boolean).join(' / ');
  push('origem', 'Origem', origem || null);

  const hasTemperaturePair = Boolean(clean(input.previousSdrName) || clean(input.lossReasonName));
  fields.push({
    id: 'temperatura',
    label: 'Temperatura',
    value: formatCardTemperature({
      lostAt: input.lostAt,
      lastInteractionAt: input.lastInteractionAt,
      createdAt: input.createdAt,
      now,
    }),
    fullWidth: !hasTemperaturePair,
  });
  push('sdr', 'SDR antigo', clean(input.previousSdrName));
  push('motivo', 'Motivo da perda', clean(input.lossReasonName));
  push('notas', 'Notas da perda', clean(input.lossNotes) ?? clean(input.enrollmentLossNotes), true);

  return {
    attemptLabel: `TENTATIVA ${input.stepOrder}/${input.totalSteps}`,
    name,
    company,
    fields,
    opening: suggestedOpening({
      firstName: input.firstName,
      segmento: input.segmento,
      lossReasonName: input.lossReasonName,
      stepOrder: input.stepOrder,
      totalSteps: input.totalSteps,
      callScript: input.callScript,
    }),
  };
}

/** Monta o cartão com o que a atividade já traz. SDR antigo fica de fora de propósito. */
export function leadCardFromActivity(activity: PendingActivity, email: string | null, now?: Date): LeadCardModel {
  const lead = activity.lead;
  return buildLeadCard({
    firstName: lead.primeiro_nome ?? lead.first_name,
    lastName: lead.last_name,
    nomeFantasia: lead.nome_fantasia,
    razaoSocial: lead.razao_social,
    telefone: lead.telefone,
    phones: lead.phones,
    jobTitle: lead.job_title,
    segmento: lead.segmento,
    cnpj: lead.cnpj,
    email,
    leadSource: lead.lead_source,
    canal: lead.canal,
    lostAt: lead.lost_at ?? null,
    lossReasonName: lead.loss_reason_name ?? null,
    lossNotes: lead.loss_notes ?? null,
    enrollmentLossNotes: lead.enrollment_loss_notes ?? null,
    previousSdrName: null,
    stepOrder: activity.stepOrder,
    totalSteps: activity.totalSteps,
    lastInteractionAt: lead.last_interaction_at ?? null,
    createdAt: lead.created_at,
    callScript: activity.callScript,
    now,
  });
}
