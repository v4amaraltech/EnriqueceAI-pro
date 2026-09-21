/**
 * BDR-1 — Regra pura da fonte central de bloqueios (plano §1 e §7.5).
 *
 * O V4 Call consulta o Enriquece imediatamente antes de submeter a ligação à
 * Twilio e lê `bloqueado_total` e `bloqueado_prospeccao` como booleanos; se
 * qualquer um vier ausente ou não-booleano ele trata como "fonte ambígua" e
 * AGUARDA (503). Por isso os três campos são sempre booleanos aqui.
 *
 * Finalidades (contact_holds.tipo):
 *   total       → recusa/opt-out: nada mais sai (ligação, e-mail frio, conversa)
 *   prospeccao  → lead respondeu / reunião marcada: cadência fria para, conversa continua
 *   conversa    → humano assumiu: IA não responde; a cadência fria já parou antes
 */
export type HoldTipo = 'prospeccao' | 'conversa' | 'total';

export interface HoldRow { lead_id: string; tipo: string; origem?: string | null; created_at?: string | null }

export interface HoldFlags {
  bloqueado_total: boolean;
  bloqueado_prospeccao: boolean;
  bloqueado_conversa: boolean;
}

export function resolveHoldFlags(holds: HoldRow[]): HoldFlags {
  const tipos = new Set(holds.map((h) => h.tipo));
  const total = tipos.has('total');
  return {
    bloqueado_total: total,
    // total implica as outras duas: quem recusou não recebe prospecção nem conversa
    bloqueado_prospeccao: total || tipos.has('prospeccao'),
    bloqueado_conversa: total || tipos.has('conversa'),
  };
}

/** Só dígitos; aceita "+55 (16) 99986-7577", "5516999867577", "16999867577". */
export function phoneDigits(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '');
}

/** Mínimo para casar com segurança: DDD + número (10 ou 11 dígitos), com ou sem 55. */
export function isQueryablePhone(digits: string): boolean {
  return digits.length >= 10 && digits.length <= 14;
}
