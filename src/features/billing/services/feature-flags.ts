import { formatLimit as formatPlanLimit, isUnlimited } from '@/lib/utils/plan-limits';

import type { PlanFeatures, PlanRow } from '../types';

export interface UsageLimits {
  leads: { current: number; max: number; exceeded: boolean };
  aiPerDay: { current: number; max: number; exceeded: boolean; unlimited: boolean };
  whatsappPerMonth: { current: number; max: number; exceeded: boolean };
  users: { current: number; included: number; additional: number };
}

export function checkFeature(
  features: PlanFeatures,
  feature: keyof PlanFeatures,
): boolean {
  const value = features[feature];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value !== 'basic';
  return !!value;
}

export function calculateUsageLimits(
  plan: PlanRow,
  currentLeads: number,
  aiUsedToday: number,
  waUsedThisMonth: number,
  memberCount: number,
): UsageLimits {
  const leadsUnlimited = isUnlimited(plan.max_leads);
  const aiUnlimited = isUnlimited(plan.max_ai_per_day);
  const waUnlimited = isUnlimited(plan.max_whatsapp_per_month);
  const additionalUsers = Math.max(0, memberCount - plan.included_users);

  return {
    leads: {
      current: currentLeads,
      max: plan.max_leads,
      exceeded: !leadsUnlimited && currentLeads >= plan.max_leads,
    },
    aiPerDay: {
      current: aiUsedToday,
      max: plan.max_ai_per_day,
      exceeded: !aiUnlimited && aiUsedToday >= plan.max_ai_per_day,
      unlimited: aiUnlimited,
    },
    whatsappPerMonth: {
      current: waUsedThisMonth,
      max: plan.max_whatsapp_per_month,
      exceeded: !waUnlimited && waUsedThisMonth >= plan.max_whatsapp_per_month,
    },
    users: {
      current: memberCount,
      included: plan.included_users,
      additional: additionalUsers,
    },
  };
}

export function calculateMonthlyTotal(
  plan: PlanRow,
  memberCount: number,
): number {
  const additionalUsers = Math.max(0, memberCount - plan.included_users);
  return plan.price_cents + additionalUsers * plan.additional_user_price_cents;
}

export function isNearLimit(current: number, max: number, threshold = 0.8): boolean {
  if (isUnlimited(max) || max <= 0) return false;
  return current / max >= threshold;
}

export interface PlanDiffItem {
  name: string;
  description: string;
}

export interface PlanLimitChange {
  name: string;
  from: number | string;
  to: number | string;
}

export interface PlanDiff {
  gained: PlanDiffItem[];
  lost: PlanDiffItem[];
  limitsChanged: PlanLimitChange[];
}

const ENRICHMENT_LABELS: Record<string, string> = {
  basic: 'Básico',
  lemit: 'Intermediário',
  full: 'Completo',
};

function formatLimit(value: number, suffix: string): string {
  if (isUnlimited(value)) return 'Ilimitado';
  return `${value.toLocaleString('pt-BR')} ${suffix}`;
}

export function getPlanDiff(currentPlan: PlanRow, targetPlan: PlanRow): PlanDiff {
  const gained: PlanDiffItem[] = [];
  const lost: PlanDiffItem[] = [];
  const limitsChanged: PlanLimitChange[] = [];

  // Boolean features
  if (!currentPlan.features.crm && targetPlan.features.crm) {
    gained.push({ name: 'CRM', description: 'Integração com HubSpot, Pipedrive e RD Station' });
  } else if (currentPlan.features.crm && !targetPlan.features.crm) {
    lost.push({ name: 'CRM', description: 'Integração com HubSpot, Pipedrive e RD Station' });
  }

  if (!currentPlan.features.calendar && targetPlan.features.calendar) {
    gained.push({ name: 'Calendário', description: 'Integração com Google Calendar' });
  } else if (currentPlan.features.calendar && !targetPlan.features.calendar) {
    lost.push({ name: 'Calendário', description: 'Integração com Google Calendar' });
  }

  // Enrichment level
  const enrichmentOrder = ['basic', 'lemit', 'full'];
  const currentIdx = enrichmentOrder.indexOf(currentPlan.features.enrichment);
  const targetIdx = enrichmentOrder.indexOf(targetPlan.features.enrichment);
  if (targetIdx > currentIdx) {
    gained.push({
      name: `Enriquecimento ${ENRICHMENT_LABELS[targetPlan.features.enrichment] ?? targetPlan.features.enrichment}`,
      description: `Upgrade de ${ENRICHMENT_LABELS[currentPlan.features.enrichment] ?? currentPlan.features.enrichment} para ${ENRICHMENT_LABELS[targetPlan.features.enrichment] ?? targetPlan.features.enrichment}`,
    });
  } else if (targetIdx < currentIdx) {
    lost.push({
      name: `Enriquecimento ${ENRICHMENT_LABELS[currentPlan.features.enrichment] ?? currentPlan.features.enrichment}`,
      description: `Downgrade de ${ENRICHMENT_LABELS[currentPlan.features.enrichment] ?? currentPlan.features.enrichment} para ${ENRICHMENT_LABELS[targetPlan.features.enrichment] ?? targetPlan.features.enrichment}`,
    });
  }

  // Numeric limits
  if (currentPlan.max_leads !== targetPlan.max_leads) {
    limitsChanged.push({
      name: 'Leads',
      from: formatPlanLimit(currentPlan.max_leads),
      to: formatPlanLimit(targetPlan.max_leads),
    });
  }

  if (currentPlan.max_ai_per_day !== targetPlan.max_ai_per_day) {
    limitsChanged.push({
      name: 'IA por dia',
      from: formatLimit(currentPlan.max_ai_per_day, ''),
      to: formatLimit(targetPlan.max_ai_per_day, ''),
    });
  }

  if (currentPlan.max_whatsapp_per_month !== targetPlan.max_whatsapp_per_month) {
    limitsChanged.push({
      name: 'WhatsApp/mês',
      from: formatPlanLimit(currentPlan.max_whatsapp_per_month),
      to: formatPlanLimit(targetPlan.max_whatsapp_per_month),
    });
  }

  if (currentPlan.included_users !== targetPlan.included_users) {
    limitsChanged.push({
      name: 'Usuários inclusos',
      from: String(currentPlan.included_users),
      to: String(targetPlan.included_users),
    });
  }

  return { gained, lost, limitsChanged };
}

export { formatCurrencyBRL as formatCents } from '@/lib/utils/format';
