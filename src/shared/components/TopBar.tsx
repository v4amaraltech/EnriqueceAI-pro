'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { UserMenu } from '@/features/auth/components/UserMenu';
import { NotificationBell } from '@/features/notifications/components/NotificationBell';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import { HelpCenter } from './HelpCenter/HelpCenter';
import { MobileNav } from './MobileNav';
import { ThemeToggle } from './ThemeToggle';

export interface NavDropdownItem {
  label: string;
  href?: string;
  placeholder?: string;
}

export interface NavSection {
  label: string;
  href?: string;
  items?: NavDropdownItem[];
  placeholder?: string;
}

export const navSections: NavSection[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
  },
  {
    label: 'Prospecção',
    items: [
      { label: 'Execução', href: '/atividades' },
      { label: 'Atividades', href: '/activities' },
      { label: 'Cadências', href: '/cadences' },
      { label: 'Templates', href: '/templates' },
      { label: 'Leads', href: '/leads' },
      { label: 'Ajustes', href: '/settings/prospecting' },
    ],
  },
  {
    label: 'Ligações',
    items: [
      { label: 'Painel de Ligações', href: '/calls/dashboard' },
      { label: 'Lista de Ligações', href: '/calls' },
      { label: 'Extrato', href: '/calls/extrato' },
      { label: 'Ajustes', href: '/calls/ajustes' },
    ],
  },
  {
    label: 'Estatísticas',
    items: [
      { label: 'Ligação', href: '/statistics/calls' },
      { label: 'Prospecção', href: '/statistics/prospecting' },
      { label: 'Feedback de Oportunidade', href: '/statistics/conversion' },
      { label: 'Equipe', href: '/statistics/team' },
    ],
  },
];

function NavDropdownMenu({ section }: { section: NavSection }) {
  const pathname = usePathname();
  const isActive = section.items?.some(
    (item) => item.href && (pathname === item.href || pathname.startsWith(item.href + '/')),
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          suppressHydrationWarning
          className={cn(
            'flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            isActive
              ? 'text-primary'
              : 'text-muted-foreground dark:text-[var(--foreground)] hover:text-foreground',
          )}
        >
          {section.label}
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {section.items?.map((item) =>
          item.placeholder ? (
            <DropdownMenuItem key={item.label} disabled>
              <span className="text-muted-foreground">
                {item.label} — {item.placeholder}
              </span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={item.label} asChild>
              <Link
                href={item.href!}
                className={cn(
                  pathname === item.href && 'font-medium text-primary',
                )}
              >
                {item.label}
              </Link>
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar() {
  const pathname = usePathname();

  return (
    <div className="border-b bg-background">
      {/* Main bar */}
      <div className="flex h-14 items-center gap-4 px-4">
        {/* Mobile hamburger */}
        <MobileNav />

        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-2" data-tour="logo">
          <Image src="/logos/logo-ea-red.png" alt="Enriquece AI" width={32} height={32} className="rounded-full" unoptimized />
          <span className="text-xl font-bold text-primary">Enriquece AI</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="ml-6 hidden items-center gap-1 md:flex" data-tour="nav">
          {navSections.map((section) =>
            section.href ? (
              <Link
                key={section.label}
                href={section.href}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  pathname === section.href ||
                    pathname.startsWith(section.href + '/')
                    ? 'text-primary'
                    : 'text-muted-foreground dark:text-[var(--foreground)] hover:text-foreground',
                )}
              >
                {section.label}
              </Link>
            ) : (
              <NavDropdownMenu key={section.label} section={section} />
            ),
          )}
        </nav>

        {/* Right area */}
        <div className="ml-auto flex items-center gap-1" data-tour="toolbar">
          <ThemeToggle />
          <HelpCenter />
          <NotificationBell />
          <UserMenu />
        </div>
      </div>

    </div>
  );
}
