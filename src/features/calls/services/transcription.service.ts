import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { buildSpicedAnalysisPrompt, mapSpicedResponseToDbNames, SPICED_FIELD_NAMES, type SpicedLeadContext } from '@/features/ai/prompts/spiced-analysis';
import { TRANSCRIPTION_MIN_DURATION_SECONDS } from '../schemas/call.schemas';

const WHISPER_MODEL = 'whisper-1';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
// 2048 truncated SPICED responses on long calls (~13min, transcription >11k chars).
// 8192 fits the 6-field JSON output for any realistic call length.
const CLAUDE_MAX_TOKENS = 8192;

interface CallForTranscription {
  id: string;
  org_id: string;
  lead_id: string | null;
  recording_url: string | null;
  duration_seconds: number;
  transcription_status: string;
}

/**
 * Main orchestrator: download audio → transcribe → SPICED analysis → save
 */
export async function processCallTranscription(callId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  // Fetch call
  const { data: call } = (await from(supabase, 'calls')
    .select('id, org_id, lead_id, recording_url, duration_seconds, transcription_status')
    .eq('id', callId)
    .single()) as { data: CallForTranscription | null };

  if (!call) {
    console.error('[transcription] Call not found:', callId);
    return;
  }

  // Guards
  if (!call.recording_url) {
    await updateTranscriptionStatus(supabase, callId, 'skipped', null, 'no_recording_url');
    return;
  }

  if (call.duration_seconds < TRANSCRIPTION_MIN_DURATION_SECONDS) {
    await updateTranscriptionStatus(supabase, callId, 'skipped', null, 'duration_too_short');
    return;
  }

  if (call.transcription_status === 'completed' || call.transcription_status === 'processing') {
    return;
  }

  // Mark as processing
  await updateTranscriptionStatus(supabase, callId, 'processing');

  try {
    // Step 1: Download audio
    const audioBuffer = await downloadAudio(call.recording_url);

    // Step 2: Transcribe via Whisper
    const transcription = await transcribeWithWhisper(audioBuffer);

    // Step 3: Save transcription
    await from(supabase, 'calls')
      .update({
        transcription,
        transcription_status: 'completed',
        transcription_error: null,
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('id', callId);

    // Step 4: SPICED analysis (only if lead exists)
    if (call.lead_id) {
      try {
        await analyzeAndSaveSpiced(supabase, call.org_id, call.lead_id, transcription);
      } catch (spicedErr) {
        // Partial success: transcription saved, SPICED failed
        const errMsg = spicedErr instanceof Error ? spicedErr.message : String(spicedErr);
        console.error(`[transcription] SPICED analysis failed for lead ${call.lead_id}: ${errMsg}`);
        // Persist error in call metadata for debugging (Vercel truncates logs)
        await from(supabase, 'calls')
          .update({ metadata: { spiced_error: errMsg.slice(0, 500), spiced_failed_at: new Date().toISOString() } } as Record<string, unknown>)
          .eq('id', callId);
      }
    }

    // Step 5: Track AI usage
    await incrementAiUsage(supabase, call.org_id);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'unknown_error';
    console.error('[transcription] Failed:', errorMessage);
    await updateTranscriptionStatus(supabase, callId, 'failed', null, errorMessage);
  }
}

async function downloadAudio(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`audio_download_failed: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function transcribeWithWhisper(audioBuffer: Buffer): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não configurada');
  }

  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' }), 'recording.mp3');
  formData.append('model', WHISPER_MODEL);
  formData.append('language', 'pt');
  formData.append('response_format', 'text');

  let lastError: Error | null = null;

  // Retry up to 2 times
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        signal: AbortSignal.timeout(120_000),
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`whisper_api_error: ${response.status} ${body}`);
      }

      const text = await response.text();
      if (!text.trim()) {
        throw new Error('whisper_empty_response');
      }

      return text.trim();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error('whisper_unknown_error');
}

async function analyzeAndSaveSpiced(
  supabase: ReturnType<typeof createServiceRoleClient>,
  orgId: string,
  leadId: string,
  transcription: string,
): Promise<void> {
  // Find SPICED custom fields for this org
  const { data: customFields } = (await from(supabase, 'custom_fields')
    .select('id, field_name')
    .eq('org_id', orgId)
    .in('field_name', SPICED_FIELD_NAMES)) as { data: { id: string; field_name: string }[] | null };

  if (!customFields || customFields.length === 0) {
    console.warn('[transcription] No SPICED fields found for org:', orgId);
    return;
  }

  const fieldNameToId = new Map(customFields.map((f) => [f.field_name, f.id]));

  // Build lead context (cabeçalho) for the prompt
  const { data: leadInfo } = (await from(supabase, 'leads')
    .select('first_name, last_name, job_title, razao_social, nome_fantasia, cnpj, cnae, endereco, lead_source, canal, website, instagram, linkedin')
    .eq('id', leadId)
    .single()) as {
    data: {
      first_name: string | null;
      last_name: string | null;
      job_title: string | null;
      razao_social: string | null;
      nome_fantasia: string | null;
      cnpj: string | null;
      cnae: string | null;
      endereco: { cidade?: string; uf?: string } | null;
      lead_source: string | null;
      canal: string | null;
      website: string | null;
      instagram: string | null;
      linkedin: string | null;
    } | null;
  };

  const leadContext: SpicedLeadContext | undefined = leadInfo
    ? {
        decisorNome: [leadInfo.first_name, leadInfo.last_name].filter(Boolean).join(' ') || null,
        decisorCargo: leadInfo.job_title,
        empresa: leadInfo.razao_social ?? leadInfo.nome_fantasia,
        cnpj: leadInfo.cnpj,
        segmento: leadInfo.cnae,
        cidade: leadInfo.endereco?.cidade ?? null,
        uf: leadInfo.endereco?.uf ?? null,
        origem: [leadInfo.lead_source, leadInfo.canal].filter(Boolean).join(' / ') || null,
        site: leadInfo.website,
        instagram: leadInfo.instagram,
        linkedin: leadInfo.linkedin,
      }
    : undefined;

  // Call Claude for SPICED analysis
  const prompt = buildSpicedAnalysisPrompt(transcription, leadContext);
  const spicedJson = await callClaudeForSpiced(prompt);

  // Map prompt response keys → database field names → field IDs
  const dbMapped = mapSpicedResponseToDbNames(spicedJson);
  const spicedValues: Record<string, string> = {};
  for (const [dbFieldName, value] of Object.entries(dbMapped)) {
    const fieldId = fieldNameToId.get(dbFieldName);
    if (fieldId && value) {
      spicedValues[fieldId] = value;
    }
  }

  if (Object.keys(spicedValues).length === 0) return;

  // Merge with existing custom_field_values
  const { data: lead } = (await from(supabase, 'leads')
    .select('custom_field_values')
    .eq('id', leadId)
    .single()) as { data: { custom_field_values: Record<string, string> | null } | null };

  const merged = { ...(lead?.custom_field_values ?? {}), ...spicedValues };

  await from(supabase, 'leads')
    .update({ custom_field_values: merged } as Record<string, unknown>)
    .eq('id', leadId);

  // Log SPICED analysis to lead timeline
  const filledFields = Object.entries(dbMapped)
    .filter(([, v]) => v?.trim())
    .map(([name, value]) => `${name}:\n${value}`)
    .join('\n\n');

  if (filledFields) {
    await from(supabase, 'interactions')
      .insert({
        org_id: orgId,
        lead_id: leadId,
        channel: 'system',
        type: 'sent',
        message_content: filledFields,
        metadata: {
          system_event: 'spiced_analysis',
          fields_filled: Object.keys(dbMapped).filter((k) => dbMapped[k]?.trim()),
        },
      } as Record<string, unknown>);
  }
}

async function callClaudeForSpiced(prompt: string): Promise<Record<string, string>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY não configurada');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(90_000),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => 'no body');
    throw new Error(`claude_api_error: ${response.status} — ${errBody.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };

  const text = data.content.find((c) => c.type === 'text')?.text ?? '';

  // Parse JSON — extract object from response (handles code fences, extra text, etc.)
  // Most robust: find the first { and last } in the entire response
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`claude_response_no_json: ${text.substring(0, 200)}`);
  }
  let cleaned = text.substring(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(cleaned) as Record<string, string>;
  } catch {
    // Step 2: Claude returns literal newlines inside JSON string values.
    // Escape newlines only INSIDE quoted strings, not structural ones.
    cleaned = cleaned.replace(/"([^"]*?)"/g, (_match, value: string) => {
      const escaped = value.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
      return `"${escaped}"`;
    });
    try {
      return JSON.parse(cleaned) as Record<string, string>;
    } catch {
      throw new Error(`claude_response_parse_failed: ${text.substring(0, 200)}`);
    }
  }
}

async function updateTranscriptionStatus(
  supabase: ReturnType<typeof createServiceRoleClient>,
  callId: string,
  status: string,
  transcription?: string | null,
  error?: string | null,
): Promise<void> {
  const updates: Record<string, unknown> = {
    transcription_status: status,
    updated_at: new Date().toISOString(),
  };
  if (transcription !== undefined) updates.transcription = transcription;
  if (error !== undefined) updates.transcription_error = error;

  await from(supabase, 'calls')
    .update(updates)
    .eq('id', callId);
}

async function incrementAiUsage(
  supabase: ReturnType<typeof createServiceRoleClient>,
  orgId: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = (await from(supabase, 'ai_usage')
    .select('id, generation_count')
    .eq('org_id', orgId)
    .eq('usage_date', today)
    .maybeSingle()) as { data: { id: string; generation_count: number } | null };

  if (existing) {
    await from(supabase, 'ai_usage')
      .update({ generation_count: existing.generation_count + 1 } as Record<string, unknown>)
      .eq('id', existing.id);
  } else {
    await from(supabase, 'ai_usage')
      .insert({ org_id: orgId, usage_date: today, generation_count: 1 } as Record<string, unknown>);
  }
}
