'use client';

import {
  ArrowDown,
  ArrowUp,
  CircleOff,
  Phone,
  PhoneOff,
} from 'lucide-react';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';

import type { CallStatus } from '../types';

interface StatusConfig {
  label: string;
  icon: typeof ArrowUp;
  className: string;
}

const statusConfig: Record<CallStatus, StatusConfig> = {
  significant: {
    label: 'Significativa',
    icon: ArrowUp,
    className: 'text-green-600 dark:text-green-400',
  },
  not_significant: {
    label: 'Não Significativa',
    icon: ArrowDown,
    className: 'text-gray-500 dark:text-gray-300',
  },
  no_contact: {
    label: 'Sem Contato',
    icon: PhoneOff,
    className: 'text-yellow-600 dark:text-yellow-400',
  },
  busy: {
    label: 'Ocupado',
    icon: Phone,
    className: 'text-orange-500 dark:text-orange-400',
  },
  not_connected: {
    label: 'Não Conectada',
    icon: CircleOff,
    className: 'text-red-500 dark:text-red-400',
  },
};

interface CallStatusIconProps {
  status: CallStatus;
  showLabel?: boolean;
}

export function CallStatusIcon({ status, showLabel = false }: CallStatusIconProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center gap-1.5 ${config.className}`}>
          <Icon className="h-4 w-4" />
          {showLabel && <span className="text-xs font-medium">{config.label}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent>{config.label}</TooltipContent>
    </Tooltip>
  );
}

export { statusConfig };
