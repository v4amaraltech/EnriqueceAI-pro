'use client';

import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { ChevronDown, ChevronRight, Linkedin, Mail, MessageSquare, Phone, Plus, Search } from 'lucide-react';

import type { ChannelType } from '../types';

export interface ActivityTypeItem {
  id: string;
  channel: ChannelType;
  label: string;
}

interface ActivityCategory {
  label: string;
  icon: typeof Mail;
  color: string;
  items: ActivityTypeItem[];
}

const categories: ActivityCategory[] = [
  {
    label: 'E-mail',
    icon: Mail,
    color: 'text-blue-500',
    items: [
      { id: 'new-email', channel: 'email', label: 'E-mail' },
    ],
  },
  {
    label: 'Ligação',
    icon: Phone,
    color: 'text-green-500',
    items: [
      { id: 'new-phone', channel: 'phone', label: 'Ligação' },
    ],
  },
  {
    label: 'Social Point',
    icon: Linkedin,
    color: 'text-purple-500',
    items: [
      { id: 'new-linkedin', channel: 'linkedin', label: 'LinkedIn' },
      { id: 'new-whatsapp', channel: 'whatsapp', label: 'WhatsApp' },
    ],
  },
  {
    label: 'Pesquisa',
    icon: Search,
    color: 'text-orange-500',
    items: [
      { id: 'new-research', channel: 'research', label: 'Pesquisa' },
    ],
  },
];

function DraggableItem({ item, onAddStep }: { item: ActivityTypeItem; onAddStep?: (channel: ChannelType, label: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    data: { type: 'activity-type', channel: item.channel, label: item.label },
  });

  const config = channelConfig[item.channel];

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex cursor-grab items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-[var(--accent)] ${isDragging ? 'opacity-50' : ''}`}
    >
      <config.icon className={`h-4 w-4 ${config.color}`} />
      <span className="flex-1">{item.label}</span>
      {onAddStep && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onAddStep(item.channel, item.label);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          title={`Adicionar ${item.label}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export const channelConfig: Record<ChannelType, { icon: typeof Mail; color: string; bgColor: string; label: string }> = {
  email: { icon: Mail, color: 'text-blue-700 dark:text-blue-400', bgColor: 'bg-blue-100 dark:bg-blue-500/15', label: 'E-mail' },
  whatsapp: { icon: MessageSquare, color: 'text-emerald-700 dark:text-emerald-400', bgColor: 'bg-emerald-100 dark:bg-emerald-500/15', label: 'WhatsApp' },
  phone: { icon: Phone, color: 'text-amber-700 dark:text-amber-400', bgColor: 'bg-amber-100 dark:bg-amber-500/15', label: 'Ligação' },
  linkedin: { icon: Linkedin, color: 'text-violet-700 dark:text-violet-400', bgColor: 'bg-violet-100 dark:bg-violet-500/15', label: 'LinkedIn' },
  research: { icon: Search, color: 'text-orange-700 dark:text-orange-400', bgColor: 'bg-orange-100 dark:bg-orange-500/15', label: 'Pesquisa' },
};

interface ActivityTypeSidebarProps {
  onAddStep?: (channel: ChannelType, label: string) => void;
}

export function ActivityTypeSidebar({ onAddStep }: ActivityTypeSidebarProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    'E-mail': true,
    'Ligação': true,
    'Social Point': true,
    'Pesquisa': true,
  });

  function toggleCategory(label: string) {
    setExpanded((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  function handleCategoryAdd(e: React.MouseEvent, category: ActivityCategory) {
    e.stopPropagation();
    if (category.items.length === 1) {
      const item = category.items[0]!;
      onAddStep?.(item.channel, item.label);
    } else {
      // Multi-item category: expand to show options
      setExpanded((prev) => ({ ...prev, [category.label]: true }));
    }
  }

  return (
    <div className="w-64 shrink-0 rounded-lg border bg-[var(--card)] p-4" data-testid="activity-sidebar">
      <h3 className="mb-3 text-sm font-semibold text-[var(--foreground)]">Atividades</h3>
      <div className="space-y-2">
        {categories.map((category) => {
          const Icon = category.icon;
          const isExpanded = expanded[category.label] ?? false;
          return (
            <div key={category.label}>
              <button
                type="button"
                onClick={() => toggleCategory(category.label)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-[var(--accent)]"
              >
                {onAddStep && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleCategoryAdd(e, category)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCategoryAdd(e as unknown as React.MouseEvent, category); }}
                    className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                    title={`Adicionar ${category.label}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </span>
                )}
                <Icon className={`h-4 w-4 ${category.color}`} />
                <span className="flex-1 text-left">{category.label}</span>
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                )}
              </button>
              {isExpanded && (
                <div className="ml-6 mt-1 space-y-1">
                  {category.items.map((item) => (
                    <DraggableItem
                      key={item.id}
                      item={item}
                      onAddStep={category.items.length > 1 ? onAddStep : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
