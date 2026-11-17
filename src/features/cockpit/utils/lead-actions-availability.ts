/**
 * Quais das três ações do lead (Agendar reunião, Ligar depois, Desqualificar) fazem sentido para o status dele.
 * Módulo PURO, usado pelo painel do lead e pelo bloco "O lead conversou" (mesma regra nos dois).
 *
 *  - `won` e `archived`: nenhuma (nem entram na fila do motor);
 *  - `unqualified` (já perdido): as três, mas a terceira vira "Mudar motivo de perda" (o SDR pode ouvir "sem interesse" de quem já
 *    estava perdido e precisa trocar o motivo para o lead não voltar na recuperação);
 *  - `qualified` (reunião já marcada): Agendar (remarcar) e Ligar depois; Desqualificar some, porque um clique não deve
 *    perder um lead que já tem reunião;
 *  - `new`/`contacted` e demais: as três ("Desqualificar").
 */
export interface LeadActionsAvailability {
  schedule: boolean;
  callback: boolean;
  disqualify: boolean;
  /** Texto curto do botão no painel. */
  disqualifyLabel: string;
  /** Texto do botão no bloco "O lead conversou". */
  disqualifyLongLabel: string;
  /** Apoio do botão no bloco "O lead conversou". */
  disqualifyHint: string;
}

const DISQUALIFY = { disqualifyLabel: 'Desqualificar', disqualifyLongLabel: 'Desqualificar lead', disqualifyHint: 'Pede o motivo e marca o lead como perdido.' };
const CHANGE_REASON = {
  disqualifyLabel: 'Mudar motivo de perda',
  disqualifyLongLabel: 'Mudar motivo de perda',
  disqualifyHint: 'O lead já está perdido: escolha o novo motivo.',
};

export function leadActionsAvailability(status: string): LeadActionsAvailability {
  if (status === 'won' || status === 'archived') return { schedule: false, callback: false, disqualify: false, ...DISQUALIFY };
  if (status === 'unqualified') return { schedule: true, callback: true, disqualify: true, ...CHANGE_REASON };
  if (status === 'qualified') return { schedule: true, callback: true, disqualify: false, ...DISQUALIFY };
  return { schedule: true, callback: true, disqualify: true, ...DISQUALIFY };
}
