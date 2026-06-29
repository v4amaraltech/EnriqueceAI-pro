import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt, encrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getAppUrl } from '@/lib/utils/app-url';

import { GOOGLE_TOKEN_URL } from '../constants/oauth-endpoints';

interface SendEmailParams {
  to: string;
  subject: string;
  htmlBody: string;
  threadId?: string;
  /** RFC 2822 Message-ID of the message being replied to (e.g.
   *  `<abc@mail.gmail.com>`). When set, the outgoing message gets
   *  `In-Reply-To` and `References` headers so non-Gmail recipients see the
   *  conversation as a thread instead of a brand-new email each time. */
  inReplyToMessageId?: string;
  trackOpens?: boolean;
  trackClicks?: boolean;
}

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  threadId?: string;
  /** RFC 2822 Message-ID assigned to the sent message — persist this on the
   *  interaction so future replies can quote it via inReplyToMessageId. */
  rfcMessageId?: string;
  error?: string;
}

export interface GmailConnection {
  id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string;
  email_address: string;
  custom_signature: string | null;
  status: string;
}

/**
 * Adds tracking pixel for open tracking.
 */
function injectOpenTracking(html: string, interactionId: string): string {
  const baseUrl = getAppUrl();
  const pixel = `<img src="${baseUrl}/api/track/open/${interactionId}" width="1" height="1" style="display:none" alt="" />`;
  // Try </body> first, then </html>, otherwise append at end (handles HTML fragments)
  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixel}</body>`);
  }
  if (html.includes('</html>')) {
    return html.replace('</html>', `${pixel}</html>`);
  }
  return html + pixel;
}

/**
 * Wraps links for click tracking.
 */
function injectClickTracking(html: string, interactionId: string): string {
  const baseUrl = getAppUrl();
  return html.replace(
    /href="(https?:\/\/[^"]+)"/g,
    (_match, url: string) => {
      const trackUrl = `${baseUrl}/api/track/click/${interactionId}?url=${encodeURIComponent(url)}`;
      return `href="${trackUrl}"`;
    },
  );
}

/**
 * M3: strip CR/LF from any value interpolated into an email header, preventing
 * header injection (e.g. a lead's `nome_fantasia` from a CSV carrying "\r\nBcc:").
 * encodeSubject only base64-encodes non-ASCII subjects, so an ASCII subject with
 * CRLF would otherwise reach the raw header unescaped.
 */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Encodes a subject line with RFC 2047 for non-ASCII characters.
 */
function encodeSubject(subject: string): string {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;
}

/**
 * Builds a raw RFC 2822 email message for Gmail API.
 */
/** Strip HTML to plain text for the text/plain MIME part */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Generate an RFC 2822 Message-ID using the sender's domain. Gmail rewrites
 *  this on send anyway, but having one upfront lets us persist a stable ID
 *  on the interaction record before the API call returns. */
function generateMessageId(fromAddress: string): string {
  const domain = fromAddress.split('@')[1] ?? 'enriqueceai.com.br';
  const random = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}`;
  return `<${random}@${domain}>`;
}

interface BuildRawEmailOptions {
  messageId?: string;
  inReplyTo?: string;
}

function buildRawEmail(
  from: string,
  to: string,
  subject: string,
  htmlBody: string,
  options: BuildRawEmailOptions = {},
): string {
  const boundary = `boundary_${Date.now()}`;
  const plainText = htmlToPlainText(htmlBody);
  const headers: string[] = [
    `From: ${sanitizeHeaderValue(from)}`,
    `To: ${sanitizeHeaderValue(to)}`,
    `Subject: ${encodeSubject(sanitizeHeaderValue(subject))}`,
    'MIME-Version: 1.0',
  ];
  if (options.messageId) {
    headers.push(`Message-ID: ${options.messageId}`);
  }
  if (options.inReplyTo) {
    // RFC 5322: References should accumulate; with only one prior message we
    // mirror In-Reply-To.
    headers.push(`In-Reply-To: ${options.inReplyTo}`);
    headers.push(`References: ${options.inReplyTo}`);
  }
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  const message = [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(plainText).toString('base64'),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(htmlBody).toString('base64'),
    `--${boundary}--`,
  ].join('\r\n');

  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Refreshes an expired Gmail token using the refresh_token grant.
 * Updates the connection in the database and returns the new access token.
 */
export async function refreshAccessToken(
  connection: GmailConnection,
  supabase: SupabaseClient,
): Promise<{ accessToken: string } | { error: string }> {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';

  if (!clientId || !clientSecret) {
    return { error: 'Google OAuth não configurado — impossível renovar token' };
  }

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decrypt(connection.refresh_token_encrypted),
      grant_type: 'refresh_token',
    }),
  });

  if (!tokenResponse.ok) {
    await from(supabase, 'gmail_connections')
      .update({ status: 'error' } as Record<string, unknown>)
      .eq('id', connection.id);
    return { error: 'Falha ao renovar token Gmail — reconexão necessária' };
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    expires_in: number;
  };

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await from(supabase, 'gmail_connections')
    .update({
      access_token_encrypted: encrypt(tokens.access_token),
      token_expires_at: expiresAt,
      status: 'connected',
    } as Record<string, unknown>)
    .eq('id', connection.id);

  return { accessToken: tokens.access_token };
}

export class EmailService {
  /**
   * Sends an email via Gmail API using the user's connected account.
   *
   * @param supabaseClient - Optional Supabase client to use (for cron/service role contexts).
   *                         If not provided, uses cookie-based `createServerSupabaseClient()`.
   */
  static async sendEmail(
    userId: string,
    orgId: string,
    params: SendEmailParams,
    interactionId?: string,
    supabaseClient?: SupabaseClient,
  ): Promise<SendEmailResult> {
    const supabase = supabaseClient ?? (await createServerSupabaseClient());

    // Fetch Gmail connection (include 'error' status — will attempt auto-refresh)
    const { data: connection } = (await from(supabase, 'gmail_connections')
      .select('*')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .in('status', ['connected', 'error'])
      .single()) as { data: GmailConnection | null };

    if (!connection) {
      return { success: false, error: 'Nenhuma conexão Gmail ativa encontrada' };
    }

    // Auto-refresh if token is expired or connection was in error state
    let accessToken = decrypt(connection.access_token_encrypted);
    if (connection.status === 'error' || new Date(connection.token_expires_at) < new Date()) {
      const refreshResult = await refreshAccessToken(connection, supabase);
      if ('error' in refreshResult) {
        return { success: false, error: refreshResult.error };
      }
      accessToken = refreshResult.accessToken;
    }

    // Fetch signature: priority custom > cached > Gmail API (cached 24h)
    let signature = '';
    if (connection.custom_signature) {
      signature = connection.custom_signature;
    } else {
      const cachedSig = (connection as unknown as Record<string, unknown>).cached_signature as string | null;
      const cachedAt = (connection as unknown as Record<string, unknown>).signature_cached_at as string | null;
      const cacheValid = cachedAt && (Date.now() - new Date(cachedAt).getTime() < 86_400_000); // 24h TTL

      if (cachedSig && cacheValid) {
        signature = cachedSig;
      } else {
        try {
          const sigResponse = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/${encodeURIComponent(connection.email_address)}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (sigResponse.ok) {
            const sigData = (await sigResponse.json()) as { signature?: string };
            if (sigData.signature) {
              signature = sigData.signature;
              // Cache the signature (fire-and-forget)
              const dbClient = supabase;
              (dbClient as any).from('gmail_connections')
                .update({ cached_signature: signature, signature_cached_at: new Date().toISOString() })
                .eq('user_id', userId)
                .then(() => {});
            }
          }
        } catch {
          // Signature fetch failed — use cached if available, else send without
          if (cachedSig) signature = cachedSig;
        }
      }
    }

    // Apply tracking
    let html = signature
      ? `${params.htmlBody}<div style="margin-top:16px" class="gmail_signature">${signature}</div>`
      : params.htmlBody;
    if (interactionId) {
      if (params.trackOpens !== false) {
        html = injectOpenTracking(html, interactionId);
      }
      if (params.trackClicks !== false) {
        html = injectClickTracking(html, interactionId);
      }
    }

    // Build raw email — include a stable Message-ID + In-Reply-To/References
    // so that non-Gmail recipients see replies as a continuing thread.
    const rfcMessageId = generateMessageId(connection.email_address);
    const raw = buildRawEmail(connection.email_address, params.to, params.subject, html, {
      messageId: rfcMessageId,
      inReplyTo: params.inReplyToMessageId,
    });

    // Send via Gmail API
    const requestBody: Record<string, string> = { raw };
    if (params.threadId) {
      requestBody.threadId = params.threadId;
    }

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      return {
        success: false,
        error: errorBody?.error?.message ?? `Gmail API error: ${response.status}`,
      };
    }

    const result = (await response.json()) as { id: string; threadId?: string };

    // Fetch threadId for reply tracking if not returned directly
    let threadId = result.threadId;
    if (!threadId && result.id) {
      try {
        const msgResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${result.id}?fields=threadId`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (msgResponse.ok) {
          const msgData = (await msgResponse.json()) as { threadId?: string };
          threadId = msgData.threadId;
        }
      } catch {
        // threadId fetch failed — reply tracking will use fallback
      }
    }

    return { success: true, messageId: result.id, threadId, rfcMessageId };
  }
}
