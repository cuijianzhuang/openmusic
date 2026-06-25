import { getStoredSongResultPageSize } from '../lib/songResultPagination';

export const RESULT_BODY_HEIGHT = 'min(52vh, 480px)';

interface Props {
  count?: number;
  fillHeight?: boolean;
  showPaginationFooter?: boolean;
}

function PaginationSkeleton() {
  return (
    <div className="mt-auto flex-shrink-0 space-y-2 overflow-visible border-t border-netease-border/40 bg-netease-bg/90 pt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="h-7 w-24 rounded-lg skeleton-shimmer" />
        <div className="h-4 w-20 rounded skeleton-shimmer" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="h-7 w-28 rounded-lg skeleton-shimmer" />
        <div className="h-7 w-16 rounded-lg skeleton-shimmer" />
        <div className="h-7 w-20 rounded-lg skeleton-shimmer" />
      </div>
    </div>
  );
}

export default function SearchSkeleton({
  count = getStoredSongResultPageSize(),
  fillHeight = false,
  showPaginationFooter = true,
}: Props) {
  return (
    <div
      className={`flex min-h-0 flex-col ${fillHeight ? 'h-full' : ''}`}
      style={fillHeight ? undefined : { height: RESULT_BODY_HEIGHT }}
    >
      <div className="min-h-0 flex-1 space-y-2 overflow-hidden">
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl p-3"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="h-12 w-12 flex-shrink-0 rounded-lg skeleton-shimmer" />
            <div className="min-w-0 flex-1 space-y-2.5">
              <div
                className="h-3.5 rounded-md skeleton-shimmer"
                style={{ width: `${55 + (i % 3) * 12}%` }}
              />
              <div
                className="h-3 rounded-md skeleton-shimmer"
                style={{ width: `${35 + (i % 2) * 15}%` }}
              />
            </div>
            <div className="h-5 w-10 flex-shrink-0 rounded-full skeleton-shimmer" />
          </div>
        ))}
      </div>
      {showPaginationFooter && <PaginationSkeleton />}
    </div>
  );
}
