import { normalizePhone } from '@/lib/utils/phone';

/** "Indicou outra pessoa": validação e textos. Módulo PURO. */
export interface ReferralForm {
  name: string;
  phone: string;
  isWhatsApp: boolean;
  email: string;
  jobTitle: string;
}

export const EMPTY_REFERRAL: ReferralForm = { name: '', phone: '', isWhatsApp: true, email: '', jobTitle: '' };

export interface Referral {
  name: string;
  firstName: string;
  lastName: string | null;
  jobTitle: string | null;
  /** Só dígitos, completo (o SDR precisa dele). */
  phone: string | null;
  phoneType: 'whatsapp' | 'celular';
  email: string | null;
}

export function parseReferral(form: ReferralForm): { ok: true; data: Referral } | { ok: false; error: string } {
  const name = form.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Informe o nome de quem foi indicado.' };
  const typedPhone = form.phone.trim();
  const phone = normalizePhone(typedPhone);
  const email = form.email.trim();
  if (typedPhone && (phone.length < 10 || phone.length > 13)) return { ok: false, error: 'Telefone inválido: informe com DDD.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'E-mail inválido.' };
  if (!phone && !email) return { ok: false, error: 'Informe o telefone/WhatsApp ou o e-mail.' };
  const [firstName = name, ...rest] = name.split(' ');
  return {
    ok: true,
    data: {
      name,
      firstName,
      lastName: rest.join(' ') || null,
      jobTitle: form.jobTitle.trim() || null,
      phone: phone || null,
      phoneType: form.isWhatsApp ? 'whatsapp' : 'celular',
      email: email || null,
    },
  };
}

const who = (r: Referral) => (r.jobTitle ? `${r.name} (${r.jobTitle})` : r.name);

/** Linha que entra na anotação da ligação. */
export function referralCallNote(r: Referral): string {
  return [`Indicou ${who(r)}`, r.phone ? `tel ${r.phone}` : null, r.email].filter(Boolean).join(' – ');
}

/** Observação do retorno: o contato do indicado também fica à vista na tarefa. */
export function referralReturnNote(r: Referral): string {
  return [`Retorno com ${who(r)}`, r.phone ? `tel ${r.phone}` : r.email].filter(Boolean).join(' – ');
}

/** Junta a linha à anotação existente sem repetir. */
export function appendNoteLine(current: string, line: string): string {
  const text = current.trim();
  if (text.includes(line)) return text;
  return text ? `${text}\n${line}` : line;
}
