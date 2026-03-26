import { fetchAdminDashboard } from '@/features/admin/actions/fetch-admin-dashboard';
import { AdminDashboard } from '@/features/admin/components/AdminDashboard';

export default async function AdminPage() {
  const data = await fetchAdminDashboard();

  return <AdminDashboard data={data} />;
}
