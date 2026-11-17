'use client';

import { useEffect, useState } from 'react';

import { sendDtmf, type DtmfTone } from './webphone-client';

const KEYS: DtmfTone[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

function keyName(tone: DtmfTone): string {
  if (tone === '*') return 'star';
  if (tone === '#') return 'hash';
  return tone;
}

function keyLabel(tone: DtmfTone): string {
  if (tone === '*') return 'Tecla asterisco';
  if (tone === '#') return 'Tecla sustenido';
  return `Tecla ${tone}`;
}

/** Atalho do teclado físico não vale em campo de texto (digitar nas Anotações não manda tom). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

/**
 * Teclado numérico (DTMF) da ligação em curso, para navegar em URA. Só chama `sendDtmf`: não desliga,
 * não agenda e não mexe no motor. Monte com `key` da ligação para zerar o eco a cada ligação nova.
 */
export function WebphoneKeypad() {
  const [sent, setSent] = useState<DtmfTone[]>([]);

  function press(tone: DtmfTone) {
    if (sendDtmf(tone) !== null) setSent((prev) => [...prev, tone]);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (!/^[0-9*#]$/.test(event.key) || isEditableTarget(event.target)) return;
      if (sendDtmf(event.key as DtmfTone) !== null) setSent((prev) => [...prev, event.key as DtmfTone]);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div id="webphone-keypad" className="space-y-1.5" data-testid="webphone-keypad">
      <div className="grid grid-cols-3 gap-1">
        {KEYS.map((tone) => (
          <button
            key={tone}
            type="button"
            aria-label={keyLabel(tone)}
            data-testid={`webphone-key-${keyName(tone)}`}
            // O painel é arrastável (PointerSensor): o clique na tecla não pode virar arrasto.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => press(tone)}
            className="h-8 rounded-md border bg-[var(--card)] text-sm font-medium hover:bg-[var(--accent)]"
          >
            {tone}
          </button>
        ))}
      </div>
      <p
        className="min-h-4 truncate text-xs text-[var(--muted-foreground)]"
        aria-live="polite"
        data-testid="webphone-keypad-sent"
      >
        {sent.length > 0 ? `Enviado: ${sent.join(' ')}` : ''}
      </p>
    </div>
  );
}
