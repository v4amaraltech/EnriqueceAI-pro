import crypto from 'crypto';
import { from } from '@/lib/supabase/from';

import type { SupabaseClient } from '@supabase/supabase-js';

export type WebhookEventType =
  | 'email.sent'
  | 'email.replied'
  | 'email.bounced'
  | 'whatsapp.sent'
  | 'whatsapp.replied'
  | 'whatsapp.failed'
  | 'enrollment.completed'
  | 'enrollment.paused'
  | 'crm.synced'
  | 'crm.deal_created'
  | 'lead.created'
  | 'lead.enriched'
  | 'lead.qualified'
  | 'lead.unqualified'
  | 'call.completed'
  | 'call.missed'
  | 'call.scheduled';

interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string | null;
  events: string[];
}

interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Dispatch a webhook event to all active endpoints for an org.
 * Fire-and-forget — errors are logged but never block the caller.
 */
export async function dispatchWebhookEvent(
  supabase: SupabaseClient,
  orgId: string,
  event: WebhookEventType,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: endpoints } = (await from(supabase, 'webhook_endpoints')
      .select('id, url, secret, events')
      .eq('org_id', orgId)
      .eq('is_active', true)) as { data: WebhookEndpoint[] | null };

    if (!endpoints?.length) return;

    // Filter endpoints that subscribe to this event
    const matching = endpoints.filter(
      (ep) => ep.events.length === 0 || ep.events.includes(event),
    );

    if (!matching.length) return;

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    const body = JSON.stringify(payload);

    // Fire all webhooks concurrently, don't await completion
    const promises = matching.map((ep) => deliverWebhook(ep, body));
    Promise.allSettled(promises).then((results) => {
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r && r.status === 'rejected') {
          console.error(`[webhook-dispatch] Failed to deliver to ${matching[i]?.url}:`, r.reason);
        }
      }
    });
  } catch (err) {
    console.error(`[webhook-dispatch] Error dispatching event=${event} org=${orgId}:`, err);
  }
}

/** Deliver a webhook with HMAC signature and timeout */
async function deliverWebhook(endpoint: WebhookEndpoint, body: string): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Flux-Webhooks/1.0',
  };

  if (endpoint.secret) {
    const signature = 'sha256=' + crypto.createHmac('sha256', endpoint.secret).update(body).digest('hex');
    headers['X-Webhook-Signature'] = signature;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(`[webhook-dispatch] endpoint=${endpoint.id} url=${endpoint.url} status=${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
