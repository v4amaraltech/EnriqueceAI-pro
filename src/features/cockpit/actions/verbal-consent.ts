'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import { CONSENT_CAPTURE_FLAG_KEY } from '@/features/contact-engine/services/consent-capture.service';
import { isScopedFlagEnabled } from '@/features/contact-engine/services/flag-scope.service';

import { getVerbalConsentState, recordVerbalConsent } from '../services/verbal-consent.service';

const inputSchema = z.object({ callId: z.string().uuid() });

export type VerbalConsentUiState = 'disabled' | 'unknown' | 'available' | 'recorded' | 'unavailable';

/**
 * Estado do botao "Aceitou WhatsApp". Com `consent_capture_v1` desligada para a
 * organizacao responde `disabled` (o botao nao aparece) sem ler ligacao nem lead.
 */
export async function getVerbalConsentStateAction(input: unknown): Promise<ActionResult<{ state: VerbalConsentUiState }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, role, supabase } = auth.data;
  if (!(await isScopedFlagEnabled(CONSENT_CAPTURE_FLAG_KEY, { orgId }))) {
    return { success: true, data: { state: 'disabled' } };
  }

  const state = await getVerbalConsentState(supabase, { orgId, userId, isManager: role === 'manager' }, parsed.data.callId);
  return { success: true, data: { state } };
}

/** Grava o aceite verbal de WhatsApp da ligacao. Idempotente por `callId`. */
export async function recordVerbalConsentAction(input: unknown): Promise<ActionResult<{ alreadyRecorded: boolean }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados inválidos' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, role, supabase } = auth.data;
  if (!(await isScopedFlagEnabled(CONSENT_CAPTURE_FLAG_KEY, { orgId }))) {
    return { success: false, error: 'Captura de consentimento desativada', code: 'flag_disabled' };
  }

  const result = await recordVerbalConsent(supabase, { orgId, userId, isManager: role === 'manager' }, parsed.data.callId);
  switch (result.status) {
    case 'recorded':
      return { success: true, data: { alreadyRecorded: false } };
    case 'already_recorded':
      return { success: true, data: { alreadyRecorded: true } };
    case 'not_found':
      return { success: false, error: 'Ligação não encontrada', code: 'not_found' };
    case 'not_answered':
      return { success: false, error: 'A ligação não foi atendida', code: 'not_answered' };
    case 'window_expired':
      return { success: false, error: 'O prazo para registrar o aceite desta ligação acabou', code: 'window_expired' };
    case 'opted_out':
      return { success: false, error: 'O contato pediu para não receber mensagens. Aceite não registrado', code: 'opted_out' };
    case 'invalid_phone':
      return { success: false, error: 'Telefone inválido para WhatsApp', code: 'invalid_phone' };
    default:
      return { success: false, error: 'Falha ao registrar o aceite', code: 'write_failed' };
  }
}
