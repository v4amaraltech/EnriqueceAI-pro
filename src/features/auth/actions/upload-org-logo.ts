'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireManager } from '@/lib/auth/require-manager';
import { MAX_AVATAR_SIZE } from '@/lib/constants/limits';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function uploadOrgLogo(
  formData: FormData,
): Promise<ActionResult<{ logoUrl: string }>> {
  await requireManager();
  const supabase = await createServerSupabaseClient();

  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: 'Nenhum arquivo selecionado' };
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return { success: false, error: 'Formato inválido. Use JPEG, PNG ou WebP' };
  }

  if (file.size > MAX_AVATAR_SIZE) {
    return { success: false, error: 'Arquivo muito grande. Máximo 2MB' };
  }

  // Get user's org
  const userId = (await supabase.auth.getUser()).data.user!.id;
  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const ext = EXTENSION_MAP[file.type] ?? 'jpg';
  const filePath = `${member.org_id}/logo.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('org-logos')
    .upload(filePath, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    return { success: false, error: `Erro no upload: ${uploadError.message}` };
  }

  const { data: urlData } = supabase.storage
    .from('org-logos')
    .getPublicUrl(filePath);

  const logoUrl = `${urlData.publicUrl}?t=${Date.now()}`;

  // Update organization logo_url
  const { error: updateError } = await from(supabase, 'organizations')
    .update({ logo_url: logoUrl, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', member.org_id);

  if (updateError) {
    return { success: false, error: `Erro ao atualizar organização: ${updateError.message}` };
  }

  revalidatePath('/settings');
  return { success: true, data: { logoUrl } };
}

export async function removeOrgLogo(): Promise<ActionResult<{ removed: boolean }>> {
  await requireManager();
  const supabase = await createServerSupabaseClient();

  const userId = (await supabase.auth.getUser()).data.user!.id;
  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  // List and remove all files in org folder
  const { data: files } = await supabase.storage
    .from('org-logos')
    .list(member.org_id);

  if (files && files.length > 0) {
    const paths = files.map(f => `${member.org_id}/${f.name}`);
    await supabase.storage.from('org-logos').remove(paths);
  }

  // Clear logo_url
  const { error: updateError } = await from(supabase, 'organizations')
    .update({ logo_url: null, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', member.org_id);

  if (updateError) {
    return { success: false, error: `Erro ao remover logo: ${updateError.message}` };
  }

  revalidatePath('/settings');
  return { success: true, data: { removed: true } };
}
