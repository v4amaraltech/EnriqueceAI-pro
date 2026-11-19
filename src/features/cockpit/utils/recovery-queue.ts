/**
 * Fila "Recuperação de perdidos" do motor (M-5, A-D4, A-D5, D-14). Constantes e tipos PUROS.
 * A ordem vem do SQL (`cockpit_recovery_candidates`: perda mais recente primeiro); o servidor do motor aplica
 * o MESMO portão da fila normal (janela, feriado, teto, dono, bloqueios, 3/dia, 1 h, conversa hoje, retorno).
 */
export type AutoDialQueue = 'normal' | 'recovery';
export const DEFAULT_AUTO_DIAL_QUEUE: AutoDialQueue = 'normal';

/**
 * Motivos de perda em que NUNCA se retoma o contato (D2): o motor não liga nas DUAS filas (normal e recuperação) e o
 * cartão do lead mostra "restrição". Nomes exatos de `loss_reasons` (a comparação ignora caixa e acento).
 */
export const NO_RESUME_REASON_NAMES: readonly string[] = ['Blocklist', 'SPAM', 'Adolescente/Criança'];

export function normalizeReasonName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** O motivo de perda é de "não retomar" (blocklist, spam, adolescente/criança)? */
export function isNoResumeReason(name: string | null | undefined): boolean {
  if (!name) return false;
  const key = normalizeReasonName(name);
  return NO_RESUME_REASON_NAMES.some((n) => normalizeReasonName(n) === key);
}

/**
 * Motivos de perda que NUNCA entram na recuperação (A-D5 + decisão do usuário de 16/11 + decisão de 19/11: "Não ICP",
 * "Contatos inválidos" e "Serviço fora de escopo"), comparados pelo NOME em `loss_reasons` da própria org. O SQL
 * (`lr.name <> ALL(p_blocked_reason_names)`) e o portão do TypeScript (`includes`) comparam o texto EXATO, com acento
 * e caixa: estes nomes precisam ser idênticos aos de `loss_reasons`. O TypeScript passa a lista ao SQL e o portão a
 * confere de novo na hora de discar. Valem SÓ na recuperação (a fila normal segue ligando). "Cliente" e "Cliente
 * oculto" NÃO estão aqui de propósito.
 */
export const RECOVERY_BLOCKED_REASON_NAMES: readonly string[] = [
  ...NO_RESUME_REASON_NAMES,
  'Ex-cliente (detrator)',
  'Duplicado',
  'Engano/Não Lembra',
  'Pessoa Física',
  'Desqualificado pelo closer',
  'Não ICP',
  'Contatos inválidos',
  'Serviço fora de escopo',
];

/** Linhas pedidas à função SQL (a mais recente primeiro). */
export const RECOVERY_QUEUE_LIMIT = 1000;

/** Motivo "Sem interesse": o lead fica FORA da recuperação por `SEM_INTERESSE_COOLDOWN_DAYS` dias (decisão do usuário, 17/11). */
export const SEM_INTERESSE_REASON_NAME = 'Sem interesse';
export const SEM_INTERESSE_COOLDOWN_DAYS = 90;

/** O motivo de perda é "Sem interesse"? (ignora caixa e acento) */
export function isSemInteresseReason(name: string | null | undefined): boolean {
  return Boolean(name) && normalizeReasonName(name as string) === normalizeReasonName(SEM_INTERESSE_REASON_NAME);
}

/** Início da janela de 90 dias: a perda "Sem interesse" feita a partir daqui ainda está em quarentena. */
export function semInteresseCooldownCutoff(now: Date): Date {
  return new Date(now.getTime() - SEM_INTERESSE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
}
