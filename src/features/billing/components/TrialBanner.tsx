import { Clock, Zap } from 'lucide-react';
import Link from 'next/link';

interface TrialBannerProps {
  daysRemaining: number;
}

function getBannerStyle(days: number): { bg: string; text: string; icon: string } {
  if (days <= 3) {
    return {
      bg: 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800',
      text: 'text-red-800 dark:text-red-200',
      icon: 'text-red-600 dark:text-red-400',
    };
  }
  if (days <= 7) {
    return {
      bg: 'bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800',
      text: 'text-orange-800 dark:text-orange-200',
      icon: 'text-orange-600 dark:text-orange-400',
    };
  }
  return {
    bg: 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800',
    text: 'text-amber-800 dark:text-amber-200',
    icon: 'text-amber-600 dark:text-amber-400',
  };
}

export function TrialBanner({ daysRemaining }: TrialBannerProps) {
  const style = getBannerStyle(daysRemaining);
  const dayLabel = daysRemaining === 1 ? 'dia' : 'dias';

  return (
    <div className={`flex items-center justify-between border-b px-4 py-2 ${style.bg}`}>
      <div className={`flex items-center gap-2 text-sm font-medium ${style.text}`}>
        <Clock className={`size-4 ${style.icon}`} />
        <span>
          Seu trial expira em {daysRemaining} {dayLabel}
        </span>
      </div>
      <Link
        href="/settings/billing"
        className={`flex items-center gap-1 text-sm font-semibold underline-offset-2 hover:underline ${style.text}`}
      >
        <Zap className="size-3.5" />
        Fazer upgrade
      </Link>
    </div>
  );
}
