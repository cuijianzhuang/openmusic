import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { fetchNeteasePlaylistMetas, searchNeteasePlaylists, type NeteasePlaylistSearchItem } from '../api/music/playlist';

const CURATED_PLAYLISTS: NeteasePlaylistSearchItem[] = [
  {
    id: '3778678',
    name: '云音乐热歌榜',
    coverImgUrl: 'https://p1.music.126.net/0SUEG8yDACfx0Bw2MYFv4Q==/109951170048519512.jpg',
    trackCount: 0,
    playCount: 0,
  },
  {
    id: '19723756',
    name: '云音乐飙升榜',
    coverImgUrl: 'https://p2.music.126.net/rIi7Qzy2i2Y_1QD7cd0MYA==/109951170048506929.jpg',
    trackCount: 0,
    playCount: 0,
  },
  {
    id: '2250011882',
    name: '抖音排行榜',
    coverImgUrl: 'https://p2.music.126.net/8sRm2fQNh_KZeWmJ1sRhQQ==/109951165611408950.jpg',
    trackCount: 0,
    playCount: 0,
  },
  {
    id: '3779629',
    name: '云音乐新歌榜',
    coverImgUrl: 'https://p1.music.126.net/5guhqPBTcIrrhLBotgaT6w==/109951170048511751.jpg',
    trackCount: 0,
    playCount: 0,
  },
];

const CURATED_IDS = new Set(CURATED_PLAYLISTS.map((item) => item.id));
const RECOMMEND_KEYWORD = '推荐';
const RECOMMEND_EXTRA_LIMIT = 2;
const SKELETON_COUNT = CURATED_PLAYLISTS.length + RECOMMEND_EXTRA_LIMIT;

function mergePlaylistMeta(
  base: NeteasePlaylistSearchItem[],
  meta: NeteasePlaylistSearchItem[],
): NeteasePlaylistSearchItem[] {
  const metaMap = new Map(meta.map((item) => [item.id, item]));
  return base.map((item) => {
    const remote = metaMap.get(item.id);
    if (!remote) return item;
    return {
      ...item,
      name: remote.name || item.name,
      coverImgUrl: remote.coverImgUrl || item.coverImgUrl,
      creatorName: remote.creatorName || item.creatorName,
      trackCount: remote.trackCount || item.trackCount,
      playCount: remote.playCount || item.playCount,
    };
  });
}

interface Props {
  onSelectPlaylist: (playlist: NeteasePlaylistSearchItem) => Promise<void>;
  compact?: boolean;
}

function PlaylistCover({
  playlist,
  isLoading,
  compact = false,
}: {
  playlist: NeteasePlaylistSearchItem;
  isLoading: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-netease-card ${
        compact ? 'h-12 w-12 flex-shrink-0 rounded-md' : 'aspect-square w-full rounded-lg'
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

function PlaylistSkeleton({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex min-w-min gap-2 pb-0.5">
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <div key={i} className="flex w-[4.25rem] flex-shrink-0 flex-col">
            <div className="h-12 w-12 rounded-md skeleton-shimmer" />
            <div className="mt-1 space-y-1">
              <div className="h-2 w-full rounded skeleton-shimmer" />
              <div className="h-2 w-2/3 rounded skeleton-shimmer" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <div key={i} className="flex flex-col items-center">
          <div className="aspect-square w-full rounded-lg skeleton-shimmer" />
          <div className="mt-1 w-full space-y-1">
            <div className="h-2 w-full rounded skeleton-shimmer" />
            <div className="h-2 w-4/5 rounded skeleton-shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function RecommendedPlaylistsPanel({ onSelectPlaylist, compact = false }: Props) {
  const [playlists, setPlaylists] = useState<NeteasePlaylistSearchItem[]>(CURATED_PLAYLISTS);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [curatedMeta, data] = await Promise.all([
          fetchNeteasePlaylistMetas(CURATED_PLAYLISTS.map((item) => item.id)),
          searchNeteasePlaylists(RECOMMEND_KEYWORD, 1, RECOMMEND_EXTRA_LIMIT + 2),
        ]);
        if (cancelled) return;
        const curated = mergePlaylistMeta(CURATED_PLAYLISTS, curatedMeta);
        const extras = data.playlists
          .filter((item) => !CURATED_IDS.has(item.id))
          .slice(0, RECOMMEND_EXTRA_LIMIT);
        setPlaylists([...curated, ...extras]);
      } catch {
        if (!cancelled) setPlaylists(CURATED_PLAYLISTS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const handleSelect = async (playlist: NeteasePlaylistSearchItem) => {
    if (loadingId) return;
    setLoadingId(playlist.id);
    try {
      await onSelectPlaylist(playlist);
    } finally {
      setLoadingId(null);
    }
  };

  if (compact) {
    return (
      <div className="flex flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-netease-border/50 bg-netease-card/30">
        <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-netease-border/50 px-3 py-2">
          <Sparkles className="h-3.5 w-3.5 text-sky-400" />
          <h2 className="text-xs font-medium">为你推荐</h2>
        </div>
        <div className="overflow-x-auto p-2">
          {loading ? (
            <PlaylistSkeleton compact />
          ) : (
            <div className="flex min-w-min gap-2 pb-0.5">
              {playlists.map((playlist) => {
                const isLoading = loadingId === playlist.id;
                return (
                  <button
                    key={playlist.id}
                    type="button"
                    disabled={Boolean(loadingId)}
                    onClick={() => void handleSelect(playlist)}
                    className="group flex w-[4.25rem] flex-shrink-0 flex-col items-center text-center transition-colors disabled:opacity-60"
                  >
                    <PlaylistCover playlist={playlist} isLoading={isLoading} compact />
                    <p className="mt-1 line-clamp-2 w-full text-center text-[10px] font-medium leading-tight text-white/85">
                      {playlist.name}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center gap-1.5 border-t border-netease-border/50 px-4 py-1.5 lg:border-t-0">
        <Sparkles className="h-4 w-4 text-sky-400" />
        <h2 className="text-sm font-medium">为你推荐</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        {loading ? (
          <PlaylistSkeleton />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {playlists.map((playlist) => {
              const isLoading = loadingId === playlist.id;
              return (
                <button
                  key={playlist.id}
                  type="button"
                  disabled={Boolean(loadingId)}
                  onClick={() => void handleSelect(playlist)}
                  className="group flex flex-col items-center rounded-lg p-0.5 text-center transition-colors hover:bg-netease-card/60 disabled:opacity-60"
                >
                  <PlaylistCover playlist={playlist} isLoading={isLoading} />
                  <p className="mt-1 line-clamp-2 w-full px-0.5 text-center text-[10px] font-medium leading-tight text-white/90">
                    {playlist.name}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
