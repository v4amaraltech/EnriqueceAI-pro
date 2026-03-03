import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/security/encryption';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const WHATSAPP_RATE_LIMIT = 80; // msgs per second (Meta API limit)
const WHATSAPP_RATE_WINDOW_MS = 1_000;

interface SendWhatsAppParams {
  to: string;
  body: string;
  templateName?: string;
  templateParams?: string[];
}

interface SendWhatsAppResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface WhatsAppConnection {
  id: string;
  phone_number_id: string;
  business_account_id: string;
  access_token_encrypted: string;
  status: string;
}

/**
 * Validates Brazilian phone number format.
 * Accepts: +55XXXXXXXXXXX, 55XXXXXXXXXXX, (XX) XXXXX-XXXX, etc.
 */
export function validateBrazilianPhone(phone: string): string | null {
  const cleaned = phone.replace(/\D/g, '');

  // Must have 12 or 13 digits (with country code 55)
  if (cleaned.length === 12 || cleaned.length === 13) {
    if (cleaned.startsWith('55')) {
      return cleaned;
    }
  }

  // Without country code: 10 or 11 digits
  if (cleaned.length === 10 || cleaned.length === 11) {
    return `55${cleaned}`;
  }

  return null;
}

export class WhatsAppService {
  private static readonly META_API_URL = 'https://graph.facebook.com/v21.0';

  /**
   * Sends a text message via WhatsApp Business API.
   */
  static async sendMessage(
    orgId: string,
    params: SendWhatsAppParams,
    supabaseClient?: SupabaseClient,
  ): Promise<SendWhatsAppResult> {
    const supabase = supabaseClient ?? await createServerSupabaseClient();

    // Fetch WhatsApp connection
    const { data: connection } = (await (supabase
      .from('whatsapp_connections') as ReturnType<typeof supabase.from>)
      .select('*')
      .eq('org_id', orgId)
      .eq('status', 'connected')
      .single()) as { data: WhatsAppConnection | null };

    if (!connection) {
      return { success: false, error: 'Nenhuma conexão WhatsApp ativa encontrada' };
    }

    // Validate phone number
    const formattedPhone = validateBrazilianPhone(params.to);
    if (!formattedPhone) {
      return { success: false, error: 'Número de telefone inválido' };
    }

    // Build request body
    const requestBody = params.templateName
      ? {
          messaging_product: 'whatsapp',
          to: formattedPhone,
          type: 'template',
          template: {
            name: params.templateName,
            language: { code: 'pt_BR' },
            components: params.templateParams?.length
              ? [
                  {
                    type: 'body',
                    parameters: params.templateParams.map((p) => ({
                      type: 'text',
                      text: p,
                    })),
                  },
                ]
              : undefined,
          },
        }
      : {
          messaging_product: 'whatsapp',
          to: formattedPhone,
          type: 'text',
          text: { body: params.body },
        };

    // Rate limit: 80 msgs/sec per org (Meta API limit)
    const rateCheck = checkRateLimit(`whatsapp:${orgId}`, WHATSAPP_RATE_LIMIT, WHATSAPP_RATE_WINDOW_MS);
    if (!rateCheck.allowed) {
      return { success: false, error: `Rate limit excedido. Tente novamente em ${Math.ceil((rateCheck.retryAfterMs ?? 1000) / 1000)}s` };
    }

    const response = await fetch(
      `${WhatsAppService.META_API_URL}/${connection.phone_number_id}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${decrypt(connection.access_token_encrypted)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      },
    );

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: { message?: string; code?: number };
      };
      return {
        success: false,
        error: errorBody?.error?.message ?? `WhatsApp API error: ${response.status}`,
      };
    }

    const result = (await response.json()) as { messages?: { id: string }[] };
    const messageId = result.messages?.[0]?.id;

    return { success: true, messageId };
  }
}
