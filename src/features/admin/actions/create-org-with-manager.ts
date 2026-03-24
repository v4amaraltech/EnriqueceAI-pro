'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

const createOrgSchema = z.object({
  orgName: z.string().min(2, 'Nome da organização deve ter pelo menos 2 caracteres'),
  managerName: z.string().min(2, 'Nome do manager deve ter pelo menos 2 caracteres'),
  managerEmail: z.string().email('Email inválido'),
  tempPassword: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
});

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function createOrgWithManager(
  input: Record<string, unknown>,
): Promise<ActionResult<{ orgId: string; userId: string }>> {
  await requireAdmin();

  const parsed = createOrgSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const { orgName, managerName, managerEmail, tempPassword } = parsed.data;
  const admin = createAdminSupabaseClient();

  // Check if email already exists
  const { data: existingUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emailExists = existingUsers?.users?.some(
    (u) => u.email?.toLowerCase() === managerEmail.toLowerCase(),
  );
  if (emailExists) {
    return { success: false, error: 'Esse email já está cadastrado' };
  }

  // Create user — trigger handle_new_user() auto-creates org + member + subscription
  const { data: newUser, error: createError } = await admin.auth.admin.createUser({
    email: managerEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: managerName },
  });

  if (createError || !newUser.user) {
    return { success: false, error: createError?.message ?? 'Erro ao criar usuário' };
  }

  const userId = newUser.user.id;

  // Find the auto-created org via organization_members
  const { data: memberData, error: memberError } = await admin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', userId)
    .single();

  if (memberError || !memberData) {
    return {
      success: false,
      error: 'Usuário criado mas org não encontrada. Verifique o trigger handle_new_user().',
    };
  }

  const orgId = memberData.org_id as string;

  // Update org: proper name, slug, skip onboarding
  const { error: updateError } = await admin
    .from('organizations')
    .update({
      name: orgName,
      slug: slugify(orgName),
      onboarding_step: null,
    })
    .eq('id', orgId);

  if (updateError) {
    return { success: false, error: 'Org criada mas falhou ao atualizar nome: ' + updateError.message };
  }

  return { success: true, data: { orgId, userId } };
}
