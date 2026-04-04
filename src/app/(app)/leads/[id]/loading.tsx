import { Skeleton } from '@/shared/components/ui/skeleton';

export default function LeadDetailLoading() {
  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0">
      {/* Sidebar skeleton */}
      <div className="w-[400px] shrink-0 border-r border-[var(--border)] p-4 space-y-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>

        {/* Status badges */}
        <div className="flex gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>

        {/* Tabs */}
        <div className="flex gap-3 border-b pb-2">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-14" />
        </div>

        {/* Fields */}
        <div className="space-y-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>

      {/* Main content skeleton */}
      <div className="flex-1 p-6 space-y-5 overflow-hidden">
        {/* KPI cards */}
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-lg" />
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-4 border-b pb-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>

        {/* Timeline entries */}
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
              <Skeleton className="h-3 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
