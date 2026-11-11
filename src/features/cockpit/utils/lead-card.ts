import type { PendingActivity } from '@/features/activities/types';

const MONTH_MS = 30.4375 * 24 * 60 * 60 * 1000;

/**
 * Rótulo quente, morno ou frio. A regra ainda não foi definida, então o
 * cartão não mostra essa parte. Não inventar uma classificação aqui.
 */
export function leadTemperatureLabel(): null {
  return null;
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

export function openingLine(reasonName: string | null | undefined, firstName: string | null | undefined): string | null {
  const body = OPENING_BODY[normalizeReason(reasonName) ?? ''];
  if (!body) return null;
  const name = clean(firstName);
  if (!name) return body.charAt(0).toLocaleUpperCase('pt-BR') + body.slice(1);
  return `${name}, ${body}`;
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
  opening: string | null;
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

  const temperature = leadTemperatureLabel();
  const lost = formatLostAgo(input.lostAt, now);
  const temperatura = [temperature, lost].filter(Boolean).join(' · ');
  push('temperatura', 'Temperatura', temperatura || null);
  push('sdr', 'SDR antigo', clean(input.previousSdrName));
  push('motivo', 'Motivo da perda', clean(input.lossReasonName));
  push('notas', 'Notas da perda', clean(input.lossNotes) ?? clean(input.enrollmentLossNotes), true);

  return {
    attemptLabel: `TENTATIVA ${input.stepOrder}/${input.totalSteps}`,
    name,
    company,
    fields,
    opening: openingLine(input.lossReasonName, input.firstName),
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
    now,
  });
}
