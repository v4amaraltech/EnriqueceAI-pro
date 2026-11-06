// Posição do painel flutuante do webphone. Módulo PURO: recebe o `Storage`
// e as medidas como argumento, então é testável sem DOM.
//
// A posição é o canto superior esquerdo do painel em px da viewport. `null`
// significa "nunca foi arrastado": o painel fica no canto inferior esquerdo
// por CSS (os toasts do sonner vivem no canto inferior DIREITO).

export interface PanelPosition {
  x: number;
  y: number;
}

export interface PanelSize {
  width: number;
  height: number;
}

export const WEBPHONE_PANEL_POSITION_KEY = 'enriqueceai.webphone.panel-position.v1';

/** Margem mínima até a borda da viewport, para o painel nunca sumir. */
export const PANEL_VIEWPORT_MARGIN = 8;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Converte o JSON salvo em posição; qualquer coisa inválida vira `null`. */
export function parsePanelPosition(raw: string | null | undefined): PanelPosition | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { x, y } = parsed as Record<string, unknown>;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
    return { x: Math.round(x), y: Math.round(y) };
  } catch {
    return null;
  }
}

/** Lê a posição lembrada. `localStorage` pode não existir ou lançar (modo privado, cota): devolve `null`. */
export function loadPanelPosition(storage: StorageLike | null | undefined): PanelPosition | null {
  if (!storage) return null;
  try {
    return parsePanelPosition(storage.getItem(WEBPHONE_PANEL_POSITION_KEY));
  } catch {
    return null;
  }
}

/** Grava a posição (ou apaga, com `null`). Falha em silêncio. */
export function savePanelPosition(storage: StorageLike | null | undefined, position: PanelPosition | null): void {
  if (!storage) return;
  try {
    if (position) storage.setItem(WEBPHONE_PANEL_POSITION_KEY, JSON.stringify(position));
    else storage.removeItem(WEBPHONE_PANEL_POSITION_KEY);
  } catch {
    /* ignore */
  }
}

/** Mantém o painel inteiro dentro da viewport (com margem). Viewport menor que o painel: encosta à esquerda/topo. */
export function clampPanelPosition(
  position: PanelPosition,
  size: PanelSize,
  viewport: PanelSize,
  margin: number = PANEL_VIEWPORT_MARGIN,
): PanelPosition {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - size.height - margin);
  return {
    x: Math.round(Math.min(Math.max(position.x, margin), maxX)),
    y: Math.round(Math.min(Math.max(position.y, margin), maxY)),
  };
}

/** Aplica o deslocamento de um arrasto e já limita à viewport. */
export function movePanelPosition(
  current: PanelPosition,
  delta: { x: number; y: number },
  size: PanelSize,
  viewport: PanelSize,
  margin: number = PANEL_VIEWPORT_MARGIN,
): PanelPosition {
  return clampPanelPosition({ x: current.x + delta.x, y: current.y + delta.y }, size, viewport, margin);
}
