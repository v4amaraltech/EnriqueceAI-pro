'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import QRCode from 'qrcode';

/**
 * Renderiza uma string (ex.: o payload `wa.me/...` de "conectar dispositivo" do
 * WhatsApp) como um QR code escaneável. A geração é 100% local (sem serviço
 * externo) — o conteúdo do QR nunca sai do browser.
 */
export function QrCode({ value, size = 240 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl(null);
      });
    return () => {
      active = false;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        className="animate-pulse rounded-md border bg-[var(--muted)]"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <Image
      src={dataUrl}
      alt="QR Code de pareamento"
      width={size}
      height={size}
      unoptimized
      className="rounded-md border bg-white p-2"
    />
  );
}
