'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Building2,
  Mail,
  Users,
  UsersRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/shared/components/ui/badge';

interface SidebarItem {
  label: string;
  href: string;
  icon: LucideIcon;
  comingSoon?: boolean;
}

const sidebarItems: SidebarItem[] = [
  { label: 'Dados Gerais', href: '/settings/company', icon: Building2 },
  { label: 'Usuários', href: '/settings/company/users', icon: Users },
  { label: 'Times', href: '/settings/company/teams', icon: UsersRound, comingSoon: true },
  { label: 'Config. de E-mail', href: '/settings/company/email', icon: Mail, comingSoon: true },
];

export default function CompanySettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-[var(--border)] bg-[var(--card)] p-4">
        <div className="mb-4 flex items-center gap-2">
          <Building2 className="h-5 w-5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          <h2 className="text-sm font-semibold">Empresa</h2>
        </div>
        <nav className="flex flex-col gap-1">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            if (item.comingSoon) {
              return (
                <span
                  key={item.href}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]/50 cursor-not-allowed"
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1">{item.label}</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    EM BREVE
                  </Badge>
                </span>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-[var(--accent)] font-medium text-[var(--accent-foreground)]'
                    : 'text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]',
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
  );
}
