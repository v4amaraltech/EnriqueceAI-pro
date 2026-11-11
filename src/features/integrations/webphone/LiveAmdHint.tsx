import type { LiveAmdView } from './live-amd-session';

export function liveAmdPredictionLabel(prediction: string): string | null {
  switch (prediction) {
    case 'human':
      return 'Atendeu';
    case 'no_answer':
      return 'Não atendeu';
    case 'voicemail':
      return 'Caixa postal';
    case 'number_not_exist':
      return 'Número não existe';
    default:
      return null;
  }
}

export function nextActivityLabel(suggestion: string): string | null {
  switch (suggestion) {
    case 'schedule_meeting':
      return 'Marcar reunião';
    case 'schedule_callback':
      return 'Marcar retorno';
    case 'not_connected':
      return 'Não conectou';
    default:
      return null;
  }
}

/** Sugestão só de leitura. Não preenche desfecho, não cria atividade e não agenda. */
export function LiveAmdHint({ view }: { view: LiveAmdView | null }) {
  const prediction = view ? liveAmdPredictionLabel(view.prediction) : null;
  const next = view?.nextActivity ? nextActivityLabel(view.nextActivity) : null;
  if (!prediction && !next) return null;
  return (
    <p className="rounded-md bg-[var(--muted)] px-2 py-1.5 text-xs" role="status" data-testid="live-amd-suggestion">
      {prediction ? `Sugestão: ${prediction}.` : null}
      {next ? ` Próxima atividade: ${next}.` : null} Só uma sugestão. O desfecho não muda sozinho.
    </p>
  );
}
