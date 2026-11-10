/**
 * Liga a perna SIP ao POST /calls desta aba sem usar janela de tempo.
 *
 * O ramal pode cair antes de o HTTP responder. O token nasce no clique, gruda
 * no INVITE integrado do mesmo número e volta no contexto. Outra discagem tem
 * outro token, mesmo que comece 1s depois e no mesmo telefone.
 */

export function phoneDigits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

/** Mesmo destino, com ou sem DDI. Não serve para aceitar um contexto qualquer. */
export function sameDialedPhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = phoneDigits(a);
  const right = phoneDigits(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 8 && longer.endsWith(shorter);
}

export interface ReservedWebphoneDial {
  token: string;
  seq: number;
}

interface PendingDial extends ReservedWebphoneDial {
  phoneDigits: string;
}

let pending: PendingDial | null = null;
let publishedSeq = 0;
let seqCounter = 0;

export function reserveWebphoneDial(phone: string): ReservedWebphoneDial {
  seqCounter += 1;
  const reserved: PendingDial = {
    token: `dial-${seqCounter}-${Math.random().toString(36).slice(2, 10)}`,
    seq: seqCounter,
    phoneDigits: phoneDigits(phone),
  };
  pending = reserved;
  return { token: reserved.token, seq: reserved.seq };
}

/**
 * O INVITE integrado que acabou de chegar é a discagem reservada nesta aba?
 * Só consome a reserva quando o número confere. Sem reserva, devolve null.
 */
export function claimWebphoneDial(remoteNumber: string, integrated: boolean): string | null {
  if (!pending || !integrated) return null;
  if (!sameDialedPhone(pending.phoneDigits, remoteNumber)) return null;
  const token = pending.token;
  pending = null;
  return token;
}

export function cancelWebphoneDial(token: string): void {
  if (pending?.token === token) pending = null;
}

/** Publica só se esta discagem não ficou para trás de outra já publicada. */
export function publishWebphoneDial(seq: number, publish: () => void): boolean {
  if (seq < publishedSeq) return false;
  publishedSeq = seq;
  publish();
  return true;
}

export function resetWebphoneDialCorrelation(): void {
  pending = null;
  publishedSeq = 0;
  seqCounter = 0;
}
