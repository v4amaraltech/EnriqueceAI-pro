import { brtDateKey, isBrHoliday } from '@/lib/utils/br-holidays';

import {
  type MixedAutoEmailScope,
  isMixedAutoEmailCadence,
  mailboxDailyCap,
  orgAllowsMixedAutoEmail,
} from '@/features/cadences/services/mixed-auto-email.service';

/**
 * E-mail de cadência mista (standard, não-BDR) das orgs da flag
 * `cadence_mixed_auto_email_v1` é enviado pelo robô (execute-cadence). A fila do
 * SDR esconde o passo só enquanto o robô consegue enviar; passado este prazo
 * desde o instante em que o robô PODIA enviar, o passo volta para o SDR mandar
 * à mão (rede de segurança contra o e-mail sumir para todos).
 */
export const MIXED_EMAIL_HANDOFF_HOURS = 2;

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Janela do robô (igual a isBusinessHours do execute-cadence): 8h-18h BRT, seg-sex, sem feriado. */
function inRobotWindow(date: Date): boolean {
  const brt = new Date(date.getTime() - BRT_OFFSET_MS);
  const day = brt.getUTCDay();
  const hour = brt.getUTCHours();
  return day !== 0 && day !== 6 && !isBrHoliday(brtDateKey(date)) && hour >= 8 && hour < 18;
}

/** Primeiro instante em que o robô pode enviar um passo vencido em `due`. */
export function nextRobotSendTime(due: Date): Date {
  if (inRobotWindow(due)) return due;
  const brt = new Date(due.getTime() - BRT_OFFSET_MS);
  brt.setUTCHours(8, 0, 0, 0);
  if (brt.getTime() <= due.getTime() - BRT_OFFSET_MS) brt.setUTCDate(brt.getUTCDate() + 1);
  for (let i = 0; i < 15; i++) {
    const candidate = new Date(brt.getTime() + BRT_OFFSET_MS);
    if (inRobotWindow(candidate)) return candidate;
    brt.setUTCDate(brt.getUTCDate() + 1);
  }
  return due;
}

export interface MixedMailboxInfo {
  dailyCap: number | null;
  pausedReason: string | null;
  connectedAt: string | null;
}

export interface MixedEmailHandoffInput {
  scope: MixedAutoEmailScope;
  orgId: string;
  cadence: { type?: string | null; executor?: string | null; created_by?: string | null };
  assignedTo: string | null;
  step: { channel: string };
  isCurrentStep: boolean;
  nextStepDue: string | null;
  /** Gmails com status 'connected', chave `${org_id}:${user_id}`. */
  mailboxes: Map<string, MixedMailboxInfo>;
  now?: Date;
}

/**
 * true = o robô vai enviar este passo de e-mail: esconder da fila do SDR.
 * Mesmo remetente do execute-cadence: dono do lead se tiver Gmail conectado,
 * senão o criador da cadência. Caixa fora (não conectada, em pausa, teto 0)
 * ou vencido há mais de MIXED_EMAIL_HANDOFF_HOURS desde que o robô podia
 * enviar → false (SDR vê e manda à mão).
 */
export function isEmailHandledByMixedRobot(input: MixedEmailHandoffInput): boolean {
  const { scope, orgId, cadence, assignedTo, step, isCurrentStep, nextStepDue, mailboxes } = input;
  if (step.channel !== 'email' || !isCurrentStep || !nextStepDue) return false;
  if (!orgAllowsMixedAutoEmail(scope, orgId) || !isMixedAutoEmailCadence(cadence)) return false;

  const now = input.now ?? new Date();
  const due = new Date(nextStepDue);
  if (Number.isNaN(due.getTime())) return false;
  if (now.getTime() - nextRobotSendTime(due).getTime() > MIXED_EMAIL_HANDOFF_HOURS * HOUR_MS) return false;

  const senderId =
    assignedTo && mailboxes.has(`${orgId}:${assignedTo}`) ? assignedTo : (cadence.created_by ?? null);
  if (!senderId) return false;
  const mailbox = mailboxes.get(`${orgId}:${senderId}`);
  if (!mailbox) return false;
  return mailboxDailyCap({ ...mailbox, now }) > 0;
}
