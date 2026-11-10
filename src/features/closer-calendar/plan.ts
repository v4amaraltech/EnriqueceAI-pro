import { chooseCalendarSource, type AvailabilitySource } from '@/features/meetings/closer-availability.logic';

export type CloserCalendarReadPlan = 'own' | 'platform' | 'sdr' | 'none';

/**
 * Conexão própria do closer (convite) tem prioridade. Sem ela, vale o plano
 * de hoje: token de usuário da plataforma, senão o Google do SDR.
 */
export function calendarReadPlan(input: {
  ownConnected: boolean;
  closerUserId: string | null;
  closerHasPlatformConnection: boolean;
  sdrHasConnection: boolean;
}): CloserCalendarReadPlan {
  if (input.ownConnected) return 'own';
  const source: AvailabilitySource = chooseCalendarSource({
    closerUserId: input.closerUserId,
    closerHasConnection: input.closerHasPlatformConnection,
    sdrHasConnection: input.sdrHasConnection,
  });
  if (source === 'closer_token') return 'platform';
  if (source === 'sdr_token') return 'sdr';
  return 'none';
}
