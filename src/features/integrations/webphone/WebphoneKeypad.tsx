'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Volume2, VolumeX } from 'lucide-react';

import { playKeypadBeep, readKeypadSound, writeKeypadSound } from './webphone-keypad-sound';
import { sendDtmf, type DtmfTone } from './webphone-client';

const PRESSED_MS = 150;
const FAILED_MS = 4000;

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
  const [pressed, setPressed] = useState<DtmfTone | null>(null);
  const [failed, setFailed] = useState<DtmfTone | null>(null);
  const [soundOn, setSoundOn] = useState(readKeypadSound);
  const soundRef = useRef(soundOn);
  const pressedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const failedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const press = useCallback((tone: DtmfTone) => {
    const result = sendDtmf(tone);
    if (result !== null) setSent((prev) => [...prev, tone]);
    if (soundRef.current) playKeypadBeep(result !== null ? 'ok' : 'fail');
    setPressed(tone);
    clearTimeout(pressedTimer.current);
    pressedTimer.current = setTimeout(() => setPressed(null), PRESSED_MS);
    if (result === null) {
      setFailed(tone);
      clearTimeout(failedTimer.current);
      failedTimer.current = setTimeout(() => setFailed(null), FAILED_MS);
    }
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (!/^[0-9*#]$/.test(event.key) || isEditableTarget(event.target)) return;
      press(event.key as DtmfTone);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [press]);

  useEffect(
    () => () => {
      clearTimeout(pressedTimer.current);
      clearTimeout(failedTimer.current);
    },
    [],
  );

  function toggleSound() {
    const next = !soundOn;
    soundRef.current = next;
    setSoundOn(next);
    writeKeypadSound(next);
  }

  return (
    <div id="webphone-keypad" className="space-y-1.5" data-testid="webphone-keypad">
      <div className="flex justify-end">
        <button
          type="button"
          aria-label="Som do teclado"
          aria-pressed={soundOn}
          data-testid="webphone-keypad-sound"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={toggleSound}
          className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          {soundOn ? <Volume2 className="h-3.5 w-3.5" aria-hidden="true" /> : <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      </div>
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
            data-pressed={pressed === tone ? 'true' : undefined}
            className={`h-8 rounded-md border text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none motion-reduce:transition-none ${
              pressed === tone
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'bg-[var(--card)] hover:bg-[var(--accent)]'
            }`}
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
      {failed !== null && (
        <p
          className="text-xs font-medium text-[var(--destructive)]"
          role="alert"
          data-testid="webphone-keypad-error"
        >
          {`Não consegui enviar a tecla ${failed}`}
        </p>
      )}
    </div>
  );
}
