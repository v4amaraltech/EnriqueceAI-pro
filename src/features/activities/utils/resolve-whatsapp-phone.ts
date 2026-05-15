import type { ActivityLead } from '../types';

export interface ResolvedPhone {
  formatted: string;
  raw: string;
  label: string;
  source: 'socio_whatsapp' | 'socio_celular' | 'lead_telefone';
}

function formatPhone(ddd: number, numero: string): { formatted: string; raw: string } {
  const cleaned = numero.replace(/\D/g, '');
  return {
    formatted: `(${ddd}) ${cleaned}`,
    raw: `55${ddd}${cleaned}`,
  };
}

/**
 * Extracts all phone numbers from a lead, prioritizing:
 * 1. Sócio celulares with whatsapp: true (sorted by ranking)
 * 2. lead.phones entries flagged tipo='whatsapp'
 * 3. Sócio celulares without whatsapp flag (sorted by ranking)
 * 4. lead.phones entries flagged tipo='celular'
 * 5. lead.phones entries flagged tipo='fixo' / fallback to lead.telefone
 *
 * lead.phones was being ignored entirely, so leads with 6 numbers
 * stored in the JSONB column only ever showed the first one in the
 * WhatsApp activity composer — SDR couldn't pick alternates.
 */
export function getAllLeadPhones(lead: ActivityLead): ResolvedPhone[] {
  const phones: ResolvedPhone[] = [];
  const seen = new Set<string>();

  const whatsappPhones: Array<{ ddd: number; numero: string; ranking: number; socioNome: string }> = [];
  const otherPhones: Array<{ ddd: number; numero: string; ranking: number; socioNome: string }> = [];

  for (const socio of lead.socios ?? []) {
    for (const cel of socio.celulares ?? []) {
      if (cel.whatsapp) {
        whatsappPhones.push({ ...cel, socioNome: socio.nome });
      } else {
        otherPhones.push({ ...cel, socioNome: socio.nome });
      }
    }
  }

  whatsappPhones.sort((a, b) => a.ranking - b.ranking);
  otherPhones.sort((a, b) => a.ranking - b.ranking);

  for (const p of whatsappPhones) {
    const { formatted, raw } = formatPhone(p.ddd, p.numero);
    if (!seen.has(raw)) {
      seen.add(raw);
      phones.push({ formatted, raw, label: `${formatted} - ${p.socioNome} (WhatsApp)`, source: 'socio_whatsapp' });
    }
  }

  // Pull from lead.phones (JSONB column) — split by tipo so whatsapp entries
  // surface before plain celulares. These come pre-formatted as strings, so
  // we keep the display formatted value and use the digits-only as the dedup
  // key. The "+55" prefix some entries carry collapses to the same key.
  const phonesByTipo: Record<'whatsapp' | 'celular' | 'fixo', Array<{ formatted: string; raw: string }>> = {
    whatsapp: [],
    celular: [],
    fixo: [],
  };
  for (const lp of lead.phones ?? []) {
    const digits = (lp.numero ?? '').replace(/\D/g, '');
    if (!digits) continue;
    const formatted = lp.numero;
    // Normalize Brazil country-code prefix so "55..." and the local form
    // dedupe correctly against the same number from socios.
    const dedupKey = digits.startsWith('55') && digits.length > 10 ? digits.slice(2) : digits;
    phonesByTipo[lp.tipo].push({ formatted, raw: dedupKey });
  }

  for (const p of phonesByTipo.whatsapp) {
    if (!seen.has(p.raw)) {
      seen.add(p.raw);
      phones.push({ formatted: p.formatted, raw: p.raw, label: `${p.formatted} (WhatsApp)`, source: 'socio_whatsapp' });
    }
  }
  for (const p of otherPhones) {
    const { formatted, raw } = formatPhone(p.ddd, p.numero);
    if (!seen.has(raw)) {
      seen.add(raw);
      phones.push({ formatted, raw, label: `${formatted} - ${p.socioNome}`, source: 'socio_celular' });
    }
  }
  for (const p of phonesByTipo.celular) {
    if (!seen.has(p.raw)) {
      seen.add(p.raw);
      phones.push({ formatted: p.formatted, raw: p.raw, label: `${p.formatted} (Celular)`, source: 'socio_celular' });
    }
  }

  if (lead.telefone) {
    const cleaned = lead.telefone.replace(/\D/g, '');
    const dedupKey = cleaned.startsWith('55') && cleaned.length > 10 ? cleaned.slice(2) : cleaned;
    if (!seen.has(dedupKey)) {
      seen.add(dedupKey);
      phones.push({
        formatted: lead.telefone,
        raw: dedupKey,
        label: `${lead.telefone} (Fixo empresa)`,
        source: 'lead_telefone',
      });
    }
  }

  for (const p of phonesByTipo.fixo) {
    if (!seen.has(p.raw)) {
      seen.add(p.raw);
      phones.push({ formatted: p.formatted, raw: p.raw, label: `${p.formatted} (Fixo)`, source: 'lead_telefone' });
    }
  }

  return phones;
}

/**
 * Returns the best phone number for a lead, or null if none available.
 */
export function resolveWhatsAppPhone(lead: ActivityLead): ResolvedPhone | null {
  const phones = getAllLeadPhones(lead);
  return phones[0] ?? null;
}
