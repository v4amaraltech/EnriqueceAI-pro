/**
 * Strip all non-digit characters from a phone number string.
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}
