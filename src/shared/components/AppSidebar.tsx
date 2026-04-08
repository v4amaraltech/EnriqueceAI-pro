'use client';

import { createContext, useCallback, useContext, useSyncExternalStore, useState } from 'react';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ListChecks,
  Menu,
  Phone,
  PieChart,
  Play,
  Plug,
  Settings,
  Users,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';

import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  managerOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Leads', href: '/leads', icon: Users },
  { label: 'Execução', href: '/atividades', icon: Play },
  { label: 'Templates', href: '/activities', icon: ListChecks },
  { label: 'Ligações', href: '/calls', icon: Phone },
  { label: 'Cadências', href: '/cadences', icon: Zap },
  { label: 'Relatórios', href: '/reports', icon: BarChart3 },
  { label: 'Estatísticas', href: '/statistics', icon: PieChart, managerOnly: true },
  { label: 'Integrações', href: '/settings/integrations', icon: Plug, managerOnly: true },
  { label: 'Configurações', href: '/settings', icon: Settings },
];

const STORAGE_KEY = 'sidebar-collapsed';

// Context for mobile drawer
const MobileDrawerContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>({ open: false, setOpen: () => {} });

export function useMobileDrawer() {
  return useContext(MobileDrawerContext);
}

function NavLink({
  item,
  isActive,
  collapsed,
  onClick,
}: {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon;

  const link = (
    <Link
      href={item.href}
      prefetch
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)]'
          : 'text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)]',
        collapsed && 'justify-center px-2',
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }

  return link;
}

function SidebarContent({
  collapsed,
  onToggle,
  pathname,
  onNavClick,
}: {
  collapsed: boolean;
  onToggle?: () => void;
  pathname: string;
  onNavClick?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={cn('flex h-14 items-center border-b border-[var(--sidebar-border)] px-4', collapsed && 'justify-center px-2')}>
        {collapsed ? (
          <Image src="/logos/logo-ea-red.png" alt="Enriquece AI" width={28} height={28} className="rounded-full" unoptimized />
        ) : (
          <div className="flex items-center gap-2">
            <Image src="/logos/logo-ea-red.png" alt="Enriquece AI" width={32} height={32} className="rounded-full" unoptimized />
            <span className="text-xl font-bold text-[var(--sidebar-primary)]">Enriquece AI</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || (item.href !== '/settings' && pathname.startsWith(item.href + '/'));
          return (
            <NavLink key={item.href} item={item} isActive={isActive} collapsed={collapsed} onClick={onNavClick} />
          );
        })}
      </nav>

      {/* Footer */}
      <div className={cn('border-t border-[var(--sidebar-border)] p-3', collapsed && 'px-2')}>
        {onToggle && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className={cn('w-full text-[var(--sidebar-foreground)]', collapsed && 'px-0')}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!collapsed && <span className="ml-2 text-xs">Recolher</span>}
          </Button>
        )}
        {!collapsed && (
          <p className="mt-2 text-center text-[10px] text-[var(--sidebar-foreground)]/50">Enriquece AI v0.1</p>
        )}
      </div>
    </div>
  );
}

export function MobileMenuTrigger() {
  const { setOpen } = useMobileDrawer();

  return (
    <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="Menu">
      <Menu className="h-5 w-5" />
    </Button>
  );
}

// Read collapsed state from localStorage via useSyncExternalStore
function useCollapsedState() {
  const subscribe = useCallback((callback: () => void) => {
    window.addEventListener('storage', callback);
    return () => window.removeEventListener('storage', callback);
  }, []);
  const getSnapshot = useCallback(() => localStorage.getItem(STORAGE_KEY) === 'true', []);
  const getServerSnapshot = useCallback(() => false, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function AppSidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const collapsed = useCollapsedState();
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggle = () => {
    const next = !collapsed;
    localStorage.setItem(STORAGE_KEY, String(next));
    window.dispatchEvent(new Event('storage'));
  };

  return (
    <MobileDrawerContext.Provider value={{ open: mobileOpen, setOpen: setMobileOpen }}>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden h-screen shrink-0 border-r border-[var(--sidebar-border)] bg-[var(--sidebar-background)] transition-all duration-200 md:block',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <SidebarContent collapsed={collapsed} onToggle={toggle} pathname={pathname} />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-60 p-0 bg-[var(--sidebar-background)]">
          <SheetHeader className="sr-only">
            <SheetTitle>Menu de navegação</SheetTitle>
          </SheetHeader>
          <SidebarContent collapsed={false} pathname={pathname} onNavClick={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Rest of the app */}
      {children}
    </MobileDrawerContext.Provider>
  );
}

export { navItems };
