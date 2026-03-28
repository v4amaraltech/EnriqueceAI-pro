'use client';

import { Building2, LogOut, Puzzle, User } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import { useAuth } from '../hooks/useAuth';
import { useOrganization } from '../hooks/useOrganization';

export function UserMenu() {
  const { user, signOut } = useAuth();
  const { organization } = useOrganization();

  const email = user?.email ?? '';
  const initials = (email.split('@')[0] || 'U')
    .slice(0, 2)
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="flex items-center gap-2">
          {organization?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={organization.logo_url}
              alt={organization.name}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary)] text-xs font-medium text-[var(--primary-foreground)]">
              {initials}
            </div>
          )}
          <span className="hidden text-sm md:inline">{organization?.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="text-sm font-medium">{email}</p>
          <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{organization?.name}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/settings/profile" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Meu Perfil
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/settings/company" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Empresa
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/settings/integrations" className="flex items-center gap-2">
            <Puzzle className="h-4 w-4" />
            Integrações
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()} className="flex items-center gap-2 text-[var(--destructive)]">
          <LogOut className="h-4 w-4" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
