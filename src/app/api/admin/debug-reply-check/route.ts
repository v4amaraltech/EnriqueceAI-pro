import { NextResponse } from 'next/server';

import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { decrypt } from '@/lib/security/encryption';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';
import {
  type GmailConnection,
  refreshAccessToken,
} from '@/features/integrations/services/email.service';

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!verifyServiceRole(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const steps: string[] = [];

  try {
    // Step 1: Find a sent email interaction with thread_id
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const { data: sent } = (await from(supabase, 'interactions')
      .select('id, lead_id, cadence_id, external_id, metadata, performed_by')
      .eq('type', 'sent')
      .eq('channel', 'email')
      .not('external_id', 'is', null)
      .gte('created_at', cutoff.toISOString())
      .limit(1)
      .single()) as { data: { id: string; lead_id: string; cadence_id: string; external_id: string; metadata: Record<string, unknown> | null; performed_by: string | null } | null };

    if (!sent) {
      return NextResponse.json({ steps: ['No sent interactions found'], error: 'no_sent' });
    }
    steps.push(`Found sent interaction: ${sent.id}, external_id: ${sent.external_id}`);

    const threadId = sent.metadata?.thread_id as string | undefined;
    steps.push(`Thread ID from metadata: ${threadId ?? 'NOT FOUND'}`);

    // Step 2: Find the cadence creator
    const { data: cadence } = (await from(supabase, 'cadences')
      .select('id, created_by, name')
      .eq('id', sent.cadence_id)
      .single()) as { data: { id: string; created_by: string | null; name: string } | null };

    if (!cadence) {
      return NextResponse.json({ steps: [...steps, 'Cadence not found'], error: 'no_cadence' });
    }
    steps.push(`Cadence: ${cadence.name}, created_by: ${cadence.created_by}`);

    if (!cadence.created_by) {
      return NextResponse.json({ steps: [...steps, 'Cadence has no created_by'], error: 'no_creator' });
    }

    // Step 3: Get Gmail connection
    const { data: member } = (await from(supabase, 'organization_members')
      .select('org_id')
      .eq('user_id', cadence.created_by)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()) as { data: { org_id: string } | null };

    if (!member) {
      return NextResponse.json({ steps: [...steps, 'No active org member found'], error: 'no_member' });
    }
    steps.push(`Member org: ${member.org_id}`);

    const { data: connection } = (await from(supabase, 'gmail_connections')
      .select('*')
      .eq('org_id', member.org_id)
      .eq('user_id', cadence.created_by)
      .in('status', ['connected', 'error'])
      .maybeSingle()) as { data: GmailConnection | null };

    if (!connection) {
      return NextResponse.json({ steps: [...steps, 'No Gmail connection found'], error: 'no_gmail' });
    }
    steps.push(`Gmail connection: ${connection.id}, status: ${connection.status}, expires: ${connection.token_expires_at}`);

    // Step 4: Get valid token
    let accessToken: string;
    const isExpired = new Date(connection.token_expires_at) < new Date();
    steps.push(`Token expired: ${isExpired}`);

    if (connection.status === 'error' || isExpired) {
      steps.push('Attempting token refresh...');
      const refreshResult = await refreshAccessToken(connection, supabase);
      if ('error' in refreshResult) {
        return NextResponse.json({ steps: [...steps, `Token refresh FAILED: ${refreshResult.error}`], error: 'refresh_failed' });
      }
      accessToken = refreshResult.accessToken;
      steps.push('Token refresh SUCCESS');
    } else {
      accessToken = decrypt(connection.access_token_encrypted);
      steps.push('Using existing token');
    }

    // Step 5: Try to fetch a Gmail thread
    if (!threadId) {
      // Try getting threadId from Gmail
      steps.push('Fetching threadId from Gmail API...');
      const msgResp = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${sent.external_id}?fields=threadId`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      steps.push(`Gmail message API response: ${msgResp.status}`);
      if (msgResp.ok) {
        const msgData = (await msgResp.json()) as { threadId?: string };
        steps.push(`ThreadId from API: ${msgData.threadId ?? 'null'}`);
      } else {
        const errText = await msgResp.text();
        steps.push(`Gmail API error: ${errText.slice(0, 200)}`);
        return NextResponse.json({ steps, error: 'gmail_api_error' });
      }
    }

    const resolvedThreadId = threadId;
    if (!resolvedThreadId) {
      return NextResponse.json({ steps: [...steps, 'No threadId available'], error: 'no_thread_id' });
    }

    // Step 6: Check thread for replies
    steps.push(`Fetching thread ${resolvedThreadId}...`);
    const threadResp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${resolvedThreadId}?fields=messages(id,payload(headers))`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    steps.push(`Thread API response: ${threadResp.status}`);

    if (!threadResp.ok) {
      const errText = await threadResp.text();
      steps.push(`Thread API error: ${errText.slice(0, 200)}`);
      return NextResponse.json({ steps, error: 'thread_api_error' });
    }

    const threadData = (await threadResp.json()) as { messages?: Array<{ id: string; payload?: { headers?: Array<{ name: string; value: string }> } }> };
    const messages = threadData.messages ?? [];
    steps.push(`Thread has ${messages.length} messages`);

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      const from = msg.payload?.headers?.find((h) => h.name.toLowerCase() === 'from')?.value ?? 'unknown';
      const subject = msg.payload?.headers?.find((h) => h.name.toLowerCase() === 'subject')?.value ?? 'unknown';
      steps.push(`  Message ${i}: from="${from.slice(0, 60)}" subject="${subject.slice(0, 60)}"`);
    }

    const hasReply = messages.length > 1;
    steps.push(`Has reply: ${hasReply}`);

    return NextResponse.json({ steps, result: hasReply ? 'REPLY_FOUND' : 'NO_REPLY' });
  } catch (err) {
    steps.push(`Exception: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ steps, error: 'exception' }, { status: 500 });
  }
}
