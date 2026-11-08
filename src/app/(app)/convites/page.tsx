import type { Metadata } from 'next';

import { fetchMyPendingOrgInvites } from '@/features/auth/actions/list-pending-org-invites';
import { PendingInvitesList } from '@/features/auth/components/PendingInvitesList';

export const metadata: Metadata = {
  title: 'Convites | Enriquece AI',
};

export default async function ConvitesPage() {
  const result = await fetchMyPendingOrgInvites();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Convites</h1>
        <p className="text-sm text-muted-foreground">
          Convites para entrar em outras organizações. Aceitar um convite só acontece quando você confirma aqui.
        </p>
      </div>
      {result.success ? (
        <PendingInvitesList invites={result.data} />
      ) : (
        <p className="text-sm text-muted-foreground">{result.error}</p>
      )}
    </div>
  );
}
