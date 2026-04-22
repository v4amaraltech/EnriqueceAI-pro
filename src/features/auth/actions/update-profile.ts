'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

interface UpdateProfileInput {
  fullName: string;
}

export async function updateProfile(
  input: UpdateProfileInput,
): Promise<ActionResult<null>> {
  try {
    const user = await requireAuth();
    const supabase = await createServerSupabaseClient();

    const name = input.fullName.trim();
    if (!name || name.length < 2) {
      return { success: false, error: 'Nome deve ter pelo menos 2 caracteres' };
    }

    const { error } = await supabase.auth.updateUser({
      data: { full_name: name },
    });

    if (error) {
      return { success: false, error: error.message };
    }

    // Also update any display in org members if needed (future)
    void user;

    return { success: true, data: null };
  } catch (error) {
    console.error('[updateProfile] Unhandled error:', error);
    return { success: false, error: 'Erro ao atualizar perfil.' };
  }
}

interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export async function changePassword(
  input: ChangePasswordInput,
): Promise<ActionResult<null>> {
  try {
    await requireAuth();
    const supabase = await createServerSupabaseClient();

    if (!input.newPassword || input.newPassword.length < 8) {
      return { success: false, error: 'Nova senha deve ter pelo menos 8 caracteres' };
    }

    if (input.currentPassword === input.newPassword) {
      return { success: false, error: 'A nova senha deve ser diferente da atual' };
    }

    // Supabase doesn't have a "verify current password" API in the client SDK.
    // We re-authenticate by signing in with the current password first.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) {
      return { success: false, error: 'Sessão inválida' };
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: input.currentPassword,
    });

    if (signInError) {
      return { success: false, error: 'Senha atual incorreta' };
    }

    const { error } = await supabase.auth.updateUser({
      password: input.newPassword,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: null };
  } catch (error) {
    console.error('[changePassword] Unhandled error:', error);
    return { success: false, error: 'Erro ao atualizar perfil.' };
  }
}
