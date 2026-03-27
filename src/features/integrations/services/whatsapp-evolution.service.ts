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
}

export class EvolutionWhatsAppService {
  /**
   * Sends a text message via Evolution API (WhatsApp Web).
   */
  static async sendMessage(
    orgId: string,
    params: { to: string; body: string },
    supabase: SupabaseClient,
  ): Promise<EvolutionSendResult> {
    const env = getEnv();
    const apiUrl = env.EVOLUTION_API_URL;
    const apiKey = env.EVOLUTION_API_KEY;

    if (!apiUrl || !apiKey) {
      return { success: false, error: 'Evolution API não configurada no servidor' };
    }

    // Fetch Evolution instance for this org
    const { data: instance } = (await from(supabase, 'whatsapp_instances' as never)
      .select('id, instance_name, status, phone')
      .eq('org_id', orgId)
      .maybeSingle()) as { data: WhatsAppInstance | null };

    if (!instance) {
      return { success: false, error: 'Nenhuma instância WhatsApp Evolution encontrada' };
    }

    if (instance.status !== 'connected') {
      return { success: false, error: 'WhatsApp Evolution não está conectado. Reconecte via QR Code.' };
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
        const errorBody = (await response.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        return {
          success: false,
          error: errorBody?.message ?? errorBody?.error ?? `Evolution API error: ${response.status}`,
        };
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
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao conectar com Evolution API',
      };
    }
  }
}
