import { useAudioStore } from '../stores/audioStore';
import { getTrackKey } from '../api/music';
import type { Song, QueueItem } from '../types';

type TrackSong = Pick<Song, 'duration' | 'id' | 'source'> &
  Partial<Pick<QueueItem, 'queueId'>>;

interface DurationSources {
  lrcDurationMs: number | null;
  lrcTrackKey: string | null;
  mediaDurationMs: number | null;
  mediaTrackKey: string | null;
}

/** 播放/展示用时长（秒）：接口元数据优先，音频文件次之，歌词+20 兜底 */
export function resolveTrackDurationSeconds(
  song: TrackSong | null | undefined,
  sources: DurationSources,
): number {
  if (!song) return 0;

  const key = getTrackKey(song as Pick<QueueItem, 'queueId' | 'id' | 'source'>);

  if (song.duration && song.duration > 0) return song.duration / 1000;

  if (sources.mediaTrackKey === key && sources.mediaDurationMs && sources.mediaDurationMs > 0) {
    return sources.mediaDurationMs / 1000;
  }

  if (sources.lrcTrackKey === key && sources.lrcDurationMs && sources.lrcDurationMs > 0) {
    return sources.lrcDurationMs / 1000;
  }

  return 0;
}

export function clampPlaybackTime(currentTime: number, duration: number): number {
  if (duration <= 0) return currentTime;
  return Math.min(currentTime, duration);
}

export function useTrackDuration(song: TrackSong | null | undefined): number {
  const lrcDurationMs = useAudioStore((s) => s.lrcDurationMs);
  const lrcTrackKey = useAudioStore((s) => s.lrcTrackKey);
  const mediaDurationMs = useAudioStore((s) => s.mediaDurationMs);
  const mediaTrackKey = useAudioStore((s) => s.mediaTrackKey);

  return resolveTrackDurationSeconds(song, {
    lrcDurationMs,
    lrcTrackKey,
    mediaDurationMs,
    mediaTrackKey,
  });
}
