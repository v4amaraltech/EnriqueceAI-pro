/**
 * Normaliza um telefone brasileiro para E.164 (só dígitos, com DDI 55).
 *
 * Necessário porque a origem do número varia: telefones de sócio já vêm como
 * `55 + DDD + número`, mas os de `lead.telefone`/`lead.phones` chegam sem o 55
 * (é a chave de dedupe). O serviço de voz (WhatsApp) só roteia com o DDI, então
 * padronizamos aqui, de forma idempotente, antes de discar.
 *
 * Regras:
 *  - Já em E.164 BR (55 + 10/11 dígitos = 12 ou 13 no total): mantém.
 *  - Local (DDD + número = 10 ou 11 dígitos): prefixa 55.
 *  - Outros tamanhos: devolve os dígitos como vieram (defensivo).
 */
export function toE164BR(phone: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}
