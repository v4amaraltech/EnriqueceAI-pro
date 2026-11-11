/**
 * Cores fixas do cartão V4. O cartão não segue o tema do painel: fundo quase
 * preto, cabeçalho no vermelho da V4 e texto claro, para contrastar com a
 * superfície clara e com a escura. Os pares abaixo passam AA (4,5:1).
 */
export const LEAD_CARD_COLORS = {
  cardBackground: '#101014',
  headerBackground: '#d8151e',
  headerText: '#ffffff',
  badgeBackground: '#5c0c11',
  badgeText: '#ffffff',
  label: '#ff6b6b',
  value: '#ffffff',
  gridLine: '#5a5a5a',
  openingBackground: '#ffffff',
  openingText: '#1a1a1a',
  openingLabel: '#9b1b1b',
  openingBorder: '#d8151e',
} as const;

function channel(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** Contraste WCAG entre duas cores #rrggbb. */
export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

/** Pares de texto do cartão. Valem nos dois temas porque as cores não invertem. */
export const LEAD_CARD_TEXT_PAIRS: Array<{ name: string; foreground: string; background: string }> = [
  { name: 'cabeçalho', foreground: LEAD_CARD_COLORS.headerText, background: LEAD_CARD_COLORS.headerBackground },
  { name: 'tentativa', foreground: LEAD_CARD_COLORS.badgeText, background: LEAD_CARD_COLORS.badgeBackground },
  { name: 'rótulo', foreground: LEAD_CARD_COLORS.label, background: LEAD_CARD_COLORS.cardBackground },
  { name: 'valor', foreground: LEAD_CARD_COLORS.value, background: LEAD_CARD_COLORS.cardBackground },
  { name: 'abertura', foreground: LEAD_CARD_COLORS.openingText, background: LEAD_CARD_COLORS.openingBackground },
  { name: 'rótulo da abertura', foreground: LEAD_CARD_COLORS.openingLabel, background: LEAD_CARD_COLORS.openingBackground },
];
