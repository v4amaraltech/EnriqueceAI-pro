// Fonte única de verdade para "ligação conectada" e "ligação significativa".
// Módulo PURO — usado por Painel de Ligações, Estatísticas e Extrato, que até
// jul/2026 tinham TRÊS definições diferentes e mostravam taxas incompatíveis:
//
//   Painel de Ligações   duration >= 50s              →  9,8%   (90 dias)
//   Estatísticas/Extrato status IN (significant,       → 68,2%
//                        not_significant)
//   BI do Sales Hub      status='significant'          → 19,4%
//                        OR duration >= 30s
//
// POR QUE `not_significant` NÃO É SINAL DE CONEXÃO
//
// Intuitivamente `not_significant` ("atendeu, sem avanço") parece conectada,
// mas os dados de produção provam o contrário: em 90 dias, 6.221 linhas
// `not_significant` têm `answered_at IS NULL` (ZERO exceções) e carregam
// hangup_cause que provam que ninguém atendeu — NUMBER_CHANGED (2.834),
// ORIGINATOR_CANCEL (2.823, o SDR desistiu antes de tocar), UNALLOCATED_NUMBER,
// CALL_REJECTED. A mediana de duração do bucket é 2 SEGUNDOS e 5.716 têm
// duração zero.
//
// Isso vem de um bug de escrita no pipeline API4COM (o reconcile corrige
// `hangup_cause` depois, mas a guarda `status === 'not_connected'` impede a
// reclassificação, então a linha fica com a causa nova e o status antigo).
// Enquanto esse bug existir, `status` sozinho não é confiável — por isso a
// regra abaixo se apoia em sinais que NÃO são reescritos: `answered_at`
// (o webhook viu channel-answer) e a duração real.
//
// `sdr_outcome` é deliberadamente ignorado aqui: é a leitura do SDR, não a
// medição da telefonia. Misturar os dois foi a origem da divergência de BI de
// mai/2026 — ver `classify-webphone-call.ts`.
import type { CallStatus } from './types';

/**
 * Piso de duração que, sozinho, comprova conexão. Igual ao usado pelo
 * warehouse do Sales Hub (`status='significant' OR duration_seconds>=30`),
 * para que o número do app e o do BI partam da mesma base.
 */
export const CONNECTED_MIN_DURATION_SECONDS = 30;

export interface CallConnectionSignals {
  status: CallStatus;
  duration_seconds: number;
  /** Timestamp de channel-answer do webhook. Sinal autoritativo de atendimento. */
  answered_at?: string | null;
}

/**
 * A ligação alcançou a pessoa do outro lado.
 *
 * Três sinais independentes, qualquer um basta:
 *  1. `significant` — conversa qualificada, já validada pelo classificador;
 *  2. `answered_at` — o provedor confirmou que atenderam (mais forte que tudo);
 *  3. duração >= 30s — salvaguarda para ramais cujo webhook chega sem sinais.
 */
export function isConnectedCall(call: CallConnectionSignals): boolean {
  if (call.status === 'significant') return true;
  if (call.answered_at) return true;
  return call.duration_seconds >= CONNECTED_MIN_DURATION_SECONDS;
}

/**
 * Conversa relevante — o bucket qualitativo que o classificador atribui quando
 * a duração passa do limite significativo configurado pela org.
 *
 * Sempre um SUBCONJUNTO de `isConnectedCall`. Antes deste módulo o Painel de
 * Ligações calculava `significant = connected`, então os cards "Taxa de
 * Conexão" e "Taxa de Significativas" exibiam sempre o mesmo número.
 */
export function isSignificantCall(call: Pick<CallConnectionSignals, 'status'>): boolean {
  return call.status === 'significant';
}

/** Colunas mínimas que uma query precisa trazer para alimentar os helpers. */
export const CALL_CONNECTION_COLUMNS = 'status, duration_seconds, answered_at' as const;
