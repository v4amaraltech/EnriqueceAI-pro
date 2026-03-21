import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    href: string;
  };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 rounded-full bg-[var(--muted)] p-4">
        <Icon className="h-10 w-10 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
      </div>
      <h3 className="mb-2 text-lg font-semibold">{title}</h3>
      <p className="mb-6 max-w-sm text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{description}</p>
      {action && (
        <Button asChild>
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </div>
  );
}
