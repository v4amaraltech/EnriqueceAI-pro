import Link from 'next/link';
import { MailPlus } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

interface PendingInvitesBannerProps {
  count: number;
}

export function PendingInvitesBanner({ count }: PendingInvitesBannerProps) {
  if (count <= 0) return null;

  return (
    <div className="flex items-center justify-center gap-3 border-b border-blue-300/30 bg-blue-50 px-4 py-2 text-sm text-blue-800 dark:border-blue-700/30 dark:bg-blue-900/20 dark:text-blue-200">
      <MailPlus className="h-4 w-4 flex-shrink-0" />
      <span>
        Você tem <strong>{count}</strong> {count === 1 ? 'convite pendente' : 'convites pendentes'} para entrar em uma organização.
      </span>
      <Link href="/convites">
        <Button size="sm" variant="outline" className="h-7 border-blue-400 text-blue-800 hover:bg-blue-100 dark:border-blue-600 dark:text-blue-200 dark:hover:bg-blue-900/40">
          Ver convites
        </Button>
      </Link>
    </div>
  );
}
