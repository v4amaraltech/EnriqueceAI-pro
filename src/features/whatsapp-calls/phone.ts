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
 *  - Nono dígito: celular salvo sem o 9 (assinante de 8 dígitos começando em
 *    6-9) recebe o 9 → 13 dígitos. Fixos (assinante 2-5) ficam com 12.
 *  - Outros tamanhos: devolve os dígitos como vieram (defensivo).
 *
 * NOTA (WhatsApp): números MUITO antigos podem estar registrados no WhatsApp com
 * um JID SEM o nono dígito. Inserir o 9 é o correto para a esmagadora maioria dos
 * números atuais; o descasamento de JID de números legados é limitação do próprio
 * WhatsApp, resolvida no lado do serviço de voz, não aqui.
 */
export function toE164BR(phone: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return '';

  let e164: string;
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    e164 = digits;
  } else if (digits.length === 10 || digits.length === 11) {
    e164 = `55${digits}`;
  } else {
    return digits; // tamanho inesperado — defensivo
  }

  return ensureBrazilianNinthDigit(e164);
}

/**
 * Insere o nono dígito quando o assinante tem 8 dígitos e começa em 6-9 (faixa
 * de celular). Idempotente: números já com 13 dígitos ou fixos passam intactos.
 */
function ensureBrazilianNinthDigit(e164: string): string {
  if (e164.length !== 12) return e164; // 13 (já com 9) ou não-BR: nada a fazer
  const ddd = e164.slice(2, 4);
  const subscriber = e164.slice(4); // 8 dígitos
  return /^[6-9]/.test(subscriber) ? `55${ddd}9${subscriber}` : e164;
}
