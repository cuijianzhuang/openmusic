import { Fragment, useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import type { PlaylistSearchItem } from '../api/music/playlist';
import {
  CURATED_COUNT,
  CURATED_NETEASE,
  getRecommendedPlaylists,
  getRecommendedPlaylistsFallback,
  peekRecommendedPlaylists,
} from '../lib/recommendedPlaylists';

const NETEASE_EXTRA_LIMIT = 4;

function playlistKey(playlist: PlaylistSearchItem) {
  return `${playlist.platform}-${playlist.id}`;
}

interface Props {
  onSelectPlaylist: (playlist: PlaylistSearchItem) => Promise<void>;
  compact?: boolean;
  hideHeader?: boolean;
  immersive?: boolean;
}

function PlaylistCover({
  playlist,
  isLoading,
  compact = false,
}: {
  playlist: PlaylistSearchItem;
  isLoading: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-netease-card ${
        compact ? 'aspect-square w-full flex-shrink-0 rounded-xl' : 'aspect-square w-full rounded-2xl'
      }`}
    >
      {playlist.coverImgUrl ? (
        <img
          src={playlist.coverImgUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
            const fallback = event.currentTarget.nextElementSibling;
            if (fallback instanceof HTMLElement) fallback.style.display = 'flex';
          }}
        />
      ) : null}
      <div
        className={`h-full w-full items-center justify-center bg-gradient-to-br from-netease-card to-netease-dark text-netease-muted/35 ${playlist.coverImgUrl ? 'hidden' : 'flex'} ${compact ? 'text-sm' : 'text-lg'}`}
      >
        ♪
      </div>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <Loader2 className={`animate-spin text-white ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
        </div>
      )}
    </div>
  );
}

function PlaylistSkeleton({
  compact = false,
}: {
  compact?: boolean;
}) {
  const cardClass = compact ? 'aspect-square w-full rounded-xl' : 'aspect-square w-full rounded-2xl';

  if (compact) {
    return (
      <div className="flex min-w-min gap-2.5 pb-1">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex w-20 flex-shrink-0 flex-col items-center">
            <div className={`${cardClass} skeleton-shimmer`} />
            <div className="mt-1 h-2 w-full rounded skeleton-shimmer" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: CURATED_COUNT }, (_, i) => (
          <div key={`curated-${i}`} className="flex flex-col items-center">
            <div className={`${cardClass} skeleton-shimmer`} />
            <div className="mt-1 w-full space-y-1">
              <div className="h-2 w-full rounded skeleton-shimmer" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: NETEASE_EXTRA_LIMIT }, (_, i) => (
          <Fragment key={`extra-skeleton-${i}`}>
            {Array.from({ length: 2 }, (_, col) => (
              <div key={col} className="flex h-full flex-col items-center">
                <div className={`${cardClass} skeleton-shimmer`} />
                <div className="mt-1 w-full space-y-1">
                  <div className="h-2 w-full rounded skeleton-shimmer" />
                </div>
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function PlaylistCard({
  playlist,
  isLoading,
  disabled,
  compact,
  immersive = false,
  onSelect,
}: {
  playlist: PlaylistSearchItem;
  isLoading: boolean;
  disabled: boolean;
  compact: boolean;
  immersive?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`group flex flex-col transition-colors disabled:opacity-60 ${
        compact
          ? 'w-20 flex-shrink-0 items-center text-center'
          : immersive
            ? 'mineradio-glass-card h-full w-full items-center rounded-2xl p-1.5 text-center'
            : 'h-full w-full items-center rounded-2xl p-1 text-center hover:bg-netease-card/60'
      }`}
    >
      <PlaylistCover playlist={playlist} isLoading={isLoading} compact={compact} />
      <p
        className={`line-clamp-2 w-full min-h-[2.5em] font-medium leading-tight text-white/90 ${
          compact ? 'mt-1 text-center text-[10px] text-white/85' : 'mt-1 px-0.5 text-center text-[10px]'
        }`}
      >
        {playlist.name}
      </p>
    </button>
  );
}

export default function RecommendedPlaylistsPanel({
  onSelectPlaylist,
  compact = false,
  hideHeader = false,
  immersive = false,
}: Props) {
  const cached = peekRecommendedPlaylists();
  const [neteasePlaylists, setNeteasePlaylists] = useState(
    () => cached?.neteasePlaylists ?? CURATED_NETEASE,
  );
  const [qqPlaylists, setQqPlaylists] = useState(() => cached?.qqPlaylists ?? []);
  const [loading, setLoading] = useState(() => !cached);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!peekRecommendedPlaylists()) setLoading(true);
      try {
        const data = await getRecommendedPlaylists();
        if (cancelled) return;
        setNeteasePlaylists(data.neteasePlaylists);
        setQqPlaylists(data.qqPlaylists);
      } catch {
        if (!cancelled && !peekRecommendedPlaylists()) {
          const fallback = getRecommendedPlaylistsFallback();
          setNeteasePlaylists(fallback.neteasePlaylists);
          setQqPlaylists(fallback.qqPlaylists);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const handleSelect = async (playlist: PlaylistSearchItem) => {
    const key = playlistKey(playlist);
    if (loadingKey) return;
    setLoadingKey(key);
    try {
      await onSelectPlaylist(playlist);
    } finally {
      setLoadingKey(null);
    }
  };

  const renderPlaylistHorizontalScroll = () => {
    const curated = neteasePlaylists.slice(0, CURATED_COUNT);
    const neteaseExtras = neteasePlaylists.slice(CURATED_COUNT);
    const items: PlaylistSearchItem[] = [...curated];
    for (let i = 0; i < NETEASE_EXTRA_LIMIT; i += 1) {
      if (neteaseExtras[i]) items.push(neteaseExtras[i]);
      if (qqPlaylists[i]) items.push(qqPlaylists[i]);
    }

    return (
      <div className="flex min-w-min gap-2.5 pb-1">
        {items.map((playlist) => (
          <PlaylistCard
            key={playlistKey(playlist)}
            playlist={playlist}
            isLoading={loadingKey === playlistKey(playlist)}
            disabled={Boolean(loadingKey)}
            compact
            immersive={immersive}
            onSelect={() => void handleSelect(playlist)}
          />
        ))}
      </div>
    );
  };

  const renderPlaylistGrid = () => {
    const curated = neteasePlaylists.slice(0, CURATED_COUNT);
    const neteaseExtras = neteasePlaylists.slice(CURATED_COUNT);

    const renderCard = (playlist: PlaylistSearchItem) => (
      <PlaylistCard
        key={playlistKey(playlist)}
        playlist={playlist}
        isLoading={loadingKey === playlistKey(playlist)}
        disabled={Boolean(loadingKey)}
        compact={false}
        immersive={immersive}
        onSelect={() => void handleSelect(playlist)}
      />
    );

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {curated.map(renderCard)}
        </div>
        <div className="grid grid-cols-2 items-stretch gap-2">
          {Array.from({ length: NETEASE_EXTRA_LIMIT }, (_, i) => (
            <Fragment key={`extra-row-${i}`}>
              {neteaseExtras[i] ? (
                <div className="min-h-0">{renderCard(neteaseExtras[i])}</div>
              ) : (
                <div aria-hidden />
              )}
              {qqPlaylists[i] ? (
                <div className="min-h-0">{renderCard(qqPlaylists[i])}</div>
              ) : !loading && i === 0 && qqPlaylists.length === 0 ? (
                <p className="flex min-h-full items-center justify-center px-1 py-2 text-center text-[10px] text-netease-muted">
                  暂无推荐
                </p>
              ) : (
                <div aria-hidden />
              )}
            </Fragment>
          ))}
        </div>
      </div>
    );
  };

  if (compact) {
    return (
      <div className="flex flex-shrink-0 flex-col overflow-hidden rounded-3xl border border-netease-border/50 bg-netease-card/30">
        <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-netease-border/50 px-3 py-2">
          <Sparkles className="h-3.5 w-3.5 text-sky-400" />
          <h2 className="text-xs font-medium">热榜歌单</h2>
        </div>
        <div className="overflow-x-auto p-2">
          {loading ? <PlaylistSkeleton compact /> : renderPlaylistHorizontalScroll()}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {!hideHeader && (
      <div className="flex flex-shrink-0 items-center gap-1.5 border-t border-netease-border/50 px-4 py-1.5 lg:border-t-0">
        <Sparkles className="h-4 w-4 text-sky-400" />
        <h2 className="text-sm font-medium">热榜歌单</h2>
      </div>
      )}

      <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 ${hideHeader ? 'pt-3' : ''}`}>
        {loading ? <PlaylistSkeleton /> : renderPlaylistGrid()}
      </div>
    </div>
  );
}
