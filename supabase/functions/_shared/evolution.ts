// Evolution API helpers for Edge Functions

const EVOLUTION_API_URL = (Deno.env.get('EVOLUTION_API_URL') || '').replace(/\/+$/, '');
const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY') || '';

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Common headers for Evolution API requests */
function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: EVOLUTION_API_KEY,
  };
}

/** Generate an instance name from an org ID and optional user ID.
 *  When retry=true, appends a short timestamp suffix to avoid "already in use" conflicts.
 */
export function generateInstanceName(orgId: string, userId?: string, retry = false): string {
  const orgShort = orgId.replace(/-/g, '').slice(0, 8);
  const suffix = retry ? `_${Date.now().toString(36).slice(-4)}` : '';
  if (userId) {
    const userShort = userId.replace(/-/g, '').slice(0, 8);
    return `ea_${orgShort}_${userShort}${suffix}`;
  }
  return `ea_${orgShort}${suffix}`;
}

// ---------------------------------------------------------------------------
// Instance lifecycle
// ---------------------------------------------------------------------------

/** Create a new instance in Evolution API */
export async function createInstance(
  instanceName: string,
  webhookUrl: string,
  webhookSecret: string,
): Promise<ApiResult<{ instance: Record<string, unknown>; qrcode?: { base64?: string } }>> {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        instanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        webhook: {
          url: webhookUrl,
          headers: { 'X-EVOLUTION-SECRET': webhookSecret },
          byEvents: false,
          base64: true,
          events: [
            'CONNECTION_UPDATE',
            'QRCODE_UPDATED',
            'MESSAGES_UPSERT',
            'MESSAGES_UPDATE',
          ],
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Evolution API ${res.status}: ${body}` };
    }

    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Request a QR code / connect for an existing instance */
export async function connectInstance(
  instanceName: string,
): Promise<ApiResult<{ base64?: string; code?: string }>> {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
      method: 'GET',
      headers: headers(),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Evolution API ${res.status}: ${body}` };
    }

    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Get the current connection state from Evolution */
export async function getConnectionState(
  instanceName: string,
): Promise<ApiResult<{ instance: { state: string; [key: string]: unknown } }>> {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`, {
      method: 'GET',
      headers: headers(),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Evolution API ${res.status}: ${body}` };
    }

    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Fetch instance details */
export async function fetchInstance(
  instanceName: string,
): Promise<ApiResult<Record<string, unknown>>> {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances?instanceName=${instanceName}`, {
      method: 'GET',
      headers: headers(),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Evolution API ${res.status}: ${body}` };
    }

    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data[0] : data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Restart an instance */
export async function restartInstance(
  instanceName: string,
): Promise<ApiResult<Record<string, unknown>>> {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/restart/${instanceName}`, {
      method: 'PUT',
      headers: headers(),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Evolution API ${res.status}: ${body}` };
    }

    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Delete an instance from Evolution API */
export async function deleteInstance(
  instanceName: string,
): Promise<ApiResult<Record<string, unknown>>> {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/delete/${instanceName}`, {
      method: 'DELETE',
      headers: headers(),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Evolution API ${res.status}: ${body}` };
    }

    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Logout/disconnect an instance from Evolution API */
export async function logoutInstance(
  instanceName: string,
): Promise<ApiResult<Record<string, unknown>>> {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/logout/${instanceName}`, {
      method: 'DELETE',
      headers: headers(),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Evolution API ${res.status}: ${body}` };
    }

    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Check if Evolution API is healthy */
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
      method: 'GET',
      headers: headers(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize Evolution state strings to our DB status enum */
export function normalizeConnectionState(
  state: string,
): 'connecting' | 'connected' | 'disconnected' | 'error' {
  const s = (state || '').toLowerCase();
  if (s === 'open' || s === 'connected') return 'connected';
  if (s === 'connecting' || s === 'qr') return 'connecting';
  if (s === 'close' || s === 'disconnected') return 'disconnected';
  return 'error';
}

/** Try to extract a phone number from various Evolution payloads. Different
 *  Evolution versions/events expose the WhatsApp ID under different keys —
 *  `instance.owner`, `instance.ownerJid`, `data.instance.ownerJid`, `data.wuid`,
 *  `data.user.id`, etc. — all in the JID format `5511999999999@s.whatsapp.net`. */
export function extractPhoneFromPayload(payload: Record<string, unknown>): string | null {
  const candidates: unknown[] = [
    (payload as { instance?: { owner?: string } })?.instance?.owner,
    (payload as { instance?: { ownerJid?: string } })?.instance?.ownerJid,
    (payload as { instance?: { wuid?: string } })?.instance?.wuid,
    (payload as { data?: { instance?: { owner?: string; ownerJid?: string; wuid?: string } } })?.data?.instance?.owner,
    (payload as { data?: { instance?: { ownerJid?: string } } })?.data?.instance?.ownerJid,
    (payload as { data?: { instance?: { wuid?: string } } })?.data?.instance?.wuid,
    (payload as { data?: { wuid?: string } })?.data?.wuid,
    (payload as { data?: { user?: { id?: string } } })?.data?.user?.id,
    (payload as { wuid?: string })?.wuid,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) {
      const match = candidate.match(/^(\d+)/); // strip @s.whatsapp.net or :device suffix
      if (match) return match[1]!;
    }
  }

  // Direct phone field
  const phone =
    (payload as { phone?: string })?.phone ||
    (payload as { data?: { phone?: string } })?.data?.phone;
  if (typeof phone === 'string' && phone) return phone;

  return null;
}
