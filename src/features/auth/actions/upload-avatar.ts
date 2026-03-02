'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function uploadAvatar(
  formData: FormData,
): Promise<ActionResult<{ avatarUrl: string }>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const file = formData.get('avatar');
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: 'Nenhum arquivo selecionado' };
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return { success: false, error: 'Formato inválido. Use JPEG, PNG ou WebP' };
  }

  if (file.size > MAX_SIZE) {
    return { success: false, error: 'Arquivo muito grande. Máximo 2MB' };
  }

  const ext = EXTENSION_MAP[file.type] ?? 'jpg';
  const filePath = `${user.id}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(filePath, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    return { success: false, error: `Erro no upload: ${uploadError.message}` };
  }

  const { data: urlData } = supabase.storage
    .from('avatars')
    .getPublicUrl(filePath);

  // Append timestamp to bust cache
  const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

  const { error: updateError } = await supabase.auth.updateUser({
    data: { avatar_url: avatarUrl },
  });

  if (updateError) {
    return { success: false, error: `Erro ao atualizar perfil: ${updateError.message}` };
  }

  return { success: true, data: { avatarUrl } };
}
