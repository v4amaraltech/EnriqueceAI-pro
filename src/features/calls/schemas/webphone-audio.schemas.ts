import { z } from 'zod';

// Avaliação de áudio do webphone (story api4com-embedded-webphone, bloco 3).
// Tudo vai para `calls.metadata` — nenhuma coluna nova:
//   metadata.audio_quality  → 1 a 5 estrelas dadas pelo SDR ("Pular" não grava)
//   metadata.audio_stats    → resumo de `getStats()` da conexão WebRTC

export const webphoneAudioStatsSchema = z.object({
  packetsReceived: z.number().int().min(0),
  packetsLost: z.number().int().min(0),
  lossPercent: z.number().min(0).max(100),
  jitterMs: z.number().min(0).nullable(),
  rttMs: z.number().min(0).nullable(),
  collectedAt: z.string().min(1),
});

export const saveWebphoneCallAudioSchema = z
  .object({
    callId: z.string().uuid(),
    audioQuality: z.number().int().min(1).max(5).optional(),
    audioStats: webphoneAudioStatsSchema.optional(),
  })
  .refine((d) => d.audioQuality !== undefined || d.audioStats !== undefined, {
    message: 'Informe a avaliação ou as estatísticas',
  });

export type SaveWebphoneCallAudioInput = z.infer<typeof saveWebphoneCallAudioSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Mescla a avaliação/estatísticas no `metadata` atual da ligação sem apagar o
 * que já está lá (`api4com_call_id`, `gateway`, `webhook_linked`…). Metadata
 * que não seja objeto (null, legado) é tratado como vazio.
 */
export function mergeWebphoneAudioMetadata(
  existing: unknown,
  input: Pick<SaveWebphoneCallAudioInput, 'audioQuality' | 'audioStats'>,
): Record<string, unknown> {
  return {
    ...(isPlainObject(existing) ? existing : {}),
    ...(input.audioQuality !== undefined ? { audio_quality: input.audioQuality } : {}),
    ...(input.audioStats !== undefined ? { audio_stats: input.audioStats } : {}),
  };
}
