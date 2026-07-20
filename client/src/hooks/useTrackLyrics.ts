import { useEffect, useState } from 'react';
import { getLyrics, parseLrc, getLrcFallbackDurationMs, getTrackKey } from '../api/music';
import { useAudioStore } from '../stores/audioStore';
import type { LyricLine, Song } from '../types';

export function useTrackLyrics(song: (Pick<Song, 'id' | 'source' | 'name' | 'lrc' | 'duration'> & Partial<Pick<Song, 'artist' | 'album'>>) | null | undefined) {
  const setLrcDuration = useAudioStore((s) => s.setLrcDuration);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);

  useEffect(() => {
    if (!song) {
      setLyrics([]);
      return;
    }

    setLyrics([]);
    getLyrics({
      id: song.id,
      source: song.source || 'netease',
      name: song.name,
      artist: song.artist,
      lrc: song.lrc,
    })
      .then((lrc) => {
        const lines = parseLrc(lrc);
        setLyrics(lines);
        if (!song.duration) {
          const ms = getLrcFallbackDurationMs(lrc);
          if (ms) setLrcDuration(getTrackKey(song), ms);
        }
      })
      .catch(() => setLyrics([]));
  }, [song?.id, song?.source, song?.name, song?.lrc, song?.duration, setLrcDuration]);

  return lyrics;
}
