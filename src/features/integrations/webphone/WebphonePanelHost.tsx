'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';

import { getWebphonePanelHost, registerWebphonePanelHost, subscribeWebphonePanelHost } from './webphone-panel-host';

/**
 * Encaixe do painel flutuante do webphone dentro de uma gaveta/modal que cobre
 * a tela. Colocar como filho direto do conteúdo do Radix (ex.: `SheetContent`)
 * para que cliques, foco e arrasto no painel contem como "dentro" da gaveta.
 * Não ocupa espaço: o painel é `position: fixed`.
 */
export function WebphonePanelHost() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    return registerWebphonePanelHost(ref.current);
  }, []);
  return <div ref={ref} data-webphone-panel-host className="contents" />;
}

/** Encaixe ativo, ou `null` quando o painel deve ficar no layout. */
export function useWebphonePanelHost(): HTMLElement | null {
  return useSyncExternalStore(subscribeWebphonePanelHost, getWebphonePanelHost, () => null);
}
