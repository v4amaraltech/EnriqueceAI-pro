import { requireManager } from '@/lib/auth/require-manager';

import { EmailConfigSettings } from '@/features/auth/components/EmailConfigSettings';
import { fetchConnections } from '@/features/integrations/actions/fetch-connections';

export default async function CompanyEmailPage() {
  await requireManager();

  const result = await fetchConnections();
  const gmail = result.success ? result.data.gmail : null;

  return <EmailConfigSettings gmail={gmail} />;
}
