import { requireAuth } from '@/lib/auth/require-auth';

import { UserProfileSettings } from '@/features/auth/components/UserProfileSettings';

export default async function ProfilePage() {
  const user = await requireAuth();

  const metadata = user.user_metadata as { full_name?: string; avatar_url?: string } | undefined;
  const fullName = metadata?.full_name ?? '';
  const avatarUrl = metadata?.avatar_url;

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-bold">Meu Perfil</h1>
      <UserProfileSettings initialName={fullName} email={user.email ?? ''} avatarUrl={avatarUrl} />
    </div>
  );
}
