import { Skeleton } from '@/shared/components/ui/skeleton';

export default function CadenceDetailLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>

      {/* Metrics bar */}
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-4 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-12" />
          </div>
        ))}
      </div>

      {/* Timeline + sidebar */}
      <div className="flex gap-6">
        {/* Timeline steps */}
        <div className="flex-1 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="flex flex-col items-center gap-1">
                <Skeleton className="h-10 w-10 rounded-full" />
                {i < 3 && <Skeleton className="h-8 w-0.5" />}
              </div>
              <div className="flex-1 rounded-lg border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
          ))}
        </div>

        {/* Channel sidebar */}
        <div className="w-48 shrink-0 space-y-2">
          <Skeleton className="h-4 w-24 mb-3" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
