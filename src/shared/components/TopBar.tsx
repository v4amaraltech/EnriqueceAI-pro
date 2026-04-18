'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  ChevronDown,
  FileText,
  ListChecks,
  Mail,
  MessageSquare,
  Phone,
  PlayCircle,
  Receipt,
  Settings,
  TrendingUp,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

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
  badge?: number;
  icon?: LucideIcon;
}

export interface NavSection {
  label: string;
  href?: string;
  items?: NavDropdownItem[];
  placeholder?: string;
  icon?: LucideIcon;
}

export const navSections: NavSection[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: TrendingUp,
  },
  {
    label: 'Prospecção',
    icon: Users,
    items: [
      { label: 'Execução', href: '/atividades', icon: PlayCircle },
      { label: 'Atividades', href: '/activities', icon: ListChecks },
      { label: 'Mensagens', href: '/templates', icon: Mail },
      { label: 'Cadências', href: '/cadences', icon: Workflow },
      { label: 'Leads', href: '/leads', icon: Users },
      { label: 'Ajustes', href: '/settings/prospecting', icon: Settings },
    ],
  },
  {
    label: 'Ligações',
    icon: Phone,
    items: [
      { label: 'Painel', href: '/calls/dashboard', icon: TrendingUp },
      { label: 'Ligações', href: '/calls', icon: Phone },
      { label: 'Extrato', href: '/calls/extrato', icon: Receipt },
      { label: 'Ajustes', href: '/calls/ajustes', icon: Settings },
    ],
  },
  {
    label: 'Estatísticas',
    icon: FileText,
    items: [
      { label: 'Ligação', href: '/statistics/calls', icon: Phone },
      { label: 'Prospecção', href: '/statistics/prospecting', icon: TrendingUp },
      { label: 'Feedback de Oportunidade', href: '/statistics/conversion', icon: MessageSquare },
      { label: 'Equipe', href: '/statistics/team', icon: Users },
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
            'flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            isActive
              ? 'text-primary'
              : 'text-muted-foreground dark:text-[var(--foreground)] hover:text-foreground',
          )}
        >
          {section.icon && <section.icon className="h-4 w-4" />}
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
                prefetch
                className={cn(
                  'flex items-center justify-between gap-2',
                  pathname === item.href && 'font-medium text-primary',
                )}
              >
                <span className="flex items-center gap-2">
                  {item.icon && <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  {item.label}
                </span>
                {item.badge != null && item.badge > 0 && (
                  <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </Link>
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface TopBarProps {
  pendingActivitiesCount?: number;
}

export function TopBar({ pendingActivitiesCount }: TopBarProps) {
  const pathname = usePathname();

  // Inject badge into Execução menu item
  const sections = navSections.map((s) => {
    if (s.items) {
      return {
        ...s,
        items: s.items.map((item) =>
          item.href === '/atividades' && pendingActivitiesCount
            ? { ...item, badge: pendingActivitiesCount }
            : item,
        ),
      };
    }
    return s;
  });

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
          {sections.map((section) =>
            section.href ? (
              <Link
                key={section.label}
                href={section.href}
                prefetch
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  pathname === section.href ||
                    pathname.startsWith(section.href + '/')
                    ? 'text-primary'
                    : 'text-muted-foreground dark:text-[var(--foreground)] hover:text-foreground',
                )}
              >
                {section.icon && <section.icon className="h-4 w-4" />}
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
