import { BR_NATIONAL_HOLIDAYS, brtDateKey } from '@/lib/utils/br-holidays';

import { AUTO_DIAL_RULES, brtStartOfDay, effectiveDailyCap, isWithinDialWindow } from './auto-dial-rules';

/**
 * "Ligar depois" do motor (PR-6): horários prontos e validação do retorno. Módulo PURO, tudo em BRT (UTC-3 fixo,
 * sem horário de verão), `now` sempre explícito. A janela e os feriados são os do motor (`auto-dial-rules.ts`).
 */

/** Um retorno marcado para antes disso seria consumido pela própria ligação em curso e nunca voltaria. */
export const CALLBACK_MIN_LEAD_MS = 10 * 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const TODAY_HOUR = 16;
const NEXT_DAY_HOUR = 9;

export type CallbackShortcutId = 'in-1h' | 'today-16h' | 'next-business-day-9h';

export interface CallbackShortcut {
  id: CallbackShortcutId;
  label: string;
  at: Date;
}

type Holidays = ReadonlySet<string> | readonly string[];

function holidaySet(holidays: Holidays | undefined): ReadonlySet<string> {
  if (!holidays) return new Set(Object.keys(BR_NATIONAL_HOLIDAYS));
  return holidays instanceof Set ? holidays : new Set(holidays);
}

/** 00:00 BRT (ms) do dia seguinte que seja útil (seg–sex e fora de feriado), a partir do dia de `now`. */
function nextBusinessDayStart(now: Date, holidays: ReadonlySet<string>): number {
  const today = brtStartOfDay(now);
  for (let d = 1; d <= 14; d++) {
    const start = today + d * DAY_MS;
    const key = brtDateKey(new Date(start));
    const dow = new Date(`${key}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(key)) return start;
  }
  return today + DAY_MS;
}

/** Atalhos: "Em 1 hora"; "Hoje 16h" (só se ainda dá com a folga mínima); "Amanhã 9h" (próximo dia útil). */
export function callbackShortcuts(now: Date, holidays?: Holidays): CallbackShortcut[] {
  const list = holidaySet(holidays);
  const out: CallbackShortcut[] = [{ id: 'in-1h', label: 'Em 1 hora', at: new Date(now.getTime() + HOUR_MS) }];
  const today16 = new Date(brtStartOfDay(now) + TODAY_HOUR * HOUR_MS);
  if (today16.getTime() >= now.getTime() + CALLBACK_MIN_LEAD_MS) out.push({ id: 'today-16h', label: 'Hoje 16h', at: today16 });
  const nextStart = nextBusinessDayStart(now, list);
  const isTomorrow = nextStart === brtStartOfDay(now) + DAY_MS;
  out.push({
    id: 'next-business-day-9h',
    label: isTomorrow ? 'Amanhã 9h' : 'Próximo dia útil 9h',
    at: new Date(nextStart + NEXT_DAY_HOUR * HOUR_MS),
  });
  return out;
}

export type CallbackValidation = { ok: true } | { ok: false; error: string };

/** Válido só com pelo menos 10 min de folga: um horário no passado seria consumido pela ligação atual. */
export function validateCallbackAt(at: Date, now: Date): CallbackValidation {
  if (Number.isNaN(at.getTime())) return { ok: false, error: 'Escolha um horário válido.' };
  if (at.getTime() < now.getTime() + CALLBACK_MIN_LEAD_MS) {
    return { ok: false, error: 'Escolha um horário com pelo menos 10 minutos de folga.' };
  }
  return { ok: true };
}

export interface CallbackContext {
  now: Date;
  /** Ligações do lead hoje (qualquer origem), contando a atual. */
  attemptsToday: number;
  holidays?: Holidays;
}

/** Avisos (não bloqueiam) sobre quando o motor de fato liga. */
export function callbackWarnings(at: Date, ctx: CallbackContext): string[] {
  const warnings: string[] = [];
  if (!isWithinDialWindow(at, holidaySet(ctx.holidays)).allowed) {
    warnings.push('Fora do horário da discagem (seg–sex, 8h–20h) ou feriado: a discagem liga no próximo horário útil.');
  }
  // As 3 tentativas valem por dia: só pesa se o retorno cai no mesmo dia de hoje.
  const sameDay = brtDateKey(at) === brtDateKey(ctx.now);
  if (sameDay && ctx.attemptsToday >= AUTO_DIAL_RULES.maxAttemptsPerDay) {
    warnings.push(
      `Este lead já teve ${AUTO_DIAL_RULES.maxAttemptsPerDay} tentativas hoje: o retorno fura o intervalo de 1 h e o "atendido hoje", mas não as ${AUTO_DIAL_RULES.maxAttemptsPerDay} tentativas nem o teto de ${effectiveDailyCap()} da discagem, então a discagem liga amanhã.`,
    );
  }
  return warnings;
}
