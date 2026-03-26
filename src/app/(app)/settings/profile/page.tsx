import { requireAuth } from '@/lib/auth/require-auth';

import { ProfileInfoForm } from '@/features/auth/components/ProfileInfoForm';

export default async function ProfilePage() {
  const user = await requireAuth();

  const metadata = user.user_metadata as { full_name?: string; avatar_url?: string } | undefined;
  const fullName = metadata?.full_name ?? '';
  const avatarUrl = metadata?.avatar_url;

  return (
    <div className="mx-auto max-w-2xl">
      <ProfileInfoForm initialName={fullName} email={user.email ?? ''} avatarUrl={avatarUrl} />
    </div>
  );
}
