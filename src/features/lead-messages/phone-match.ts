/** Formas locais (DDD + número) de um telefone BR, com e sem o nono dígito. */
export function brPhoneVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, '');
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  const forms = new Set<string>();
  if (local.length === 11) {
    forms.add(local);
    if (local[2] === '9') forms.add(local.slice(0, 2) + local.slice(3));
  } else if (local.length === 10 && /[6-9]/.test(local[2] ?? '')) {
    forms.add(local);
    forms.add(local.slice(0, 2) + '9' + local.slice(2));
  } else if (local.length === 10) {
    forms.add(local);
  }
  for (const form of [...forms]) forms.add(`55${form}`);
  return [...forms];
}

export function phoneDigits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}
