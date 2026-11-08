// Auth feature barrel export — Contract Pattern

// Contract types
export type { AuthContract, MemberRole, Organization, OrganizationMemberRow } from './auth.contract';

// Row types
export type {
  MemberWithOrganization,
  OrganizationRow,
  OrganizationWithMembers,
} from './types';

// Service factory
export { createAuthService } from './services/auth.service';

// Client hooks
export { useAuth } from './hooks/useAuth';
export { useOrganization } from './hooks/useOrganization';

// Context provider
export { OrganizationProvider } from './components/OrganizationProvider';

// Server Actions
export { signIn } from './actions/sign-in';
export { signInWithGoogle } from './actions/sign-in-google';
export { signOut } from './actions/sign-out';
export { signUp } from './actions/sign-up';
export { resetPassword } from './actions/reset-password';
export { updateOrganization } from './actions/update-organization';
export { inviteMember } from './actions/invite-member';
export { updateMemberStatus } from './actions/update-member-status';
export { updateMemberRole } from './actions/update-member-role';
export { acceptPendingInvite } from './actions/accept-invite';
export { acceptOrgInvite } from './actions/accept-org-invite';

// Schemas & types
export {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from './schemas/auth.schemas';
export type {
  ForgotPasswordInput,
  ResetPasswordInput,
  SignInInput,
  SignUpInput,
} from './schemas/auth.schemas';
export { updateOrganizationSchema } from './schemas/organization.schemas';
export type { UpdateOrganizationInput } from './schemas/organization.schemas';
export {
  inviteMemberSchema,
  updateMemberRoleSchema,
  updateMemberStatusSchema,
} from './schemas/member.schemas';

// Components
export { ForgotPasswordForm } from './components/ForgotPasswordForm';
export { GoogleButton } from './components/GoogleButton';
export { InviteMemberDialog } from './components/InviteMemberDialog';
export { LoginForm } from './components/LoginForm';
export { OrganizationSettings } from './components/OrganizationSettings';
export { SignupForm } from './components/SignupForm';
export { UserManagement } from './components/UserManagement';
