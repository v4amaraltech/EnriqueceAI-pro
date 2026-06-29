'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { ChevronDown, ChevronRight, Linkedin, Mail, MessageSquare, Phone, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import type { ChannelType } from '../types';
import {
  createActivityVariation,
  deleteActivityVariation,
  fetchActivityVariations,
  renameActivityVariation,
} from '../actions/manage-activity-variations';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isPersistedId = (id: string) => UUID_RE.test(id);

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
  showAdd,
  onAdd,
  onRename,
  onRemove,
}: {
  item: ActivityTypeItem;
  isCustom: boolean;
  showAdd?: boolean;
  onAdd?: (channel: ChannelType, label: string) => void;
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
      {showAdd && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onAdd?.(item.channel, item.label);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="hidden rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] group-hover:block"
          title={`Adicionar ${item.label}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
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

// Channel → sidebar category label (e.g. whatsapp/linkedin → "Social Point").
const channelToCategory: Record<ChannelType, string> = (() => {
  const map = {} as Record<ChannelType, string>;
  for (const cat of categories) {
    for (const it of cat.defaultItems) map[it.channel] = cat.label;
  }
  return map;
})();

// Merge hardcoded default items with persisted variations, grouped by category.
function buildCategoryItems(
  variations: Pick<ActivityTypeItem, 'id' | 'channel' | 'label'>[],
): Record<string, ActivityTypeItem[]> {
  const result: Record<string, ActivityTypeItem[]> = {};
  for (const cat of categories) result[cat.label] = [...cat.defaultItems];
  for (const v of variations) {
    const catLabel = channelToCategory[v.channel];
    const bucket = catLabel ? result[catLabel] : undefined;
    if (bucket) bucket.push({ id: v.id, channel: v.channel, label: v.label });
  }
  return result;
}

export function ActivityTypeSidebar() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    'E-mail': true,
    'Ligação': true,
    'Social Point': true,
    'Pesquisa': true,
  });

  const [categoryItems, setCategoryItems] = useState<Record<string, ActivityTypeItem[]>>(
    () => buildCategoryItems([]),
  );
  const [, startSave] = useTransition();

  // Load persisted variations on mount; defaults render immediately meanwhile.
  useEffect(() => {
    let active = true;
    fetchActivityVariations().then((res) => {
      if (active && res.success) setCategoryItems(buildCategoryItems(res.data));
    });
    return () => {
      active = false;
    };
  }, []);

  function toggleCategory(label: string) {
    setExpanded((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  function addItemByChannel(categoryLabel: string, channel: ChannelType, baseLabel: string) {
    const current = categoryItems[categoryLabel] ?? [];
    const count = current.filter((i) => i.channel === channel).length;
    const newLabel = `${baseLabel} ${count + 1}`;
    const tempId = `temp-${channel}-${Date.now()}-${nextItemId++}`;

    // Optimistic insert; reconcile with the DB row (or roll back) below.
    setCategoryItems((prev) => ({
      ...prev,
      [categoryLabel]: [...(prev[categoryLabel] ?? []), { id: tempId, channel, label: newLabel }],
    }));
    setExpanded((prev) => ({ ...prev, [categoryLabel]: true }));

    startSave(async () => {
      const res = await createActivityVariation({ channel, label: newLabel });
      setCategoryItems((prev) => ({
        ...prev,
        [categoryLabel]: res.success
          ? (prev[categoryLabel] ?? []).map((i) =>
              i.id === tempId ? { id: res.data.id, channel: res.data.channel, label: res.data.label } : i,
            )
          : (prev[categoryLabel] ?? []).filter((i) => i.id !== tempId),
      }));
      if (!res.success) toast.error(res.error);
    });
  }

  function handleCategoryAdd(category: ActivityCategory) {
    // The "+" on a category header must always create a new variation.
    // Previously multi-type categories (e.g. Social Point) only toggled
    // expansion here, so — since categories start expanded — clicking "+"
    // appeared to do nothing. Default to a variation of the category's first
    // channel; users rename it or use the per-item "+" for a specific channel.
    const item = category.defaultItems[0]!;
    addItemByChannel(category.label, item.channel, item.label);
  }

  function renameItem(categoryLabel: string, itemId: string, newLabel: string) {
    const prevLabel = (categoryItems[categoryLabel] ?? []).find((i) => i.id === itemId)?.label;
    setCategoryItems((prev) => ({
      ...prev,
      [categoryLabel]: (prev[categoryLabel] ?? []).map((i) =>
        i.id === itemId ? { ...i, label: newLabel } : i,
      ),
    }));

    // Only persisted (uuid) items can be renamed server-side; temp items are
    // still being created and will save with their current label.
    if (!isPersistedId(itemId)) return;
    startSave(async () => {
      const res = await renameActivityVariation({ id: itemId, label: newLabel });
      if (!res.success) {
        setCategoryItems((prev) => ({
          ...prev,
          [categoryLabel]: (prev[categoryLabel] ?? []).map((i) =>
            i.id === itemId ? { ...i, label: prevLabel ?? i.label } : i,
          ),
        }));
        toast.error(res.error);
      }
    });
  }

  function removeItem(categoryLabel: string, itemId: string) {
    const removed = (categoryItems[categoryLabel] ?? []).find((i) => i.id === itemId);
    setCategoryItems((prev) => ({
      ...prev,
      [categoryLabel]: (prev[categoryLabel] ?? []).filter((i) => i.id !== itemId),
    }));

    if (!isPersistedId(itemId)) return;
    startSave(async () => {
      const res = await deleteActivityVariation(itemId);
      if (!res.success && removed) {
        setCategoryItems((prev) => ({
          ...prev,
          [categoryLabel]: [...(prev[categoryLabel] ?? []), removed],
        }));
        toast.error(res.error);
      }
    });
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
                    handleCategoryAdd(category);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      handleCategoryAdd(category);
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
                  {items.map((item) => {
                    const isDefault = DEFAULT_IDS.has(item.id);
                    const isMultiType = category.defaultItems.length > 1;
                    return (
                      <DraggableItem
                        key={item.id}
                        item={item}
                        isCustom={!isDefault}
                        showAdd={isDefault && isMultiType}
                        onAdd={(channel, label) => addItemByChannel(category.label, channel, label)}
                        onRename={(id, newLabel) => renameItem(category.label, id, newLabel)}
                        onRemove={(id) => removeItem(category.label, id)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
