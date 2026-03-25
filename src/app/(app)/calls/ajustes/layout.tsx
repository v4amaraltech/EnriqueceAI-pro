'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Ban, Phone, Settings, Target } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

interface SidebarItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const sidebarItems: SidebarItem[] = [
  { label: 'Configurações Gerais', href: '/calls/ajustes/general', icon: Settings },
  { label: 'Metas por Vendedor', href: '/calls/ajustes/daily-targets', icon: Target },
  { label: 'Blacklist de Telefones', href: '/calls/ajustes/blacklist', icon: Ban },
];

export default function CallSettingsLayout({
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
          <Phone className="h-5 w-5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          <h2 className="text-sm font-semibold">Ajustes de Ligações</h2>
        </div>
        <nav className="flex flex-col gap-1">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

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
