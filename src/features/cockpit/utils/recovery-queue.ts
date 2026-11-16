/**
 * Fila "Recuperação de perdidos" do motor (M-5, A-D4, A-D5, D-14). Constantes e tipos PUROS.
 * A ordem vem do SQL (`cockpit_recovery_candidates`: perda mais recente primeiro); o servidor do motor aplica
 * o MESMO portão da fila normal (janela, feriado, teto, dono, bloqueios, 3/dia, 1 h, conversa hoje, retorno).
 */
export type AutoDialQueue = 'normal' | 'recovery';
export const DEFAULT_AUTO_DIAL_QUEUE: AutoDialQueue = 'normal';

/**
 * Motivos de perda que NUNCA entram na recuperação (A-D5 + decisão do usuário de 16/11), comparados pelo NOME em
 * `loss_reasons` da própria org. Mesma lista do padrão da função SQL; o TypeScript a passa explicitamente e o portão
 * a confere de novo na hora de discar. "Cliente" e "Cliente oculto" NÃO estão aqui de propósito.
 */
export const RECOVERY_BLOCKED_REASON_NAMES: readonly string[] = [
  'Blocklist',
  'Adolescente/Criança',
  'Ex-cliente (detrator)',
  'Duplicado',
  'Engano/Não Lembra',
  'Pessoa Física',
  'Desqualificado pelo closer',
];

/** Linhas pedidas à função SQL (a mais recente primeiro). */
export const RECOVERY_QUEUE_LIMIT = 1000;
