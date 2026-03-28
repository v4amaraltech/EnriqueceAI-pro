import { redirect } from 'next/navigation';

import { requireAuth } from './require-auth';

const ADMIN_USER_IDS = [
  '593deb63-cb7f-46ff-bb50-d61c449ac762', // mercantevinicius@gmail.com
  'c6213fe4-b7c3-4da4-a563-a9fcb85456d9', // vinicius.mercante@v4company.com
];

export async function requireAdmin() {
  const user = await requireAuth();

  if (!ADMIN_USER_IDS.includes(user.id)) {
    console.warn('[admin] Access denied for user', user.id);
    redirect('/dashboard');
  }

  return user;
}
