'use client';

import { type ReactNode, useState } from 'react';

import { ChevronDown } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

/**
 * Linhas da tela de Integrações: na linha fica só Conectar/Desconectar; as
 * ações extras (Sincronizar, Testar, Campos…) aparecem ao abrir a seta.
 */
export function RowExpandToggle({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  const text = open ? `Ocultar opções de ${label}` : `Mais opções de ${label}`;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 w-8 p-0 text-[var(--muted-foreground)] dark:text-[var(--foreground)]"
      aria-expanded={open}
      aria-label={text}
      title={text}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
    </Button>
  );
}

/** Ações extras da linha, numa faixa logo abaixo dela, alinhada ao nome. */
export function RowExtraActions({ open, children }: { open: boolean; children: ReactNode }) {
  if (!open) return null;
  return <div className="flex flex-wrap items-center gap-2 pb-3 pl-[68px] pr-4">{children}</div>;
}

/** Quais linhas estão abertas (todas começam fechadas). */
export function useExpandedRows() {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  return {
    isOpen: (id: string) => open.has(id),
    toggle: (id: string) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
  };
}
