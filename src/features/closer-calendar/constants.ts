/** Flag por org. enabled false e listas vazias = desligada. Nao marcar enabled true. */
export const CLOSER_CALENDAR_CONNECT_FLAG = 'closer_calendar_connect';

export const CLOSER_CALENDAR_INVITE_DAYS = 7;

/** Janela do handshake OAuth depois que o closer clica em conectar. */
export const CLOSER_CALENDAR_STATE_MINUTES = 15;

/**
 * So agenda. O evento continua sendo criado na agenda do SDR, que e o
 * organizador. O closer entra como convidado. Nada de Gmail.
 */
export const CLOSER_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

export const CLOSER_CALENDAR_CALLBACK_PATH = '/api/auth/callback/closer-calendar';
