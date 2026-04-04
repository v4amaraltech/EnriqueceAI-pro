import { Skeleton } from '@/shared/components/ui/skeleton';

function KpiCardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
      <Skeleton className="h-10 w-20" />
      <Skeleton className="h-3 w-36" />
    </div>
  );
}

function RankingCardSkeleton() {
  return (
    <div className="rounded-lg border bg-card flex flex-col">
      <div className="px-6 pt-6">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex flex-col items-center px-6 pb-2 pt-5">
        <Skeleton className="h-14 w-14 rounded-full" />
        <Skeleton className="mt-4 h-10 w-16" />
        <Skeleton className="mt-3 h-4 w-40" />
      </div>
      <div className="mx-6 mt-4 border-t pt-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-10" />
          </div>
        ))}
      </div>
      <div className="mx-6 mt-4 border-t border-dashed py-4">
        <Skeleton className="h-6 w-24" />
      </div>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-[300px] w-full rounded" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
      </div>

      {/* Ranking cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <RankingCardSkeleton />
        <RankingCardSkeleton />
        <RankingCardSkeleton />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    </div>
  );
}
