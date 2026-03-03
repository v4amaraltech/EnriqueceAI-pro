export interface PlanRow {
  id: string;
  name: string;
  slug: string;
  price_cents: number;
  max_leads: number;
  max_ai_per_day: number; // -1 = unlimited
  max_whatsapp_per_month: number;
  included_users: number;
  additional_user_price_cents: number;
  features: PlanFeatures;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanFeatures {
  enrichment: 'basic' | 'lemit' | 'full';
  crm: boolean;
  calendar: boolean;
  [key: string]: unknown;
}

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing';

export interface SubscriptionRow {
  id: string;
  org_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string;
  stripe_subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppCreditsRow {
  id: string;
  org_id: string;
  plan_credits: number;
  used_credits: number;
  overage_count: number;
  period: string; // YYYY-MM
}

export interface AiUsageRow {
  id: string;
  org_id: string;
  usage_date: string;
  generation_count: number;
  daily_limit: number;
}

export interface BillingOverview {
  plan: PlanRow;
  subscription: SubscriptionRow;
  memberCount: number;
  additionalUsers: number;
  monthlyTotal: number;
  aiUsageToday: { used: number; limit: number };
  whatsappUsage: { used: number; limit: number; period: string };
}

export interface PlanComparison {
  plans: PlanRow[];
  currentPlanSlug: string;
}

export interface AiDailyUsage {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface UsageDashboardData {
  limits: import('../services/feature-flags').UsageLimits;
  plan: PlanRow;
  aiHistory: AiDailyUsage[];
}
