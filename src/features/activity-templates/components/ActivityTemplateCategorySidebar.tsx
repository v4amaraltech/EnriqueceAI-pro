'use client';

import { Mail, Phone, Share2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActivityTemplateRow } from '../types';

export type CategoryKey = 'email' | 'phone' | 'social' | 'research';

export const categories: { key: CategoryKey; label: string; icon: typeof Mail; channels: string[] }[] = [
  { key: 'email', label: 'E-mail', icon: Mail, channels: ['email'] },
  { key: 'phone', label: 'Ligação', icon: Phone, channels: ['phone'] },
  { key: 'social', label: 'Social Point', icon: Share2, channels: ['linkedin', 'whatsapp'] },
  { key: 'research', label: 'Pesquisa', icon: Search, channels: ['research'] },
];

interface Props {
  active: CategoryKey;
  onSelect: (key: CategoryKey) => void;
  templates: ActivityTemplateRow[];
}

export function ActivityTemplateCategorySidebar({ active, onSelect, templates }: Props) {
  return (
    <nav className="flex w-48 shrink-0 flex-col gap-1">
      {categories.map((cat) => {
        const count = templates.filter((t) => cat.channels.includes(t.channel)).length;
        const isActive = active === cat.key;
        return (
          <button
            key={cat.key}
            onClick={() => onSelect(cat.key)}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-foreground/80 hover:bg-muted hover:text-foreground',
            )}
          >
            <cat.icon className="h-4 w-4" />
            <span className="flex-1 text-left">{cat.label}</span>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-xs',
                isActive ? 'bg-primary/20 text-primary' : 'bg-muted text-foreground/60',
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
