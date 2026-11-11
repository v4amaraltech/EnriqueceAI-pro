import { parseBuffer } from 'music-metadata';

/**
 * Mede a duração (segundos) de um áudio em memória. Retorna null quando o
 * formato não é reconhecido. Sem ffprobe: roda no runtime do app.
 * `duration: true` varre os frames quando o MP3 não tem cabeçalho Xing/VBRI.
 */
export async function measureAudioSeconds(buffer: Buffer): Promise<number | null> {
  try {
    const meta = await parseBuffer(buffer, { mimeType: 'audio/mpeg' }, { duration: true });
    const seconds = meta.format.duration;
    return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : null;
  } catch {
    return null;
  }
}
