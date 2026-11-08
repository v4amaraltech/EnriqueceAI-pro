'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';

import { acceptOrgInvite } from '../actions/accept-org-invite';
import { declineOrgInvite } from '../actions/decline-org-invite';
import type { PendingOrgInvite } from '../services/pending-org-invites';

const ROLE_LABEL: Record<PendingOrgInvite['role'], string> = {
  manager: 'Gestor',
  sdr: 'SDR',
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function PendingInvitesList({ invites }: { invites: PendingOrgInvite[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function handleAccept(invite: PendingOrgInvite) {
    setBusyId(invite.id);
    startTransition(async () => {
      const result = await acceptOrgInvite(invite.id);
      if (result.success) {
        toast.success(`Você entrou em ${invite.orgName}`);
        router.push('/dashboard');
        router.refresh();
      } else {
        toast.error(result.error);
        setBusyId(null);
      }
    });
  }

  function handleDecline(invite: PendingOrgInvite) {
    setBusyId(invite.id);
    startTransition(async () => {
      const result = await declineOrgInvite(invite.id);
      if (result.success) {
        toast.success('Convite recusado');
        router.refresh();
      } else {
        toast.error(result.error);
      }
      setBusyId(null);
    });
  }

  if (invites.length === 0) {
    return <p className="text-sm text-muted-foreground">Você não tem convites pendentes.</p>;
  }

  return (
    <div className="space-y-4">
      {invites.map((invite) => {
        const expires = formatDate(invite.expiresAt);
        const busy = isPending && busyId === invite.id;
        return (
          <Card key={invite.id}>
            <CardHeader>
              <CardTitle>{invite.orgName}</CardTitle>
              <CardDescription>
                Papel: {ROLE_LABEL[invite.role]}
                {expires ? `. Válido até ${expires}.` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button onClick={() => handleAccept(invite)} disabled={isPending}>
                {busy ? 'Processando...' : 'Aceitar'}
              </Button>
              <Button variant="outline" onClick={() => handleDecline(invite)} disabled={isPending}>
                Recusar
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
