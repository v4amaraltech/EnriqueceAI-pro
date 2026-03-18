'use client';

import { createContext, useCallback, useContext, useState } from 'react';

import { useRouter, usePathname } from 'next/navigation';

import {
  Building2,
  Clock,
  CreditCard,
  Plug,
  Settings,
  User,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/shared/components/ui/dialog';

interface SettingsMenuItem {
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
}

const settingsMenuItems: SettingsMenuItem[] = [
  { label: 'Meu Perfil', href: '/settings/profile', icon: User, description: 'Nome, email e foto' },
  { label: 'Organização', href: '/settings', icon: Building2, description: 'Dados da empresa' },
  { label: 'Usuários', href: '/settings/users', icon: Users, description: 'Gerenciar membros da equipe' },
  { label: 'Integrações', href: '/settings/integrations', icon: Plug, description: 'CRM, Gmail, WhatsApp' },
  { label: 'Faturamento', href: '/settings/billing', icon: CreditCard, description: 'Plano e pagamento' },
  { label: 'Ajustes de Prospecção', href: '/settings/prospecting', icon: Clock, description: 'Atividades, motivos de perda, fit score' },
];

// Context
const SettingsModalContext = createContext<{
  openSettingsModal: () => void;
}>({ openSettingsModal: () => {} });

export function useSettingsModal() {
  return useContext(SettingsModalContext);
}

// Provider + Modal
export function SettingsModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openSettingsModal = useCallback(() => setOpen(true), []);

  return (
    <SettingsModalContext.Provider value={{ openSettingsModal }}>
      {children}
      <SettingsModalDialog open={open} onOpenChange={setOpen} />
    </SettingsModalContext.Provider>
  );
}

function SettingsModalDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const pathname = usePathname();

  const handleNavigate = (href: string) => {
    router.push(href);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] p-0 gap-0 overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-[var(--border)]">
          <Settings className="h-5 w-5 text-[var(--muted-foreground)]" />
          <DialogTitle>Configurações</DialogTitle>
        </div>

        <nav className="py-2">
          {settingsMenuItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === '/settings'
                ? pathname === '/settings'
                : pathname === item.href || pathname.startsWith(item.href + '/');

            return (
              <button
                key={item.href}
                onClick={() => handleNavigate(item.href)}
                className={cn(
                  'flex w-full items-center gap-3 px-6 py-3 text-left transition-colors',
                  isActive
                    ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                    : 'text-[var(--foreground)] hover:bg-[var(--accent)]',
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--muted)]">
                  <Icon className="h-4 w-4 text-[var(--muted-foreground)]" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-[var(--muted-foreground)] truncate">{item.description}</p>
                </div>
              </button>
            );
          })}
        </nav>
      </DialogContent>
    </Dialog>
  );
}
