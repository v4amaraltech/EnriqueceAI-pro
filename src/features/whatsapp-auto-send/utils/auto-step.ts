/**
 * Quando um passo de WhatsApp sai da fila de Atividades do SDR porque o robô
 * envia sozinho (story whatsapp-evolution-paced-sending).
 *
 * O robô só cuida do passo quando o enfileiramento também cuidaria: passo
 * marcado como automático, com template, e lead com SDR responsável. Se o
 * envio automático falhou de vez (item `failed` na fila), o passo volta a
 * aparecer como tarefa manual — senão ficaria escondido para sempre.
 */
export function isHandledByAutoSend(
  step: { id: string; channel: string; auto_send?: boolean | null; template_id: string | null },
  lead: { assigned_to: string | null },
  enrollmentId: string,
  failedKeys: ReadonlySet<string>,
): boolean {
  if (step.channel !== 'whatsapp' || !step.auto_send || !step.template_id) return false;
  if (!lead.assigned_to) return false;
  return !failedKeys.has(autoSendKey(enrollmentId, step.id));
}

export function autoSendKey(enrollmentId: string, stepId: string): string {
  return `${enrollmentId}:${stepId}`;
}
