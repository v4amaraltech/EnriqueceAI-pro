'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';

import { updateLead } from '../actions/update-lead';

interface InlineEditFieldProps {
  leadId: string;
  fieldKey: string;
  label: string;
  value: string | null;
  onSaved?: (newValue: string) => void;
  mono?: boolean;
  placeholder?: string;
}

export function InlineEditField({
  leadId,
  fieldKey,
  label,
  value,
  onSaved,
  mono,
  placeholder = 'Clique para editar',
}: InlineEditFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value ?? '');
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleSave = useCallback(() => {
    if (editValue === (value ?? '')) {
      setIsEditing(false);
      return;
    }

    startTransition(async () => {
      const result = await updateLead(leadId, { [fieldKey]: editValue || null });
      if (result.success) {
        onSaved?.(editValue);
        setIsEditing(false);
      } else {
        toast.error(result.error);
      }
    });
  }, [editValue, value, leadId, fieldKey, onSaved]);

  const handleCancel = useCallback(() => {
    setEditValue(value ?? '');
    setIsEditing(false);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSave();
      if (e.key === 'Escape') handleCancel();
    },
    [handleSave, handleCancel],
  );

  return (
    <div className="space-y-1">
      <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{label}</p>
      {isEditing ? (
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            disabled={isPending}
            className={`flex-1 rounded-md border border-[var(--ring)] bg-[var(--background)] px-3 py-1.5 text-sm outline-none ${mono ? 'font-mono text-xs' : ''}`}
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleCancel}
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="group flex w-full items-center gap-1.5 min-w-0 overflow-hidden rounded-md bg-[var(--muted)] px-3 py-1.5 text-sm text-left hover:ring-1 hover:ring-[var(--ring)] transition-shadow"
        >
          <span className={`flex-1 truncate ${mono ? 'font-mono text-xs' : ''} ${!value ? 'text-[var(--muted-foreground)] italic' : ''}`}>
            {value || placeholder}
          </span>
          <Pencil className="h-3 w-3 shrink-0 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      )}
    </div>
  );
}
