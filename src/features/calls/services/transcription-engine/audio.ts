import {
  DURATION_TOLERANCE_MIN_SECONDS,
  DURATION_TOLERANCE_RATIO,
} from './constants';

export interface MonoAudio {
  /** WAV PCM 16 bits mono. */
  wav: Buffer;
  durationSeconds: number;
  sampleRate: number;
  sourceChannels: number;
}

interface Pcm {
  channels: Float32Array[];
  sampleRate: number;
}

function isWav(buf: Buffer): boolean {
  return buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE';
}

/** Decodifica WAV PCM 16 bits (o que a telefonia entrega quando não é mp3). */
function decodeWav(buf: Buffer): Pcm {
  let offset = 12;
  let channelsCount = 0;
  let sampleRate = 0;
  let bits = 0;
  let format = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = buf.readUInt16LE(body);
      channelsCount = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      if (format !== 1 || bits !== 16 || channelsCount < 1) throw new Error('wav_unsupported_format');
      const end = Math.min(body + size, buf.length);
      const frames = Math.floor((end - body) / (2 * channelsCount));
      const channels = Array.from({ length: channelsCount }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channelsCount; c++) {
          const sample = buf.readInt16LE(body + (i * channelsCount + c) * 2);
          (channels[c] as Float32Array)[i] = sample / 32768;
        }
      }
      return { channels, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('wav_no_data');
}

/** mp3 via WASM em processo (sem ffmpeg no runtime). */
async function decodeMp3(buf: Buffer): Promise<Pcm> {
  const { MPEGDecoder } = await import('mpg123-decoder');
  const decoder = new MPEGDecoder();
  try {
    await decoder.ready;
    const out = decoder.decode(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    if (!out.channelData.length || out.samplesDecoded === 0) throw new Error('audio_decode_empty');
    return { channels: out.channelData, sampleRate: out.sampleRate };
  } finally {
    decoder.free();
  }
}

/** Média dos canais (mono) em PCM 16 bits. */
export function downmixToMonoPcm16(channels: Float32Array[]): Int16Array {
  const first = channels[0];
  if (!first) return new Int16Array(0);
  const out = new Int16Array(first.length);
  for (let i = 0; i < first.length; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i] ?? 0;
    const v = Math.max(-1, Math.min(1, sum / channels.length));
    out[i] = Math.round(v < 0 ? v * 32768 : v * 32767);
  }
  return out;
}

export function encodeWavMono16(samples: Int16Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i] as number, 44 + i * 2);
  return buf;
}

/**
 * Decodifica a gravação (mp3 ou WAV), mede a duração real e devolve WAV mono.
 * Limitação: o mono sai em WAV (maior que mp3), mas o AssemblyAI cobra por segundo
 * de áudio, não por byte. Sem ffmpeg: decodificação em WASM (mpg123-decoder).
 */
export async function prepareMonoAudio(input: Buffer): Promise<MonoAudio> {
  const pcm = isWav(input) ? decodeWav(input) : await decodeMp3(input);
  const mono = downmixToMonoPcm16(pcm.channels);
  return {
    wav: encodeWavMono16(mono, pcm.sampleRate),
    durationSeconds: mono.length / pcm.sampleRate,
    sampleRate: pcm.sampleRate,
    sourceChannels: pcm.channels.length,
  };
}

/** O áudio baixado cobre a ligação? Tolerância: o maior entre 15% e 5 s. */
export function durationMatches(callSeconds: number, audioSeconds: number): boolean {
  const tolerance = Math.max(DURATION_TOLERANCE_MIN_SECONDS, callSeconds * DURATION_TOLERANCE_RATIO);
  return Math.abs(callSeconds - audioSeconds) <= tolerance;
}
