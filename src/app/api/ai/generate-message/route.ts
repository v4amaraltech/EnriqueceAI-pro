import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/require-auth';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { AIService } from '@/features/ai/services/ai.service';
import type { ChannelTarget, GenerateMessageRequest, LeadContext, ToneOption } from '@/features/ai/types';

const VALID_TONES: ToneOption[] = ['professional', 'consultative', 'direct', 'friendly'];
const VALID_CHANNELS: ChannelTarget[] = ['email', 'whatsapp'];

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();

    // Per-user rate limit: 10 requests per minute
    const rl = checkRateLimit(`ai:${user.id}`, 10, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Muitas requisições. Tente novamente em alguns segundos.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.retryAfterMs ?? 0) / 1000)) } },
      );
    }

    const supabase = await createServerSupabaseClient();

    const { data: member } = (await supabase
      .from('organization_members')
      .select('org_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()) as { data: { org_id: string } | null };

    if (!member) {
      return NextResponse.json({ error: 'Organização não encontrada' }, { status: 403 });
    }

    const body = (await request.json()) as Partial<GenerateMessageRequest>;

    // Validate channel
    if (!body.channel || !VALID_CHANNELS.includes(body.channel)) {
      return NextResponse.json(
        { error: 'Canal inválido. Use "email" ou "whatsapp".' },
        { status: 400 },
      );
    }

    // Validate tone
    if (!body.tone || !VALID_TONES.includes(body.tone)) {
      return NextResponse.json(
        { error: 'Tom inválido. Use "professional", "consultative", "direct" ou "friendly".' },
        { status: 400 },
      );
    }

    // Validate lead context
    if (!body.leadContext || typeof body.leadContext !== 'object') {
      return NextResponse.json(
        { error: 'Contexto do lead é obrigatório.' },
        { status: 400 },
      );
    }

    const lead = body.leadContext as LeadContext;
    if (!lead.nome_fantasia && !lead.razao_social) {
      return NextResponse.json(
        { error: 'Lead deve ter nome fantasia ou razão social.' },
        { status: 400 },
      );
    }

    const result = await AIService.generateMessage(
      {
        channel: body.channel,
        tone: body.tone,
        leadContext: lead,
        additionalContext: body.additionalContext,
      },
      member.org_id,
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno';

    if (message.includes('Limite diário')) {
      return NextResponse.json({ error: message }, { status: 429 });
    }
    if (message.includes('ANTHROPIC_API_KEY')) {
      return NextResponse.json({ error: 'Serviço de IA não configurado' }, { status: 503 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
