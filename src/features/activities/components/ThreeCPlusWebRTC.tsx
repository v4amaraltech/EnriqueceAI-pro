'use client';

interface ThreeCPlusWebRTCProps {
  domain: string;
  token: string;
}

/**
 * Hidden iframe that loads the 3CPlus WebRTC client for audio.
 * Uses visibility:hidden + position:absolute so the iframe is never
 * unmounted during a call (which would drop the audio connection).
 */
export function ThreeCPlusWebRTC({ domain, token }: ThreeCPlusWebRTCProps) {
  const iframeSrc = `https://${domain}.3c.fluxcloud.com.br/webphone?api_token=${encodeURIComponent(token)}`;

  return (
    <iframe
      src={iframeSrc}
      title="3CPlus WebRTC"
      allow="microphone"
      className="pointer-events-none invisible absolute h-0 w-0"
      aria-hidden="true"
    />
  );
}
