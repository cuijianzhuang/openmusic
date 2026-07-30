import { memo } from 'react';
import type { QueueItem } from '../../types';
import { getActiveLyricPair } from '../../api/music';
import { useSmoothPlaybackTime } from '../../hooks/useSmoothPlaybackTime';
import { useTrackDuration, clampPlaybackTime } from '../../hooks/useTrackDuration';
import { useTrackLyrics } from '../../hooks/useTrackLyrics';
import TruncateTip from '../TruncateTip';

interface Props {
  song: QueueItem;
}

function MiniPlayerLyricTicker({ song }: Props) {
  const currentTime = useSmoothPlaybackTime();
  const duration = useTrackDuration(song);
  const displayTime = clampPlaybackTime(currentTime, duration);
  const lyrics = useTrackLyrics(song);
  const { current: currentLyric, next: nextLyric } = getActiveLyricPair(lyrics, displayTime);

  return (
    <div
      className="flex-1 min-w-0 px-1 text-center select-text sm:px-2"
      title="可直接选中复制歌词"
    >
      {currentLyric || nextLyric ? (
        <>
          {currentLyric ? (
            <TruncateTip
              text={currentLyric}
              as="p"
              className="min-w-0 text-xs sm:text-sm font-medium truncate leading-tight"
            />
          ) : (
            <p className="text-xs sm:text-sm font-medium truncate leading-tight">{'\u00A0'}</p>
          )}
          {nextLyric ? (
            <TruncateTip
              text={nextLyric}
              as="p"
              className="min-w-0 text-[10px] sm:text-xs text-netease-muted truncate leading-tight mt-0.5"
            />
          ) : (
            <p className="text-[10px] sm:text-xs text-netease-muted truncate leading-tight mt-0.5">{'\u00A0'}</p>
          )}
        </>
      ) : (
        <>
          <TruncateTip
            text={song.name}
            as="p"
            className="min-w-0 text-xs sm:text-sm font-medium truncate leading-tight"
          />
          <TruncateTip
            text={song.artist}
            as="p"
            className="min-w-0 text-[10px] sm:text-xs text-netease-muted truncate leading-tight mt-0.5"
          />
        </>
      )}
    </div>
  );
}

export default memo(MiniPlayerLyricTicker);
