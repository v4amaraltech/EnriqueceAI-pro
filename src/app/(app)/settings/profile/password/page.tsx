import { requireAuth } from '@/lib/auth/require-auth';

import { PasswordChangeForm } from '@/features/auth/components/PasswordChangeForm';

export default async function PasswordPage() {
  await requireAuth();

  return (
    <div className="mx-auto max-w-2xl">
      <PasswordChangeForm />
    </div>
  );
}
