'use client';

import { Crown, Headset } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import type { OrganizationMemberRow } from '../types';

interface TeamRosterViewProps {
  members: OrganizationMemberRow[];
  nameMap: Record<string, string>;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function MemberCard({
  member,
  name,
}: {
  member: OrganizationMemberRow;
  name: string;
}) {
  const isActive = member.status === 'active';

  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-sm font-medium text-[var(--primary-foreground)]">
        {getInitials(name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
      </div>
      <Badge variant={isActive ? 'default' : 'secondary'} className="shrink-0">
        {isActive ? 'Ativo' : member.status === 'invited' ? 'Convidado' : 'Desativado'}
      </Badge>
    </div>
  );
}

export function TeamRosterView({ members, nameMap }: TeamRosterViewProps) {
  const managers = members.filter((m) => m.role === 'manager');
  const sdrs = members.filter((m) => m.role === 'sdr');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Times</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Membros da sua organização agrupados por cargo.
        </p>
      </div>

      {managers.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Crown className="h-4 w-4 text-[var(--muted-foreground)]" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Gerentes ({managers.length})
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {managers.map((m) => (
              <MemberCard
                key={m.id}
                member={m}
                name={nameMap[m.user_id] ?? m.user_id}
              />
            ))}
          </div>
        </section>
      )}

      {sdrs.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Headset className="h-4 w-4 text-[var(--muted-foreground)]" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              SDRs ({sdrs.length})
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sdrs.map((m) => (
              <MemberCard
                key={m.id}
                member={m}
                name={nameMap[m.user_id] ?? m.user_id}
              />
            ))}
          </div>
        </section>
      )}

      {managers.length === 0 && sdrs.length === 0 && (
        <p className="text-sm text-[var(--muted-foreground)]">
          Nenhum membro encontrado.
        </p>
      )}
    </div>
  );
}
