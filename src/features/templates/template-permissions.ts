import type { MemberRole } from '@/lib/auth/require-auth-with-member';

import type { MessageTemplateRow } from '../cadences/types';

/**
 * Todos da org VEEM todos os templates; só EDITA/DELETA quem criou (ou o gestor).
 * Templates de sistema são somente leitura para todos.
 */
export function canEditTemplate(
  template: Pick<MessageTemplateRow, 'is_system' | 'created_by'>,
  userId: string,
  role: MemberRole,
): boolean {
  if (template.is_system) return false;
  return role === 'manager' || template.created_by === userId;
}
