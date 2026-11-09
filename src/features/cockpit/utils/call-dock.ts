import type { PendingActivity } from '@/features/activities/types';

/** Ligação de telefonia (API4COM ou outro provedor de voz). WhatsApp nativo fica na gaveta. */
export function isCallDockTask(activity: Pick<PendingActivity, 'channel' | 'callProvider'>): boolean {
  return activity.channel === 'phone' && activity.callProvider !== 'whatsapp';
}
