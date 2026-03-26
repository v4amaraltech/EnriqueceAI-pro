export interface AdminMetrics {
  totalOrgs: number;
  totalMembers: number;
  totalLeads: number;
  activeTrials: number;
}

export interface AdminOrgRow {
  id: string;
  name: string;
  created_at: string;
  members_count: number;
  leads_count: number;
  plan_name: string | null;
  subscription_status: string | null;
}

export interface AdminDashboardData {
  metrics: AdminMetrics;
  organizations: AdminOrgRow[];
}
