'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { ERR_INVALID_PARAMS, ERR_MISSING_LEAD_NAME, ERR_NOT_CONFIGURED, ERR_RATE_LIMITED } from '@/lib/constants/error-codes';

import { AIService } from '../services/ai.service';
import type { AIUsageInfo, GenerateMessageRequest, GenerateMessageResult } from '../types';

export async function generateMessageAction(
  request: GenerateMessageRequest,
): Promise<ActionResult<GenerateMessageResult>> {
  try {
    const auth = await getAuthOrgIdResult();
    if (!auth.success) return auth;
    const { orgId } = auth.data;

    // Validate input
    if (!request.channel || !request.tone || !request.leadContext) {
      return { success: false, error: 'Parâmetros inválidos', code: ERR_INVALID_PARAMS };
    }

    if (!request.leadContext.nome_fantasia && !request.leadContext.razao_social) {
      return { success: false, error: 'Lead deve ter nome fantasia ou razão social', code: ERR_MISSING_LEAD_NAME };
    }

    const result = await AIService.generateMessage(request, orgId);
    return { success: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao gerar mensagem';

    if (message.includes('Limite diário')) {
      return { success: false, error: message, code: ERR_RATE_LIMITED };
    }
    if (message.includes('ANTHROPIC_API_KEY')) {
      return { success: false, error: 'Serviço de IA não configurado', code: ERR_NOT_CONFIGURED };
    }

    return { success: false, error: message };
  }
}

export async function getAIUsageAction(): Promise<ActionResult<AIUsageInfo>> {
  try {
    const auth = await getAuthOrgIdResult();
    if (!auth.success) return auth;
    const { orgId } = auth.data;

    const usage = await AIService.getUsage(orgId);
    return { success: true, data: usage };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao buscar uso de IA';
    return { success: false, error: message };
  }
}
