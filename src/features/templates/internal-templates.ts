/**
 * Templates criados automaticamente ao salvar uma cadência de e-mail automático
 * (save-auto-email-steps). Só o robô usa — não devem aparecer para o SDR escolher.
 */
export const AUTO_EMAIL_TEMPLATE_PREFIX = 'Auto Email - Step ';

export function isAutoEmailTemplate(name: string): boolean {
  return name.startsWith(AUTO_EMAIL_TEMPLATE_PREFIX);
}
