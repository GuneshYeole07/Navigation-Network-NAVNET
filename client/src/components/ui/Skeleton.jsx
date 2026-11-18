export const Skeleton = ({ className = "" }) => <div className={`skeleton ${className}`} aria-hidden="true" />;

export function ListSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="panel flex items-center gap-4 p-4">
          <Skeleton className="h-14 w-14 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FullScreenLoader({ label = "Loading" }) {
  return (
    <div className="grid h-full min-h-[50vh] place-items-center" role="status">
      <div className="flex flex-col items-center gap-3">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-nh/20 border-t-nh" />
        <span className="text-sm muted">{label}…</span>
      </div>
    </div>
  );
}
