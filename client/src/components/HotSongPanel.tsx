import { useState, useEffect, useRef } from 'react';
import { Flame, Plus, Loader2, TrendingUp } from 'lucide-react';
import type { HotSongItem, SearchResult } from '../types';
import { getHotSongs, getCoverUrl, songKey } from '../api/music';
import SourceBadge from './SourceBadge';

interface Props {
  addingId: string | null;
  onAdd: (song: SearchResult) => void;
  refreshKey?: number;
  compact?: boolean;
}

function rankStyle(rank: number) {
  if (rank === 1) return 'bg-netease-red text-white';
  if (rank === 2) return 'bg-orange-500/90 text-white';
  if (rank === 3) return 'bg-amber-500/80 text-white';
  return 'bg-white/10 text-white/50';
}

function TruncateWithTip({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [title, setTitle] = useState<string | undefined>();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setTitle(el.scrollWidth > el.clientWidth ? text : undefined);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  return (
    <p ref={ref} className={className} title={title}>
      {text}
    </p>
  );
}

export default function HotSongPanel({ addingId, onAdd, refreshKey = 0, compact = false }: Props) {
  const [songs, setSongs] = useState<HotSongItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadHot = async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await getHotSongs(compact ? 8 : 15);
        if (cancelled) return;
        setSongs(data);
      } catch {
        // 接口失败：保留现有数据，跳过本次更新
      } finally {
        if (!cancelled && !silent) setLoading(false);
      }
    };

    void loadHot();
    const timer = window.setInterval(() => void loadHot(true), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [compact, refreshKey]);

  const handleAdd = (song: HotSongItem) => {
    onAdd({
      id: song.id,
      source: song.source,
      name: song.name,
      artist: song.artist,
      album: song.album,
      pic: song.pic,
      duration: song.duration,
    });
  };

  if (compact) {
    return (
      <div className="bg-netease-card/30 border border-netease-border/50 rounded-2xl overflow-hidden flex-shrink-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-netease-border/50">
          <div className="flex items-center gap-1.5">
            <Flame className="w-4 h-4 text-orange-400" />
            <h2 className="text-sm font-medium">点歌热榜</h2>
          </div>
        </div>
        <div className="p-2 overflow-x-auto">
          {loading && songs.length === 0 ? (
            <p className="text-xs text-netease-muted text-center py-3">加载中...</p>
          ) : songs.length === 0 ? (
            <p className="text-xs text-netease-muted text-center py-3">暂无点歌记录</p>
          ) : (
            <div className="flex gap-2 min-w-min pb-1">
              {songs.map((song, i) => (
                <button
                  key={songKey(song)}
                  type="button"
                  onClick={() => handleAdd(song)}
                  disabled={addingId === songKey(song)}
                  className="flex-shrink-0 w-28 rounded-xl bg-netease-card/60 border border-netease-border/40 p-2 text-left hover:border-netease-red/40 transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center gap-1 mb-1">
                    <span className={`text-[10px] font-bold w-4 h-4 rounded flex items-center justify-center ${rankStyle(i + 1)}`}>
                      {i + 1}
                    </span>
                    <span className="text-[10px] text-netease-muted truncate">{song.count} 次</span>
                  </div>
                  <TruncateWithTip text={song.name} className="text-xs font-medium truncate" />
                  <TruncateWithTip text={song.artist} className="text-[10px] text-netease-muted truncate" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-netease-card/30 border border-netease-border/50 rounded-2xl overflow-hidden flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-netease-border/50 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Flame className="w-4 h-4 text-orange-400" />
          <h2 className="text-sm font-medium">点歌热榜</h2>
        </div>
        <TrendingUp className="w-3.5 h-3.5 text-netease-muted" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {loading && songs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-netease-muted">
            <Loader2 className="w-5 h-5 animate-spin mb-2" />
            <p className="text-xs">加载热榜...</p>
          </div>
        ) : songs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-netease-muted px-3">
            <Flame className="w-6 h-6 mb-2 opacity-30" />
            <p className="text-xs text-center">还没有点歌记录</p>
            <p className="text-[10px] text-center mt-1 opacity-70">点歌后会出现在这里</p>
          </div>
        ) : (
          <div className="space-y-1">
            {songs.map((song, i) => {
              const rank = i + 1;
              const key = songKey(song);
              const isAdding = addingId === key;

              return (
                <div
                  key={key}
                  className="flex items-center gap-2 p-2 rounded-xl hover:bg-netease-card/80 group transition-colors"
                >
                  <span
                    className={`flex-shrink-0 w-5 h-5 rounded text-[11px] font-bold flex items-center justify-center ${rankStyle(rank)}`}
                  >
                    {rank}
                  </span>
                  <img
                    src={getCoverUrl(song)}
                    alt=""
                    className="w-9 h-9 rounded-md object-cover bg-netease-card flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect fill="%23333" width="48" height="48"/><text x="24" y="28" text-anchor="middle" fill="%23666" font-size="16">♪</text></svg>';
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <TruncateWithTip text={song.name} className="text-xs font-medium truncate leading-snug" />
                    <TruncateWithTip text={song.artist} className="text-[10px] text-netease-muted truncate" />
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-[10px] text-orange-400/90 font-medium">{song.count} 次</span>
                    <SourceBadge source={song.source} variant="muted" className="scale-90 origin-right" />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAdd(song)}
                    disabled={isAdding}
                    className="flex-shrink-0 p-1.5 rounded-lg bg-netease-red/10 text-netease-red opacity-0 group-hover:opacity-100 hover:bg-netease-red hover:text-white transition-all disabled:opacity-50"
                    title="点歌"
                  >
                    {isAdding ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
