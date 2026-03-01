import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@/lib/supabase/server';

import { SetupPasswordForm } from '@/features/auth/components/SetupPasswordForm';

export default async function SetupPasswordPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not authenticated — back to login
  if (!user) redirect('/login');

  return <SetupPasswordForm />;
}
