import Link from 'next/link';

import { Building2, CreditCard, Plug, User, Users } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { OrganizationSettings } from '@/features/auth/components/OrganizationSettings';
import type { MemberWithOrganization } from '@/features/auth/types';

const settingsLinks = [
  { label: 'Meu Perfil', href: '/settings/profile', icon: User, description: 'Nome, email e senha' },
  { label: 'Usuários', href: '/settings/users', icon: Users, description: 'Gerenciar membros da equipe' },
  { label: 'Integrações', href: '/settings/integrations', icon: Plug, description: 'Gmail, WhatsApp, CRM' },
  { label: 'Faturamento', href: '/settings/billing', icon: CreditCard, description: 'Plano e pagamento' },
];

export default async function SettingsPage() {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('*, organization:organizations(*)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: MemberWithOrganization | null };

  if (!member?.organization) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Organização não encontrada.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-bold">Configurações</h1>

      {/* Quick links */}
      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        {settingsLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-4 transition-colors hover:bg-[var(--accent)]"
            >
              <Icon className="h-5 w-5 text-[var(--muted-foreground)]" />
              <div>
                <p className="text-sm font-medium">{link.label}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{link.description}</p>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Organization settings inline */}
      <div className="flex items-center gap-2 mb-4">
        <Building2 className="h-5 w-5 text-[var(--muted-foreground)]" />
        <h2 className="text-lg font-semibold">Organização</h2>
      </div>
      <OrganizationSettings organization={member.organization} />
    </div>
  );
}
