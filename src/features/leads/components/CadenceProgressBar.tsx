'use client';

import { useEffect, useRef } from 'react';

import { Check, Linkedin, Mail, MessageSquare, Phone, Search } from 'lucide-react';

import type { ChannelType } from '@/features/cadences/types';

import type { EnrollmentStepInfo } from '../actions/fetch-lead-enrollment';

interface CadenceProgressBarProps {
  steps: EnrollmentStepInfo[];
  cadenceName: string;
}

const channelIcons: Record<ChannelType, typeof Mail> = {
  email: Mail,
  whatsapp: MessageSquare,
  phone: Phone,
  linkedin: Linkedin,
  research: Search,
};

const statusColors = {
  completed: 'bg-green-500 text-white border-green-500',
  current: 'bg-orange-500 text-white border-orange-500',
  future: 'bg-[var(--muted)] text-[var(--muted-foreground)] dark:text-[var(--foreground)] border-[var(--border)]',
} as const;

const lineColors = {
  completed: 'bg-green-500',
  current: 'bg-orange-300',
  future: 'bg-[var(--border)]',
} as const;

export function CadenceProgressBar({ steps, cadenceName }: CadenceProgressBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);

  // Cadências longas não cabem no card: a trilha rola na horizontal e já abre
  // centralizada no passo atual (sem mexer na rolagem vertical da página).
  useEffect(() => {
    const container = scrollRef.current;
    const current = currentRef.current;
    if (!container || !current) return;
    container.scrollLeft = current.offsetLeft - container.clientWidth / 2 + current.offsetWidth / 2;
  }, [steps]);

  if (steps.length === 0) return null;

  return (
    <div className="p-4">
      <p className="mb-3 text-xs font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)] uppercase tracking-wider">
        {cadenceName}
      </p>
      <div ref={scrollRef} className="relative -mx-1 flex items-center overflow-x-auto px-1 py-1">
        {steps.map((step, i) => {
          const Icon = channelIcons[step.channel] ?? Mail;
          const isLast = i === steps.length - 1;

          return (
            <div key={step.step_order} className="flex shrink-0 items-center">
              <div
                ref={step.status === 'current' ? currentRef : undefined}
                className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 ${statusColors[step.status]}`}
                title={`Passo ${step.step_order} — ${step.channel}`}
              >
                <Icon className="h-4 w-4" />
                {step.status === 'completed' && (
                  <div className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-600 text-white ring-2 ring-[var(--card)]">
                    <Check className="h-2 w-2" />
                  </div>
                )}
              </div>
              {!isLast && (
                <div
                  className={`h-0.5 w-8 shrink-0 ${lineColors[step.status]}`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
