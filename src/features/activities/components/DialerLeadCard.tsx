'use client';

import { MoreHorizontal, Phone, ExternalLink, SkipForward } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';

interface DialerLeadCardProps {
  item: DialerQueueItem;
  onViewLead?: (leadId: string) => void;
  onSkip?: (enrollmentId: string) => void;
}

function getInitials(firstName: string | null, lastName: string | null, fallback: string): string {
  if (firstName) {
    const first = firstName.charAt(0).toUpperCase();
    const last = lastName ? lastName.charAt(0).toUpperCase() : '';
    return `${first}${last}`;
  }
  // Fallback: first 2 chars of company/lead name
  return fallback.substring(0, 2).toUpperCase();
}

function formatPhone(phone: string | null): string {
  if (!phone) return 'Sem telefone';
  // Simple Brazilian phone formatting
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

export function DialerLeadCard({ item, onViewLead, onSkip }: DialerLeadCardProps) {
  const initials = getInitials(item.firstName, item.lastName, item.leadName);
  const displayName = item.firstName
    ? `${item.firstName} ${item.lastName ?? ''}`.trim()
    : item.leadName;

  return (
    <div className="group relative rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        {/* Avatar with step badge */}
        <div className="relative shrink-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary)]/10 text-sm font-semibold text-[var(--primary)]">
            {initials}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary)] text-[10px] font-bold text-[var(--primary-foreground)]">
                {item.stepOrder}
              </span>
            </TooltipTrigger>
            <TooltipContent>Passo {item.stepOrder} de {item.totalSteps}</TooltipContent>
          </Tooltip>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{displayName}</p>
          <p className="truncate text-xs text-[var(--muted-foreground)]">{item.companyName}</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <Phone className="h-3 w-3 text-[var(--muted-foreground)]" />
            <span className="text-xs text-[var(--muted-foreground)]">{formatPhone(item.phone)}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              Ligacao
            </Badge>
            <span className="truncate text-[10px] text-[var(--muted-foreground)]">{item.cadenceName}</span>
          </div>
        </div>

        {/* Actions menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onViewLead?.(item.leadId)}>
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              Ver lead
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSkip?.(item.enrollmentId)}>
              <SkipForward className="mr-2 h-3.5 w-3.5" />
              Pular
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
