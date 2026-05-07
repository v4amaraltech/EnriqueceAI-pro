import type { SupabaseClient } from '@supabase/supabase-js';

import { getEnv } from '@/config/env';
import { from } from '@/lib/supabase/from';

import { validateBrazilianPhone } from './whatsapp.service';

interface EvolutionSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface WhatsAppInstance {
  id: string;
  instance_name: string;
  status: string;
  phone: string | null;
  user_id: string | null;
}

const RECONNECT_HINT =
  'Sua sessão do WhatsApp expirou. Reconecte o WhatsApp em Configurações → Integrações.';

// Baileys / Evolution returns these phrases when the WhatsApp Web session is
// dropped (logged out from phone, network outage, expired session, etc.) or
// when the Evolution server lost the instance from memory (after a restart).
// Match is case-insensitive and looks for substrings, since Evolution wraps
// them in different shapes ("Connection Closed", "no session", "not authorized",
// "The 'ea_xxx' instance does not exist").
const SESSION_DEAD_PATTERNS = [
  'connection closed',
  'connection failure',
  'connection terminated',
  'connection lost',
  'no session',
  'not authorized',
  'instance not connected',
  'not logged',
  'instance does not exist',
  'instance not found',
  'does not exist',
];

function isSessionDeadError(message: string): boolean {
  const lower = message.toLowerCase();
  return SESSION_DEAD_PATTERNS.some((pattern) => lower.includes(pattern));
}

export class EvolutionWhatsAppService {
  /**
   * Sends a text message via Evolution API (WhatsApp Web).
   *
   * Lookup order:
   * 1. User-specific instance (org_id + user_id)
   * 2. Org-level default instance (org_id + user_id IS NULL)
   */
  static async sendMessage(
    orgId: string,
    params: { to: string; body: string },
    supabase: SupabaseClient,
    userId?: string,
  ): Promise<EvolutionSendResult> {
    const env = getEnv();
    const apiUrl = env.EVOLUTION_API_URL;
    const apiKey = env.EVOLUTION_API_KEY;

    if (!apiUrl || !apiKey) {
      return { success: false, error: 'Evolution API não configurada no servidor' };
    }

    // Fetch Evolution instance: user-specific first, then org default
    const instance = await this.resolveInstance(supabase, orgId, userId);

    if (!instance) {
      return { success: false, error: 'Nenhuma instância WhatsApp Evolution encontrada' };
    }

    if (instance.status !== 'connected') {
      const owner = instance.user_id ? 'Sua instância WhatsApp' : 'WhatsApp Evolution da organização';
      return { success: false, error: `${owner} não está conectado. Reconecte via QR Code.` };
    }

    // Validate phone number
    const formattedPhone = validateBrazilianPhone(params.to);
    if (!formattedPhone) {
      return { success: false, error: 'Número de telefone inválido' };
    }

    try {
      const response = await fetch(
        `${apiUrl.replace(/\/+$/, '')}/message/sendText/${instance.instance_name}`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(15_000),
          headers: {
            'Content-Type': 'application/json',
            apikey: apiKey,
          },
          body: JSON.stringify({
            number: formattedPhone,
            text: params.body,
          }),
        },
      );

      if (!response.ok) {
        const rawError = await response.text().catch(() => '');
        let errorMsg = `Evolution API error: ${response.status}`;
        try {
          const errorBody = JSON.parse(rawError) as { message?: unknown; error?: unknown; response?: { message?: unknown } };
          // Evolution sometimes returns nested error objects (e.g. PrismaClientKnownRequestError
          // wrapped in response.message). Coerce defensively to a string so we never
          // persist "[object Object]" as the failure reason in interactions.metadata.
          const pickString = (v: unknown): string | null => {
            if (typeof v === 'string' && v.length > 0) return v;
            if (Array.isArray(v)) {
              const joined = v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ');
              return joined.length > 0 ? joined : null;
            }
            if (v && typeof v === 'object') {
              try { return JSON.stringify(v); } catch { return null; }
            }
            return null;
          };
          errorMsg =
            pickString(errorBody?.response?.message) ??
            pickString(errorBody?.message) ??
            pickString(errorBody?.error) ??
            errorMsg;
        } catch {
          if (rawError) errorMsg = rawError;
        }
        console.error('[evolution] sendMessage failed:', response.status, errorMsg, 'instance:', instance.instance_name, 'phone:', formattedPhone);

        if (isSessionDeadError(errorMsg)) {
          await this.markInstanceDisconnected(supabase, instance.id);
          return { success: false, error: RECONNECT_HINT };
        }

        return { success: false, error: errorMsg };
      }

      const result = (await response.json()) as {
        key?: { id?: string };
        message?: { key?: { id?: string } };
      };

      const messageId = result?.key?.id ?? result?.message?.key?.id;

      if (!messageId) {
        return { success: false, error: 'Evolution API não retornou ID da mensagem' };
      }

      return { success: true, messageId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao conectar com Evolution API';
      if (isSessionDeadError(message)) {
        await this.markInstanceDisconnected(supabase, instance.id);
        return { success: false, error: RECONNECT_HINT };
      }
      return { success: false, error: message };
    }
  }

  /**
   * Marks an Evolution instance as disconnected so the UI prompts the user to
   * reconnect via QR Code. Failures are swallowed: surfacing a clear error to
   * the caller is more important than the bookkeeping update.
   */
  private static async markInstanceDisconnected(
    supabase: SupabaseClient,
    instanceId: string,
  ): Promise<void> {
    try {
      await from(supabase, 'whatsapp_instances' as never)
        .update({ status: 'disconnected' } as Record<string, unknown>)
        .eq('id', instanceId);
    } catch (err) {
      console.error('[evolution] markInstanceDisconnected failed:', err);
    }
  }

  /**
   * Resolves the WhatsApp instance for a given user.
   * Priority: user-specific instance > org-level default.
   */
  private static async resolveInstance(
    supabase: SupabaseClient,
    orgId: string,
    userId?: string,
  ): Promise<WhatsAppInstance | null> {
    if (userId) {
      // Try user-specific instance first
      const { data: userInstance } = (await from(supabase, 'whatsapp_instances' as never)
        .select('id, instance_name, status, phone, user_id')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .maybeSingle()) as { data: WhatsAppInstance | null };

      if (userInstance) return userInstance;
    }

    // Fallback to org-level default (user_id IS NULL)
    const { data: orgInstance } = (await from(supabase, 'whatsapp_instances' as never)
      .select('id, instance_name, status, phone, user_id')
      .eq('org_id', orgId)
      .is('user_id', null)
      .maybeSingle()) as { data: WhatsAppInstance | null };

    return orgInstance;
  }
}
