/**
 * Abertura e clique "de verdade" em e-mail enviado.
 *
 * Filtros de segurança de e-mail corporativo (e alguns provedores) abrem o pixel e seguem os links
 * logo depois da entrega. Em 16/10/2026, 23% das aberturas registradas (210 de 919 em 90 dias) chegaram
 * menos de 30 s depois do envio, e o rastreio só criava o registro de abertura na PRIMEIRA vez — a
 * abertura do robô escondia a da pessoa. Para os sinais do BDR (ligar só para quem abriu e-mail,
 * WhatsApp só com sinal) só vale o que chega pelo menos ENGAJAMENTO_REAL_MIN_SEG depois do envio; a
 * data da primeira abertura/clique assim fica gravada no metadata da interaction `sent`.
 */
export const ENGAJAMENTO_REAL_MIN_SEG = 120;

export type CampoEngajamentoReal = 'aberto_real_em' | 'clicado_real_em';

/** Segundos entre o envio e agora; null quando a data de envio é inválida. */
export function segundosAposEnvio(enviadoEm: string | null | undefined, agora: Date = new Date()): number | null {
  if (!enviadoEm) return null;
  const t = Date.parse(enviadoEm);
  if (Number.isNaN(t)) return null;
  return Math.floor((agora.getTime() - t) / 1000);
}

/**
 * Campo a acrescentar no metadata do `sent` quando este evento conta como engajamento real e ainda
 * não há um registrado; null caso contrário (cedo demais, data inválida ou já marcado).
 */
export function marcaEngajamentoReal(
  metadata: Record<string, unknown> | null | undefined,
  campo: CampoEngajamentoReal,
  enviadoEm: string | null | undefined,
  agora: Date = new Date(),
): Record<CampoEngajamentoReal, string> | null {
  if (metadata && typeof metadata[campo] === 'string') return null;
  const seg = segundosAposEnvio(enviadoEm, agora);
  if (seg === null || seg < ENGAJAMENTO_REAL_MIN_SEG) return null;
  return { [campo]: agora.toISOString() } as Record<CampoEngajamentoReal, string>;
}
