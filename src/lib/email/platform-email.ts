import { Resend } from 'resend';

const FROM_EMAIL = 'EnriqueceAI <noreply@enriqueceai.com.br>';

function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY environment variable is not set');
  return new Resend(apiKey);
}

interface SendPlatformEmailParams {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send email from the platform address (noreply@enriqueceai.com.br) via Resend.
 * Use this for system notifications, feedback emails, and other platform communications.
 * Does NOT depend on user's Gmail connection.
 */
export async function sendPlatformEmail(params: SendPlatformEmailParams): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    if (error) {
      console.error('[platform-email] Resend error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[platform-email] Unexpected error:', message);
    return { success: false, error: message };
  }
}
