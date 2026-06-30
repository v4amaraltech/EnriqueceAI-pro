const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True quando `value` é um UUID canônico (qualquer versão), case-insensitive. */
export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}
