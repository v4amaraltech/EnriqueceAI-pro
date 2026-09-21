/** BDR-5 — regras puras de admissão: capacidade futura por caixa, compromissos projetados, reserva para conversas. */

export const RAMPA_SEMANAL = [10, 40, 80]; // semana 1, 2, 3+ desde a conexão da caixa
export const RESERVA_CONVERSAS = 0.3;

const BRT = -3 * 3600000;

export function dataBrt(d: Date): string {
  const s = new Date(d.getTime() + BRT);
  return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, '0')}-${String(s.getUTCDate()).padStart(2, '0')}`;
}

export function diasUteis(n: number, apartirDe: Date, holidays: string[] = []): string[] {
  const out: string[] = [];
  const d = new Date(apartirDe.getTime());
  const hol = new Set(holidays);
  while (out.length < n) {
    const s = new Date(d.getTime() + BRT);
    const dow = s.getUTCDay();
    const iso = dataBrt(d);
    if (dow !== 0 && dow !== 6 && !hol.has(iso)) out.push(iso);
    d.setTime(d.getTime() + 86400000);
  }
  return out;
}

/** Teto efetivo da caixa: explícito (`daily_cap`) ou rampa pela idade da conexão. Pausada = 0. */
export function effectiveDailyCap({ dailyCap, connectedAt, pausedReason, now }: {
  dailyCap: number | null; connectedAt: string | Date | null; pausedReason: string | null; now: Date;
}): number {
  if (pausedReason) return 0;
  if (dailyCap != null && dailyCap >= 0) return dailyCap;
  if (!connectedAt) return RAMPA_SEMANAL[0]!;
  const semanas = Math.floor((now.getTime() - new Date(connectedAt).getTime()) / (7 * 86400000));
  return RAMPA_SEMANAL[Math.min(semanas, RAMPA_SEMANAL.length - 1)]!;
}

export interface StepDelay { step_order: number; delay_days: number; channel: string }

/**
 * Projeta, por dia útil, quantos e-mails as inscrições ativas ainda vão gerar:
 * o próximo passo cai em `next_step_due`; os seguintes somam `delay_days`.
 */
export function projectCommitments({ enrollments, stepsByCadence, dias }: {
  enrollments: Array<{ cadence_id: string; current_step: number; next_step_due: string | null }>;
  stepsByCadence: Map<string, StepDelay[]>;
  dias: string[];
}): Map<string, number> {
  const idx = new Map(dias.map((d, i) => [d, i]));
  const out = new Map(dias.map((d) => [d, 0]));
  const dayList = dias;
  for (const e of enrollments) {
    const steps = (stepsByCadence.get(e.cadence_id) ?? []).filter((s) => s.step_order >= e.current_step && s.channel === 'email').sort((a, b) => a.step_order - b.step_order);
    if (!steps.length || !e.next_step_due) continue;
    let dia = dataBrt(new Date(e.next_step_due));
    let pos = idx.get(dia);
    if (pos == null) { const first = dayList.findIndex((d) => d >= dia); if (first < 0) continue; pos = first; dia = dayList[first]!; }
    let first = true;
    for (const s of steps) {
      if (!first) pos += Math.max(0, s.delay_days);
      first = false;
      if (pos >= dayList.length) break;
      const k = dayList[pos]!;
      out.set(k, (out.get(k) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * Quantos contatos novos cabem hoje: cada contato admitido adiciona um e-mail
 * em cada offset da cadência; admite N tal que, para todo offset k,
 * comprometido[dia_k] + N ≤ teto[dia_k] × (1 − reserva).
 */
export function admissibleCount({ dias, capPerDay, committed, offsets, reserva = RESERVA_CONVERSAS }: {
  dias: string[]; capPerDay: number; committed: Map<string, number>; offsets: number[]; reserva?: number;
}): { admissiveis: number; gargalo: string | null; porDia: Array<{ dia: string; teto: number; comprometidos: number; livre: number }> } {
  const porDia = dias.map((dia) => {
    const teto = Math.floor(capPerDay * (1 - reserva));
    const comprometidos = committed.get(dia) ?? 0;
    return { dia, teto, comprometidos, livre: Math.max(0, teto - comprometidos) };
  });
  let admissiveis = Infinity;
  let gargalo: string | null = null;
  for (const k of offsets) {
    const d = porDia[k];
    if (!d) continue;
    if (d.livre < admissiveis) { admissiveis = d.livre; gargalo = d.dia; }
  }
  return { admissiveis: Number.isFinite(admissiveis) ? admissiveis : 0, gargalo, porDia };
}

/** Chave de empresa para o teto de 2 contatos ativos: CNPJ raiz ou nome normalizado. */
export function companyKey({ cnpj, razaoSocial, nomeFantasia }: { cnpj?: string | null; razaoSocial?: string | null; nomeFantasia?: string | null }): string | null {
  const digits = (cnpj ?? '').replace(/\D/g, '');
  if (digits.length >= 8) return `cnpj:${digits.slice(0, 8)}`;
  const nome = (nomeFantasia || razaoSocial || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(ltda|s\/?a|me|epp|eireli|industria|comercio|de|do|da|e|alimentos)\b/g, '').replace(/[^a-z0-9]/g, '');
  return nome ? `nome:${nome}` : null;
}
