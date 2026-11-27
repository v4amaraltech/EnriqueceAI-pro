import type { AutoDialRefusalCode } from './utils/auto-dial-rules';
import type { NextCallCardData } from './types';
import type { CockpitTier } from './utils/next-call-pick';
import type { AutoDialQueue } from './utils/recovery-queue';

/** Códigos de recusa do servidor ao discar (plano §3.2). Os de regra vêm de `auto-dial-rules.ts`. */
export type AutoDialGateCode =
  | AutoDialRefusalCode
  | 'not_owner'
  | 'flag_off'
  | 'no_phone'
  | 'lead_unavailable'
  /** O servidor decidiu um modo (simulado/real) diferente do que a página esperava: nada é discado (A-F11). */
  | 'live_mismatch'
  /** O número do cartão (contato do retorno ou principal) mudou depois de montado: recarrega o cartão. */
  | 'card_changed'
  | 'error';

/** Recusas que levam o motor a Bloqueado (FR-11/FR-12). */
export type AutoDialBlockCode = 'outside_hours' | 'holiday' | 'daily_cap';

/** Contexto extra do cartão do motor (FR-24). Só leitura; `null` no resultado = não foi possível ler (não bloqueia). */
export interface AutoDialLeadCardExtras {
  leadSource: string | null;
  canal: string | null;
  createdAt: string | null;
  lostAt: string | null;
  lossReasonName: string | null;
  lossNotes: string | null;
  /** "Último SDR que ligou": último usuário, diferente do atual, que ligou para o lead (A-D7). */
  previousSdr: { userId: string; name: string } | null;
}

/** Próximo lead do motor (`getNextAutoDialCardAction`). */
export type AutoDialNextResult =
  | { status: 'ok'; card: NextCallCardData; live: boolean; tier: CockpitTier; leadCardExtras: AutoDialLeadCardExtras | null; queue: AutoDialQueue }
  /** Ninguém liberado agora (intervalo de 1 h): `until` em ms desde a época (FR-5). */
  | { status: 'waiting'; until: number }
  | { status: 'empty' }
  | { status: 'blocked'; code: AutoDialBlockCode }
  | { status: 'disabled' };

/** Discagem (`dialAutoLeadAction`). `simulated` nunca chama a operadora nem cria linha em `calls`. */
export type AutoDialDialResult =
  | { status: 'simulated'; attemptNo: number }
  | { status: 'dialed'; callId: string; providerCallId: string; attemptNo: number }
  | { status: 'refused'; code: AutoDialGateCode }
  | { status: 'ramal_busy'; error: string }
  /** Número inválido (erro 422 da API4COM): o lead sai da sessão e o motor segue (A-D12). */
  /** `contactRefused`: o número recusado era o do contato do retorno (o lead não sai; a próxima vai ao principal). */
  | { status: 'invalid_number'; error: string; contactRefused?: boolean };

/** Fim de ligação sem atendimento (`resolveAutoDialNoAnswerAction`, FR-6/FR-7). */
export type AutoDialNoAnswerResult =
  | { status: 'recorded'; attemptNo: number }
  | { status: 'not_last'; attemptNo: number }
  | { status: 'pending' }
  | { status: 'answered' }
  | { status: 'refused' };

/** Veredito "conversou?" de uma ligação atendida (`classifyAutoDialAnsweredAction`, PR-B). */
export type AutoDialAnsweredClassification =
  | { status: 'verdict'; verdict: 'conversou' | 'nao_conversou'; reason: string; machine: boolean }
  /** Atendida, mas a duração ainda não fechou: tentar de novo em instantes. */
  | { status: 'pending' }
  | { status: 'refused' };

/** A escuta ao vivo DESLIGOU esta ligação (marca `live_amd.auto_hangup`)? `none` = não (ou ainda não gravou). */
export type AutoDialCarrierHangup =
  | { status: 'auto_hangup'; prediction: 'voicemail' | 'no_answer' | 'number_not_exist' }
  | { status: 'none' }
  | { status: 'refused' };

/** Conclusão do lead pelo painel durante a ligação do motor (`concludeAutoDialCallAction`). */
export type AutoDialConcludeResult =
  | { status: 'recorded'; disposition: string }
  /** A operadora ainda não informou se a ligação foi atendida; tentar de novo em instantes. */
  | { status: 'pending' }
  | { status: 'refused' };

/** Telas e hook: o que a página informa ao cartão (E7). */
export interface AutoDialView {
  enabled: boolean;
  live: boolean;
}
