import { NextResponse } from 'next/server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_RESULTS = ['meeting_done', 'no_show', 'rescheduled'];

interface FeedbackRequest {
  id: string;
  responded_at: string | null;
  expires_at: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, result, rating, comment } = body;

    // Validate input
    if (!token || !UUID_REGEX.test(token)) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 400 });
    }
    if (!result || !VALID_RESULTS.includes(result)) {
      return NextResponse.json({ error: 'Resultado inválido' }, { status: 400 });
    }
    if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Nota deve ser entre 1 e 5' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Fetch feedback request
    const { data: feedbackReq } = (await from(supabase, 'closer_feedback_requests')
      .select('id, responded_at, expires_at')
      .eq('token', token)
      .single()) as { data: FeedbackRequest | null };

    if (!feedbackReq) {
      return NextResponse.json({ error: 'Feedback não encontrado' }, { status: 404 });
    }

    if (feedbackReq.responded_at) {
      return NextResponse.json({ error: 'Este feedback já foi enviado' }, { status: 409 });
    }

    if (new Date(feedbackReq.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Este link expirou' }, { status: 410 });
    }

    // Save feedback
    const { error: updateError } = await from(supabase, 'closer_feedback_requests')
      .update({
        result,
        rating,
        comment: comment || null,
        responded_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('id', feedbackReq.id);

    if (updateError) {
      console.error('[api/feedback] Update error:', updateError);
      return NextResponse.json({ error: 'Erro ao salvar feedback' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/feedback] Unexpected error:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
