'use client';

import { useActionState, useState, useTransition } from 'react';

import { RotateCw, Search, UserX } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

import { resendInvite } from '../actions/resend-invite';
import { revokeInvite } from '../actions/revoke-invite';
import { updateMemberRole } from '../actions/update-member-role';
import { updateMemberStatus } from '../actions/update-member-status';
import type { OrganizationMemberRow } from '../types';
import { InviteMemberDialog } from './InviteMemberDialog';

type FormState = { error?: string; success?: boolean };

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  active: { label: 'Ativo', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  invited: { label: 'Pendente', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  suspended: { label: 'Desativado', className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
  removed: { label: 'Removido', className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300' },
};

const ROLE_LABELS: Record<string, string> = {
  manager: 'Gerente',
  sdr: 'SDR',
};

function formatDaysRemaining(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expirado';
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return days === 1 ? 'Expira em 1 dia' : `Expira em ${days} dias`;
}

export function UserManagement({
  members,
  ownerId,
  currentUserId,
  memberCount,
  memberMax,
  nameMap = {},
}: {
  members: OrganizationMemberRow[];
  ownerId: string;
  currentUserId: string;
  memberCount: number;
  memberMax: number;
  nameMap?: Record<string, string>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState('');

  const [statusState, statusAction, statusPending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      const result = await updateMemberStatus(formData);
      if (result.success) return { success: true };
      return { error: result.error };
    },
    {} as FormState,
  );

  const [roleState, roleAction, rolePending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      const result = await updateMemberRole(formData);
      if (result.success) return { success: true };
      return { error: result.error };
    },
    {} as FormState,
  );

  const allActive = members.filter((m) => m.status !== 'invited' && m.status !== 'removed');
  const pendingInvites = members.filter((m) => m.status === 'invited');

  const searchLower = search.toLowerCase();
  const activeMembers = searchLower
    ? allActive.filter((m) => {
        const name = (nameMap[m.user_id] ?? m.user_id).toLowerCase();
        return name.includes(searchLower);
      })
    : allActive;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Membros da equipe</h2>
          <p className="text-sm text-muted-foreground">
            {memberCount}/{memberMax} membros
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>Convidar membro</Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input
          placeholder="Buscar por nome ou email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {(statusState.error || roleState.error) && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {statusState.error || roleState.error}
        </div>
      )}

      {(statusState.success || roleState.success) && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
          Membro atualizado com sucesso.
        </div>
      )}

      {/* Active members table */}
      <div className="rounded-md border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-3 text-left text-sm font-medium">Membro</th>
              <th className="p-3 text-left text-sm font-medium">Cargo</th>
              <th className="p-3 text-left text-sm font-medium">Status</th>
              <th className="p-3 text-right text-sm font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {activeMembers.map((member) => {
              const isOwner = member.user_id === ownerId;
              const isSelf = member.user_id === currentUserId;
              const canEdit = !isOwner && !isSelf;
              const statusInfo = STATUS_LABELS[member.status] ?? STATUS_LABELS.active!;

              return (
                <tr key={member.id} className="border-b last:border-0">
                  <td className="p-3">
                    <span className="text-sm">{nameMap[member.user_id] ?? member.user_id}</span>
                    {isOwner && (
                      <span className="ml-2 text-xs text-muted-foreground">(Proprietário)</span>
                    )}
                    {isSelf && (
                      <span className="ml-2 text-xs text-muted-foreground">(Você)</span>
                    )}
                  </td>
                  <td className="p-3">
                    {canEdit ? (
                      <form action={roleAction} className="inline">
                        <input type="hidden" name="memberId" value={member.id} />
                        <input
                          type="hidden"
                          name="role"
                          value={member.role === 'manager' ? 'sdr' : 'manager'}
                        />
                        <button
                          type="submit"
                          disabled={rolePending}
                          className="text-sm text-primary hover:underline"
                        >
                          {ROLE_LABELS[member.role] ?? member.role}
                        </button>
                      </form>
                    ) : (
                      <span className="text-sm">
                        {ROLE_LABELS[member.role] ?? member.role}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.className}`}
                    >
                      {statusInfo.label}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    {canEdit && member.status !== 'removed' && (
                      <form action={statusAction} className="inline">
                        <input type="hidden" name="memberId" value={member.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={member.status === 'suspended' ? 'active' : 'suspended'}
                        />
                        <button
                          type="submit"
                          disabled={statusPending}
                          className="text-sm text-primary hover:underline"
                        >
                          {member.status === 'suspended' ? 'Reativar' : 'Desativar'}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pending invites section */}
      {pendingInvites.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Convites Pendentes</h3>
          <div className="rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left text-sm font-medium">Email</th>
                  <th className="p-3 text-left text-sm font-medium">Cargo</th>
                  <th className="p-3 text-left text-sm font-medium">Expira</th>
                  <th className="p-3 text-right text-sm font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {pendingInvites.map((member) => (
                  <PendingInviteRow
                    key={member.id}
                    member={member}
                    name={nameMap[member.user_id] ?? member.user_id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <InviteMemberDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

function PendingInviteRow({
  member,
  name,
}: {
  member: OrganizationMemberRow;
  name: string;
}) {
  const [isPending, startTransition] = useTransition();
  const expiryText = formatDaysRemaining(member.invited_expires_at);

  function handleResend() {
    startTransition(async () => {
      const result = await resendInvite(member.id);
      if (result.success) {
        toast.success(`Convite reenviado para ${result.data.email}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleRevoke() {
    startTransition(async () => {
      const result = await revokeInvite(member.id);
      if (result.success) {
        toast.success('Convite revogado');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <tr className="border-b last:border-0">
      <td className="p-3 text-sm">{name}</td>
      <td className="p-3 text-sm">{ROLE_LABELS[member.role] ?? member.role}</td>
      <td className="p-3">
        {expiryText && (
          <span className={`text-xs ${expiryText === 'Expirado' ? 'text-red-600' : 'text-muted-foreground'}`}>
            {expiryText}
          </span>
        )}
      </td>
      <td className="p-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResend}
            disabled={isPending}
            title="Reenviar convite"
          >
            <RotateCw className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRevoke}
            disabled={isPending}
            title="Revogar convite"
          >
            <UserX className="size-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
