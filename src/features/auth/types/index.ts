export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  onboarding_step: number | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

export type MemberRole = 'manager' | 'sdr';
export type MemberStatus = 'invited' | 'active' | 'suspended' | 'removed';

export interface OrganizationMemberRow {
  id: string;
  org_id: string;
  user_id: string;
  role: MemberRole;
  status: MemberStatus;
  invited_at: string;
  accepted_at: string | null;
  invited_expires_at: string | null;
  created_at: string;
  updated_at: string;
  name?: string;
}

export interface OrganizationWithMembers extends OrganizationRow {
  members: OrganizationMemberRow[];
}

export interface MemberWithOrganization extends OrganizationMemberRow {
  organization: OrganizationRow;
}
