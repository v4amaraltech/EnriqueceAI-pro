import { redirect } from 'next/navigation';

import { requireAuth } from './require-auth';

const ADMIN_USER_IDS = [
  '593deb63-1089-4fc3-ba13-4f2e95913fa0', // mercantevinicius@gmail.com
  'c6213fe4-d470-4572-8f61-1a657d6b978e', // vinicius.mercante@v4company.com
];

export async function requireAdmin() {
  const user = await requireAuth();

  if (!ADMIN_USER_IDS.includes(user.id)) {
    console.warn(`[admin] Access denied for user ${user.id} (${user.email})`);
    redirect('/dashboard');
  }

  return user;
}
