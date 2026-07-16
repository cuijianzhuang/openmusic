import { memo, useState, useEffect } from 'react';
import { Flame, Plus, Loader2, TrendingUp } from 'lucide-react';
import type { SearchResult } from '../types';
import { songKey } from '../api/music';
import { getNeteaseHotToplist } from '../api/music/toplist';
import SongCover from './SongCover';
import Tooltip from './Tooltip';
import TruncateTip from './TruncateTip';

interface Props {
  addingId: string | null;
  onAdd: (song: SearchResult) => void;
  compact?: boolean;
  embedded?: boolean;
  /** 紧凑横滑最多展示条数；完整列表固定 200 */
  compactLimit?: number;
}

const TOPLIST_LIMIT = 200;
const COMPACT_LIMIT = 30;

const HOT_NAME_LINE_CLS = 'w-full min-w-0 truncate leading-tight';
const HOT_ARTIST_LINE_CLS = 'w-full min-w-0 truncate leading-tight';

function rankStyle(rank: number) {
  if (rank === 1) return 'bg-netease-red text-white';
  if (rank === 2) return 'bg-orange-500/90 text-white';
  if (rank === 3) return 'bg-amber-500/80 text-white';
  return 'bg-white/10 text-white/50';
}

export default memo(function HotSongPanel({
  addingId,
  onAdd,
  compact = false,
  embedded = false,
  compactLimit = COMPACT_LIMIT,
}: Props) {
  const [title, setTitle] = useState('网易云热榜');
  const [songs, setSongs] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await getNeteaseHotToplist(TOPLIST_LIMIT);
        if (cancelled) return;
        setTitle(data.name?.trim() || '网易云热榜');
        setSongs(data.songs);
        setError('');
      } catch (err: unknown) {
        if (cancelled) return;
        if (!silent) {
          setError(err instanceof Error ? err.message : '加载失败');
        }
      } finally {
        if (!cancelled && !silent) setLoading(false);
      }
    };

    void load();
    // 热榜服务端按自然日缓存；前端每小时静默刷新即可
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void load(true);
    }, 60 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const displaySongs = compact ? songs.slice(0, compactLimit) : songs;

  if (compact) {
    return (
      <div className="bg-netease-card/30 border border-netease-border/50 rounded-2xl overflow-hidden flex-shrink-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-netease-border/50">
          <div className="flex items-center gap-1.5 min-w-0">
            <Flame className="w-4 h-4 flex-shrink-0 text-orange-400" />
            <h2 className="text-sm font-medium truncate">{title}</h2>
          </div>
          {!loading && songs.length > 0 && (
            <span className="text-[10px] text-netease-muted flex-shrink-0">Top {displaySongs.length}</span>
          )}
        </div>
        <div className="p-2 overflow-x-auto">
          {loading && songs.length === 0 ? (
            <p className="text-xs text-netease-muted text-center py-3">加载中...</p>
          ) : error && songs.length === 0 ? (
            <p className="text-xs text-netease-muted text-center py-3">{error}</p>
          ) : songs.length === 0 ? (
            <p className="text-xs text-netease-muted text-center py-3">暂无热榜歌曲</p>
          ) : (
            <div className="flex gap-2 min-w-min pb-1">
              {displaySongs.map((song, i) => (
                <button
                  key={songKey(song)}
                  type="button"
                  onClick={() => onAdd(song)}
                  disabled={addingId === songKey(song)}
                  className="flex-shrink-0 w-28 rounded-xl bg-netease-card/60 border border-netease-border/40 p-2 text-left hover:border-netease-red/40 transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center gap-1 mb-1">
                    <span className={`text-[10px] font-bold w-4 h-4 rounded flex items-center justify-center ${rankStyle(i + 1)}`}>
                      {i + 1}
                    </span>
                  </div>
                  <TruncateTip text={song.name} className={`text-xs font-medium ${HOT_NAME_LINE_CLS}`} />
                  <TruncateTip text={song.artist} className={`mt-0.5 text-[10px] text-netease-muted ${HOT_ARTIST_LINE_CLS}`} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col min-h-0 ${embedded ? 'h-full flex-1' : 'bg-netease-card/30 border border-netease-border/50 rounded-2xl overflow-hidden h-full'}`}>
      <div className={`flex items-center justify-between gap-2 px-4 flex-shrink-0 ${embedded ? 'py-2' : 'py-2.5'} ${embedded ? '' : 'border-b border-netease-border/50'}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <Flame className="w-4 h-4 flex-shrink-0 text-orange-400" />
          <h2 className="text-sm font-medium truncate">{title}</h2>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!loading && songs.length > 0 && (
            <span className="text-[10px] text-netease-muted">{songs.length} 首</span>
          )}
          <TrendingUp className="w-3.5 h-3.5 text-netease-muted" />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {loading && songs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-netease-muted">
            <Loader2 className="w-5 h-5 animate-spin mb-2" />
            <p className="text-xs">加载热榜...</p>
          </div>
        ) : error && songs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-netease-muted px-3">
            <Flame className="w-6 h-6 mb-2 opacity-30" />
            <p className="text-xs text-center">{error}</p>
          </div>
        ) : songs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-netease-muted px-3">
            <Flame className="w-6 h-6 mb-2 opacity-30" />
            <p className="text-xs text-center">暂无热榜歌曲</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {displaySongs.map((song, i) => {
              const rank = i + 1;
              const key = songKey(song);
              const isAdding = addingId === key;

              return (
                <div
                  key={key}
                  className={`flex items-center gap-2 rounded-xl transition-colors hover:bg-netease-card/80 group ${embedded ? 'px-1.5 py-1' : 'px-2 py-1.5'}`}
                >
                  <span
                    className={`flex-shrink-0 w-5 h-5 rounded text-[11px] font-bold flex items-center justify-center ${rankStyle(rank)}`}
                  >
                    {rank}
                  </span>
                  <SongCover
                    song={song}
                    className="w-9 h-9 rounded-md object-cover bg-netease-card flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <TruncateTip text={song.name} className={`text-xs font-medium ${HOT_NAME_LINE_CLS}`} />
                    <TruncateTip text={song.artist} className={`mt-0.5 text-[10px] text-netease-muted ${HOT_ARTIST_LINE_CLS}`} />
                  </div>
                  <Tooltip content="点歌">
                    <button
                      type="button"
                      onClick={() => onAdd(song)}
                      disabled={isAdding}
                      className="flex-shrink-0 p-1.5 rounded-lg bg-netease-red/10 text-netease-red opacity-0 group-hover:opacity-100 hover:bg-netease-red hover:text-white transition-all disabled:opacity-50"
                      aria-label="点歌"
                    >
                      {isAdding ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
