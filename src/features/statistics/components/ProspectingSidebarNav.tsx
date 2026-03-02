'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Activity,
  BarChart3,
  GitBranch,
  Mail,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { label: 'Atividades', href: '/statistics/prospecting/activities', icon: Activity },
  { label: 'Cadências', href: '/statistics/prospecting/cadences', icon: GitBranch },
  { label: 'Conversão', href: '/statistics/prospecting/conversion', icon: BarChart3 },
  { label: 'Desempenho', href: '/statistics/prospecting/performance', icon: TrendingUp },
  { label: 'E-mails', href: '/statistics/prospecting/emails', icon: Mail },
  { label: 'Motivos de Perda', href: '/statistics/prospecting/loss-reasons', icon: XCircle },
];

export function ProspectingSidebarNav() {
  const pathname = usePathname();

  return (
    <div className="space-y-1">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        Prospecção
      </h3>
      <nav className="flex flex-col gap-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-[var(--accent)] font-medium text-[var(--accent-foreground)]'
                  : 'text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]',
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
