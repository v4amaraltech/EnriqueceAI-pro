'use client';

import { ArrowUp } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { CadencePriority } from '../types';

const priorityConfig: Record<CadencePriority, { className: string; label: string }> = {
  high: { className: 'text-green-600', label: 'Alta' },
  medium: { className: 'text-yellow-500', label: 'Média' },
  low: { className: 'text-gray-400 dark:text-gray-300', label: 'Baixa' },
};

interface PriorityIconProps {
  priority: CadencePriority;
  className?: string;
}

export function PriorityIcon({ priority, className }: PriorityIconProps) {
  const config = priorityConfig[priority];
  return (
    <ArrowUp
      className={cn('h-4 w-4', config.className, className)}
      aria-label={`Prioridade ${config.label}`}
    />
  );
}
