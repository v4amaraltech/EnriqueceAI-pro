import { NextResponse } from 'next/server';

import { mintAssemblyAiToken } from '@/features/integrations/webphone/assemblyai-token';
import { isWebphoneLiveAmdEnabled } from '@/features/integrations/webphone/live-amd-flag';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

export const dynamic = 'force-dynamic';

/**
 * Emite o token curto da AssemblyAI para o navegador do SDR.
 * Sem sessão, sem a flag ou sem ASSEMBLYAI_API_KEY, responde enabled false
 * e o webphone não abre socket. A chave permanente não vai na resposta.
 */
export async function POST() {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return NextResponse.json({ enabled: false }, { status: 401 });

  const enabled = await isWebphoneLiveAmdEnabled({ orgId: auth.data.orgId, userId: auth.data.userId });
  if (!enabled) return NextResponse.json({ enabled: false });

  const minted = await mintAssemblyAiToken();
  if (!minted) return NextResponse.json({ enabled: false });

  return NextResponse.json({
    enabled: true,
    token: minted.token,
    expiresInSeconds: minted.expiresInSeconds,
    websocketUrl: minted.websocketUrl,
  });
}
