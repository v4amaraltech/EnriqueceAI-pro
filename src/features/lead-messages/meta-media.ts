import type { LeadMessageMedia } from './record';

interface MetaPart {
  id?: string;
  mime_type?: string;
}

export interface MetaInboundMessage {
  id: string;
  type?: string;
  image?: MetaPart;
  audio?: MetaPart;
  video?: MetaPart;
  document?: MetaPart;
  sticker?: MetaPart;
}

const KINDS = ['image', 'audio', 'video', 'document', 'sticker'] as const;

/** Metadado da mídia da Cloud API. Não baixa o arquivo. */
export function metaCloudMedia(message: MetaInboundMessage): LeadMessageMedia | null {
  for (const kind of KINDS) {
    if (message.type !== kind) continue;
    const part = message[kind];
    return { type: kind, provider_media_id: part?.id ?? message.id, mime: part?.mime_type ?? null };
  }
  return null;
}
