'use client';

import { QRCodeSVG } from 'qrcode.react';

/**
 * Renderiza uma string (ex.: o payload `wa.me/...` de "conectar dispositivo" do
 * WhatsApp) como um QR code escaneável. Usa `qrcode.react` (SVG, 100% browser —
 * sem código Node), gerado localmente: o conteúdo nunca sai do browser.
 */
export function QrCode({ value, size = 240 }: { value: string; size?: number }) {
  return (
    <div className="rounded-md border bg-white p-2">
      <QRCodeSVG value={value} size={size} marginSize={1} />
    </div>
  );
}
