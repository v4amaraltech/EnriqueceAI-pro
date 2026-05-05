import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { isUnlimited } from '@/lib/utils/plan-limits';

import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';

const ALERT_THRESHOLD = 0.8;

export interface CreditCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  isOverage: boolean;
  error?: string;
}

/**
 * Controls WhatsApp credit consumption per organization per month.
 */
export class WhatsAppCreditService {
  /**
   * Checks if the org has credits and deducts one.
   * If the row for the current period doesn't exist, creates it from the plan.
   * Over-limit sends are allowed but flagged as overage.
   */
  static async checkAndDeductCredit(
    orgId: string,
    supabaseClient?: SupabaseClient,
  ): Promise<CreditCheckResult> {
    const supabase = supabaseClient ?? await createServerSupabaseClient();
    const period = getCurrentPeriod();

    // Try to fetch existing credit row for this period
    const { data: credit } = (await from(supabase, 'whatsapp_credits')
      .select('id, plan_credits, used_credits, overage_count')
      .eq('org_id', orgId)
      .eq('period', period)
      .maybeSingle()) as {
        data: { id: string; plan_credits: number; used_credits: number; overage_count: number } | null;
      };

    if (credit) {
      return deductFromExisting(supabase, credit, orgId);
    }

    // No row for this period — create one from the org's plan
    return createAndDeduct(supabase, orgId, period);
  }
}

function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

async function deductFromExisting(
  supabase: SupabaseClient,
  credit: { id: string; plan_credits: number; used_credits: number; overage_count: number },
  orgId: string,
): Promise<CreditCheckResult> {
  const unlimited = isUnlimited(credit.plan_credits);
  const isOverage = !unlimited && credit.used_credits >= credit.plan_credits;
  const newUsed = credit.used_credits + 1;

  const updatePayload: Record<string, unknown> = {
    used_credits: newUsed,
  };
  if (isOverage) {
    updatePayload.overage_count = credit.overage_count + 1;
  }

  await from(supabase, 'whatsapp_credits')
    .update(updatePayload as Record<string, unknown>)
    .eq('id', credit.id);

  // Send alert when crossing the 80% threshold (skipped on unlimited plans)
  if (!unlimited) {
    const threshold = Math.floor(credit.plan_credits * ALERT_THRESHOLD);
    if (credit.used_credits < threshold && newUsed >= threshold) {
      fireThresholdAlert(orgId, newUsed, credit.plan_credits).catch((err) =>
        console.error('[whatsapp-credits] Failed to send threshold alert:', err),
      );
    }
  }

  return {
    allowed: true,
    used: newUsed,
    limit: credit.plan_credits,
    isOverage,
  };
}

async function createAndDeduct(
  supabase: SupabaseClient,
  orgId: string,
  period: string,
): Promise<CreditCheckResult> {
  // Fetch plan limit via subscription
  const { data: sub } = (await from(supabase, 'subscriptions')
    .select('plan:plans(max_whatsapp_per_month)')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .maybeSingle()) as {
      data: { plan: { max_whatsapp_per_month: number } } | null;
    };

  const planCredits = sub?.plan?.max_whatsapp_per_month ?? 0;

  if (planCredits === 0) {
    return { allowed: false, used: 0, limit: 0, isOverage: false, error: 'Sem plano WhatsApp ativo' };
  }

  // Insert the row for this period (deducting 1 immediately)
  const { error: insertError } = await from(supabase, 'whatsapp_credits')
    .insert({
      org_id: orgId,
      plan_credits: planCredits,
      used_credits: 1,
      overage_count: 0,
      period,
    } as Record<string, unknown>);

  if (insertError) {
    // Race condition: row was created between our select and insert
    // Retry by fetching the existing row
    const { data: retryCredit } = (await from(supabase, 'whatsapp_credits')
      .select('id, plan_credits, used_credits, overage_count')
      .eq('org_id', orgId)
      .eq('period', period)
      .maybeSingle()) as {
        data: { id: string; plan_credits: number; used_credits: number; overage_count: number } | null;
      };

    if (retryCredit) {
      return deductFromExisting(supabase, retryCredit, orgId);
    }

    return { allowed: false, used: 0, limit: planCredits, isOverage: false, error: 'Falha ao criar créditos' };
  }

  return {
    allowed: true,
    used: 1,
    limit: planCredits,
    isOverage: false,
  };
}

async function fireThresholdAlert(orgId: string, used: number, limit: number): Promise<void> {
  const pct = Math.round((used / limit) * 100);
  await createNotificationsForOrgMembers({
    orgId,
    type: 'usage_limit_alert',
    title: `WhatsApp: ${pct}% dos créditos utilizados`,
    body: `Sua organização já usou ${used} de ${limit} mensagens WhatsApp neste mês. Considere fazer upgrade do plano para evitar interrupções.`,
    resourceType: 'integration',
    metadata: { channel: 'whatsapp', used, limit, percentage: pct },
    roleFilter: 'manager',
  });
}
