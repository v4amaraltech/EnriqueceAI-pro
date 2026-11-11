/**
 * Reparo de gravações cuja cópia no Storage não bate com `calls.duration_seconds`.
 *
 * NÃO está registrado em vercel.json de propósito: só roda quando chamado à mão.
 * Dry-run por padrão (nada é gravado). Uma página por chamada; repita com o
 * `nextCursor` devolvido até ele vir null.
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     "$APP/api/cron/repair-mismatched-recordings?org_id=<uuid>"                      # dry-run
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     "$APP/api/cron/repair-mismatched-recordings?org_id=<uuid>&apply=1&cursor=<id>"  # grava
 *
 * Parâmetros: org_id (obrigatório), apply=1, cursor, limit (1 a 100), days (janela, padrão 90).
 * Versão em linha de comando: scripts/repair-mismatched-recordings.ts
 */
import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { createServiceRoleClient } from '@/lib/supabase/service';
import {
  REPAIR_DEFAULT_LIMIT,
  repairRecordingsPage,
} from '@/features/calls/services/recording-repair.service';

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_DAYS = 90;

export async function POST(request: Request) {
  if (!verifyServiceRole(request) && !verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const orgId = params.get('org_id');
  if (!orgId || !UUID.test(orgId)) {
    return NextResponse.json({ error: 'org_id (uuid) required' }, { status: 400 });
  }
  const cursor = params.get('cursor');
  if (cursor && !UUID.test(cursor)) {
    return NextResponse.json({ error: 'cursor must be a uuid' }, { status: 400 });
  }
  const apply = params.get('apply') === '1' || params.get('apply') === 'true';
  const limit = Number(params.get('limit') ?? REPAIR_DEFAULT_LIMIT) || REPAIR_DEFAULT_LIMIT;
  const days = Number(params.get('days') ?? DEFAULT_DAYS) || DEFAULT_DAYS;
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const result = await repairRecordingsPage(createServiceRoleClient(), {
      orgId,
      cursor,
      limit,
      apply,
      sinceIso,
    });
    return NextResponse.json({ dryRun: !apply, ...result });
  } catch (err) {
    console.error('[repair-mismatched-recordings] error', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
