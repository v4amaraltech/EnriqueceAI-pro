const BRT = 'America/Sao_Paulo';

/**
 * Texto persistido do lembrete de retorno.
 * A janela do cron continua sendo "até 30 min", mas o título diz os minutos
 * que faltam de verdade. O relógio é sempre America/Sao_Paulo: o processo do
 * cron roda em UTC e `toLocaleTimeString` sem fuso grava 20:30 no lugar de 17:30.
 */
export function activityReminderCopy(input: {
  leadName: string;
  channelLabel: string;
  scheduledAt: string;
  now: Date;
}): { title: string; body: string } {
  const start = new Date(input.scheduledAt);
  const minutes = Math.round((start.getTime() - input.now.getTime()) / 60_000);
  const when = minutes <= 0 ? 'agora' : `em ${minutes}min`;
  const clock = new Intl.DateTimeFormat('pt-BR', {
    timeZone: BRT,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(start);

  return {
    title: `Atividade ${when}: ${input.channelLabel}`,
    body: `${input.leadName} — agendada para ${clock}`,
  };
}
