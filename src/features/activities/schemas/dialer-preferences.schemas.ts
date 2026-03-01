import { z } from 'zod';

export const dialerPreferencesSchema = z.object({
  simultaneous_phones: z
    .number()
    .int()
    .min(2, 'Mínimo 2 leads')
    .max(4, 'Máximo 4 leads'),
  daily_limit_per_lead: z
    .number()
    .int()
    .min(1, 'Mínimo 1 tentativa')
    .max(10, 'Máximo 10 tentativas'),
});

export type DialerPreferencesInput = z.infer<typeof dialerPreferencesSchema>;

export interface DialerPreferences {
  simultaneous_phones: number;
  daily_limit_per_lead: number;
}

export interface DialerStats {
  leadsWithoutPhone: number;
  leadsAtDailyLimit: number;
  leadsWithSnooze: number;
  totalAvailable: number;
}
