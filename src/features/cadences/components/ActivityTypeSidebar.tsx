'use client';

import { useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { ChevronDown, ChevronRight, Linkedin, Mail, MessageSquare, Phone, Plus, Search, Trash2 } from 'lucide-react';

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
  channel: ChannelType;
  defaultItems: ActivityTypeItem[];
}

const DEFAULT_IDS = new Set(['new-email', 'new-phone', 'new-linkedin', 'new-whatsapp', 'new-research']);

const categories: ActivityCategory[] = [
  {
    label: 'E-mail',
    icon: Mail,
    color: 'text-blue-500',
    channel: 'email',
    defaultItems: [
      { id: 'new-email', channel: 'email', label: 'E-mail' },
    ],
  },
  {
    label: 'Ligação',
    icon: Phone,
    color: 'text-green-500',
    channel: 'phone',
    defaultItems: [
      { id: 'new-phone', channel: 'phone', label: 'Ligação' },
    ],
  },
  {
    label: 'Social Point',
    icon: Linkedin,
    color: 'text-purple-500',
    channel: 'linkedin',
    defaultItems: [
      { id: 'new-linkedin', channel: 'linkedin', label: 'LinkedIn' },
      { id: 'new-whatsapp', channel: 'whatsapp', label: 'WhatsApp' },
    ],
  },
  {
    label: 'Pesquisa',
    icon: Search,
    color: 'text-orange-500',
    channel: 'research',
    defaultItems: [
      { id: 'new-research', channel: 'research', label: 'Pesquisa' },
    ],
  },
];

function DraggableItem({
  item,
  isCustom,
  onRename,
  onRemove,
}: {
  item: ActivityTypeItem;
  isCustom: boolean;
  onRename?: (id: string, newLabel: string) => void;
  onRemove?: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    data: { type: 'activity-type', channel: item.channel, label: item.label },
  });

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(item.label);
  const inputRef = useRef<HTMLInputElement>(null);

  const config = channelConfig[item.channel];

  function startEditing() {
    if (!isCustom) return;
    setEditValue(item.label);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitEdit() {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== item.label) {
      onRename?.(item.id, trimmed);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-[var(--ring)] px-3 py-1.5 text-sm">
        <config.icon className={`h-4 w-4 shrink-0 ${config.color}`} />
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="min-w-0 flex-1 bg-transparent outline-none"
          autoFocus
        />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`group flex cursor-grab items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-[var(--accent)] ${isDragging ? 'opacity-50' : ''}`}
    >
      <config.icon className={`h-4 w-4 shrink-0 ${config.color}`} />
      <span
        className={`flex-1 truncate ${isCustom ? 'cursor-text' : ''}`}
        onDoubleClick={startEditing}
      >
        {item.label}
      </span>
      {isCustom && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onRemove?.(item.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="hidden rounded p-0.5 text-[var(--muted-foreground)] hover:text-red-500 group-hover:block"
          title="Remover"
        >
          <Trash2 className="h-3.5 w-3.5" />
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

let nextItemId = 1;

export function ActivityTypeSidebar() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    'E-mail': true,
    'Ligação': true,
    'Social Point': true,
    'Pesquisa': true,
  });

  const [categoryItems, setCategoryItems] = useState<Record<string, ActivityTypeItem[]>>(() => {
    const initial: Record<string, ActivityTypeItem[]> = {};
    for (const cat of categories) {
      initial[cat.label] = [...cat.defaultItems];
    }
    return initial;
  });

  function toggleCategory(label: string) {
    setExpanded((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  function addItemToCategory(category: ActivityCategory) {
    setCategoryItems((prev) => {
      const current = prev[category.label] ?? [];
      const baseLabel = channelConfig[category.channel].label;
      const count = current.filter((i) => i.channel === category.channel).length;
      const newLabel = `${baseLabel} ${count + 1}`;
      const newItem: ActivityTypeItem = {
        id: `new-${category.channel}-${Date.now()}-${nextItemId++}`,
        channel: category.channel,
        label: newLabel,
      };
      return { ...prev, [category.label]: [...current, newItem] };
    });
    setExpanded((prev) => ({ ...prev, [category.label]: true }));
  }

  function renameItem(categoryLabel: string, itemId: string, newLabel: string) {
    setCategoryItems((prev) => ({
      ...prev,
      [categoryLabel]: (prev[categoryLabel] ?? []).map((i) =>
        i.id === itemId ? { ...i, label: newLabel } : i,
      ),
    }));
  }

  function removeItem(categoryLabel: string, itemId: string) {
    setCategoryItems((prev) => ({
      ...prev,
      [categoryLabel]: (prev[categoryLabel] ?? []).filter((i) => i.id !== itemId),
    }));
  }

  return (
    <div className="w-64 shrink-0 rounded-lg border bg-[var(--card)] p-4" data-testid="activity-sidebar">
      <h3 className="mb-3 text-sm font-semibold text-[var(--foreground)]">Atividades</h3>
      <div className="space-y-2">
        {categories.map((category) => {
          const Icon = category.icon;
          const isExpanded = expanded[category.label] ?? false;
          const items = categoryItems[category.label] ?? category.defaultItems;
          return (
            <div key={category.label}>
              <button
                type="button"
                onClick={() => toggleCategory(category.label)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-[var(--accent)]"
              >
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    addItemToCategory(category);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      addItemToCategory(category);
                    }
                  }}
                  className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  title={`Adicionar ${category.label}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </span>
                <Icon className={`h-4 w-4 ${category.color}`} />
                <span>{category.label}</span>
                <span className="ml-auto">
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                  )}
                </span>
              </button>
              {isExpanded && (
                <div className="ml-6 mt-1 space-y-1">
                  {items.map((item) => (
                    <DraggableItem
                      key={item.id}
                      item={item}
                      isCustom={!DEFAULT_IDS.has(item.id)}
                      onRename={(id, newLabel) => renameItem(category.label, id, newLabel)}
                      onRemove={(id) => removeItem(category.label, id)}
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
