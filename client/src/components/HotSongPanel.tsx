import { useState, useEffect } from 'react';
import { Flame, Plus, Loader2, TrendingUp } from 'lucide-react';
import type { HotSongItem, SearchResult } from '../types';
import { getHotSongs, songKey } from '../api/music';
import SongCover from './SongCover';
import SourceBadge from './SourceBadge';
import Tooltip from './Tooltip';
import TruncateTip from './TruncateTip';

interface Props {
  addingId: string | null;
  onAdd: (song: SearchResult) => void;
  refreshKey?: number;
  compact?: boolean;
  embedded?: boolean;
  limit?: number;
}

function rankStyle(rank: number) {
  if (rank === 1) return 'bg-netease-red text-white';
  if (rank === 2) return 'bg-orange-500/90 text-white';
  if (rank === 3) return 'bg-amber-500/80 text-white';
  return 'bg-white/10 text-white/50';
}

const HOT_SONG_LIST_LIMIT = 15;

export default function HotSongPanel({
  addingId,
  onAdd,
  refreshKey = 0,
  compact = false,
  embedded = false,
  limit,
}: Props) {
  const fetchLimit = limit ?? HOT_SONG_LIST_LIMIT;
  const [songs, setSongs] = useState<HotSongItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadHot = async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await getHotSongs(fetchLimit);
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
  }, [compact, embedded, fetchLimit, refreshKey]);

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
                  <TruncateTip text={song.name} className="text-xs font-medium truncate" />
                  <TruncateTip text={song.artist} className="text-[10px] text-netease-muted truncate" />
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
      <div className={`flex items-center justify-between px-4 flex-shrink-0 ${embedded ? 'py-2' : 'py-2.5'} ${embedded ? '' : 'border-b border-netease-border/50'}`}>
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
                    className={`flex items-center gap-2 rounded-xl transition-colors hover:bg-netease-card/80 group ${embedded ? 'p-1.5' : 'p-2'}`}
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
                    <TruncateTip text={song.name} className="text-xs font-medium truncate leading-snug" />
                    <TruncateTip text={song.artist} className="text-[10px] text-netease-muted truncate" />
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-[10px] text-orange-400/90 font-medium">{song.count} 次</span>
                    <SourceBadge source={song.source} variant="muted" className="scale-90 origin-right" />
                  </div>
                  <Tooltip content="点歌">
                    <button
                      type="button"
                      onClick={() => handleAdd(song)}
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
}
