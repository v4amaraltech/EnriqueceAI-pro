import { NextResponse } from 'next/server';

import { expireTrialsCron } from '@/features/billing/actions/expire-trials';

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await expireTrialsCron();
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    console.error('Expire trials cron failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
