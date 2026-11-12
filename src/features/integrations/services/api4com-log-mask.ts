/**
 * Número discado (`called` do webhook da API4COM) para log: só os 4 últimos
 * dígitos (`****9122`). O log é texto aberto; o número completo é dado pessoal
 * do lead e não pode ir em claro. Valor vazio ou curto vira só a máscara,
 * para não vazar um número parcial nem quebrar o log.
 */
export function maskCalledForLog(called: string | null | undefined): string {
  const digits = typeof called === 'string' ? called.replace(/\D/g, '') : '';
  if (!digits) return '(vazio)';
  // Com 8 dígitos ou menos, mostrar 4 seria revelar metade do número.
  if (digits.length <= 8) return '****';
  return `****${digits.slice(-4)}`;
}
