/**
 * Strip all non-digit characters from a phone number string. Also collapses
 * a duplicated Brazilian country code (`5555…`) that occasionally slipped in
 * via imports where the CSV had a literal "+55" appended to numbers that
 * already started with "55" — 13 leads in production ended up with 14-digit
 * phones like `55557199058397` which then failed to match in API4COM.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 14 && digits.startsWith('5555')) {
    return digits.slice(2);
  }
  return digits;
}
