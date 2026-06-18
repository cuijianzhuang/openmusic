import { useEffect, useRef, useCallback } from 'react';
import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';
import { useSocket } from '../hooks/useSocket';
import { getLyrics, getLrcFallbackDurationMs, getTrackKey } from '../api/music';
import { resolveTrackDurationSeconds } from '../hooks/useTrackDuration';
import type { QueueItem } from '../types';
import { getSharedAudio } from '../lib/audioElement';
import { onWeChatBridgeReady, tryPlayWithAutoplayFallback } from '../lib/audioUnlock';
import { prefetchQueueSongs, rememberSongUrl, resolveSongUrl } from '../lib/songPreloadCache';

let audioListenersAttached = false;

function trackKeyOf(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  return getTrackKey(song);
}

function getEffectiveDurationSec(song: QueueItem | null | undefined): number {
  const { lrcDurationMs, lrcTrackKey, mediaDurationMs, mediaTrackKey } = useAudioStore.getState();
  return resolveTrackDurationSeconds(song, {
    lrcDurationMs,
    lrcTrackKey,
    mediaDurationMs,
    mediaTrackKey,
  });
}

function capSeekTime(time: number, song: QueueItem | null | undefined, mediaDur: number): number {
  const effectiveDur = getEffectiveDurationSec(song);
  const cap = effectiveDur > 0
    ? effectiveDur - 0.25
    : (isFinite(mediaDur) && mediaDur > 0 ? mediaDur - 0.25 : time);
  return Math.max(0, Math.min(time, cap));
}

function syncMediaDuration(audio: HTMLAudioElement, trackKey: string) {
  const dur = audio.duration;
  if (!isFinite(dur) || dur <= 0) return;
  useAudioStore.getState().setMediaDuration(trackKey, Math.round(dur * 1000));
}

interface UseAudioPlayerOptions {
  tvMode?: boolean;
}

export function useAudioPlayer(options: UseAudioPlayerOptions = {}) {
  const tvMode = options.tvMode ?? false;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const room = useRoomStore((s) => s.room);
  const setTrackLoading = useAudioStore((s) => s.setTrackLoading);
  const setLrcDuration = useAudioStore((s) => s.setLrcDuration);
  const setMediaDuration = useAudioStore((s) => s.setMediaDuration);
  const setSeekPlayback = useAudioStore((s) => s.setSeekPlayback);
  const setNeedsAudioUnlock = useAudioStore((s) => s.setNeedsAudioUnlock);
  const needsAudioUnlock = useAudioStore((s) => s.needsAudioUnlock);
  const setRetryPlayback = useAudioStore((s) => s.setRetryPlayback);
  const { togglePlay, seek, skipSong, syncTime } = useSocket();

  const lastTrackKey = useRef<string | null>(null);
  const readyTrackKey = useRef<string | null>(null);
  const loadGeneration = useRef(0);
  const skippingRef = useRef(false);
  const syncing = useRef(false);
  const errorRetries = useRef(0);
  const lastSyncAt = useRef(0);

  const playAudio = useCallback(async (audio: HTMLAudioElement) => {
    return tryPlayWithAutoplayFallback(audio, tvMode);
  }, [tvMode]);

  const requestSkip = useCallback(() => {
    if (skippingRef.current) return;
    const { isOwner } = useRoomStore.getState();
    if (!isOwner) return;

    skippingRef.current = true;
    audioRef.current?.pause();
    skipSong().finally(() => {
      skippingRef.current = false;
    });
  }, [skipSong]);

  const initAudio = useCallback(() => {
    const audio = getSharedAudio();
    audioRef.current = audio;

    if (!audioListenersAttached) {
      audioListenersAttached = true;

      audio.addEventListener('ended', () => {
        const live = useRoomStore.getState();
        if (!live.isOwner || !live.room?.current) return;
        if (readyTrackKey.current !== trackKeyOf(live.room.current)) return;
        requestSkip();
      });

      audio.addEventListener('error', () => {
        const live = useRoomStore.getState();
        if (!live.isOwner || !live.room?.current || skippingRef.current) return;
        if (readyTrackKey.current !== trackKeyOf(live.room.current)) return;

        if (errorRetries.current < 2) {
          errorRetries.current += 1;
          audio.load();
          audio.play().catch(() => {});
          return;
        }
        requestSkip();
      });

      audio.addEventListener('playing', () => {
        errorRetries.current = 0;
        const live = useRoomStore.getState().room;
        if (live?.queue.length) prefetchQueueSongs(live.queue);
      });

      audio.addEventListener('loadedmetadata', () => {
        const live = useRoomStore.getState().room?.current;
        if (!live || lastTrackKey.current !== trackKeyOf(live)) return;
        syncMediaDuration(audio, lastTrackKey.current);
      });

      audio.addEventListener('durationchange', () => {
        const live = useRoomStore.getState().room?.current;
        if (!live || lastTrackKey.current !== trackKeyOf(live)) return;
        syncMediaDuration(audio, lastTrackKey.current);
      });

      audio.addEventListener('timeupdate', () => {
        if (syncing.current || !audioRef.current) return;
        const { isOwner, room: liveRoom } = useRoomStore.getState();
        if (!isOwner || !liveRoom?.isPlaying || !liveRoom.current) return;
        if (readyTrackKey.current !== trackKeyOf(liveRoom.current)) return;

        const effectiveDur = getEffectiveDurationSec(liveRoom.current);
        if (effectiveDur > 0 && audioRef.current.currentTime >= effectiveDur - 0.15) {
          requestSkip();
          return;
        }

        const now = Date.now();
        if (now - lastSyncAt.current < 2000) return;
        lastSyncAt.current = now;
        const syncAt = effectiveDur > 0
          ? Math.min(audioRef.current.currentTime, effectiveDur)
          : audioRef.current.currentTime;
        syncTime(syncAt);
      });
    }

    return audio;
  }, [requestSkip, syncTime]);

  const retryPlayback = useCallback(async (fromUserGesture = false) => {
    const audio = audioRef.current;
    const liveRoom = useRoomStore.getState().room;
    if (!audio || !liveRoom?.current) return;

    const trackKey = trackKeyOf(liveRoom.current);
    if (readyTrackKey.current !== trackKey) return;

    if (!liveRoom.isPlaying && !fromUserGesture) {
      setNeedsAudioUnlock(false);
      return;
    }

    const result = await playAudio(audio);
    if (result === 'played') {
      setNeedsAudioUnlock(false);
      if (liveRoom.isPlaying || fromUserGesture) {
        syncTime(audio.currentTime);
        lastSyncAt.current = Date.now();
      }
    } else if (result === 'blocked') {
      setNeedsAudioUnlock(true);
    }
  }, [syncTime, setNeedsAudioUnlock, playAudio]);

  useEffect(() => {
    const gen = ++loadGeneration.current;
    const audio = initAudio();
    const current = room?.current;

    if (!current) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      lastTrackKey.current = null;
      readyTrackKey.current = null;
      errorRetries.current = 0;
      setTrackLoading(false);
      setLrcDuration(null, null);
      setMediaDuration(null, null);
      return;
    }

    const trackKey = trackKeyOf(current);
    const needsLoad = readyTrackKey.current !== trackKey;

    const loadAndPlay = async () => {
      try {
        if (needsLoad) {
          audio.pause();
          audio.currentTime = 0;
          readyTrackKey.current = null;
          errorRetries.current = 0;
          lastTrackKey.current = trackKey;
          setTrackLoading(true);
          setLrcDuration(null, null);
          setMediaDuration(null, null);

          if (!current.duration) {
            getLyrics({
              id: current.id,
              source: current.source || 'netease',
              name: current.name,
              lrc: current.lrc,
            })
              .then((lrc) => {
                if (gen !== loadGeneration.current) return;
                const ms = getLrcFallbackDurationMs(lrc);
                if (ms) setLrcDuration(trackKey, ms);
              })
              .catch(() => {});
          }

          try {
            const url = await resolveSongUrl(current);
            if (gen !== loadGeneration.current) return;

            audio.pause();
            audio.src = url;
            await audio.load();
            if (gen !== loadGeneration.current) return;

            rememberSongUrl(trackKey, url);
            syncMediaDuration(audio, trackKey);
            readyTrackKey.current = trackKey;

            const liveQueue = useRoomStore.getState().room?.queue;
            if (liveQueue?.length) prefetchQueueSongs(liveQueue);
          } catch (err) {
            console.error('Failed to load song:', err);
            if (gen !== loadGeneration.current) return;
            readyTrackKey.current = null;
            requestSkip();
            return;
          }
        }

        if (gen !== loadGeneration.current) return;
        if (readyTrackKey.current !== trackKey) return;

        const liveRoom = useRoomStore.getState().room;
        if (!liveRoom?.current || trackKeyOf(liveRoom.current) !== trackKey) return;

        syncing.current = true;
        const startAt = Math.max(0, liveRoom.currentTime || 0);
        const dur = audio.duration;
        audio.currentTime = capSeekTime(startAt, liveRoom.current, dur);

        if (liveRoom.isPlaying) {
          const result = await playAudio(audio);
          if (result === 'played') {
            syncTime(audio.currentTime);
            lastSyncAt.current = Date.now();
            setNeedsAudioUnlock(false);
          } else if (result === 'blocked') {
            setNeedsAudioUnlock(true);
          }
        } else {
          audio.pause();
        }

        setTimeout(() => { syncing.current = false; }, 300);
      } finally {
        if (gen === loadGeneration.current) {
          setTrackLoading(false);
        }
      }
    };

    loadAndPlay();
  }, [
    room?.current?.id,
    room?.current?.queueId,
    room?.current?.source,
    initAudio,
    requestSkip,
    syncTime,
    setTrackLoading,
    setLrcDuration,
    setMediaDuration,
    setNeedsAudioUnlock,
    playAudio,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    const current = room?.current;
    if (!audio || !current) return;

    const trackKey = trackKeyOf(current);
    if (readyTrackKey.current !== trackKey) return;

    if (room.isPlaying && audio.paused) {
      playAudio(audio).then((result) => {
        if (result === 'played') {
          setNeedsAudioUnlock(false);
        } else if (result === 'blocked') {
          setNeedsAudioUnlock(true);
        }
      });
    } else if (!room.isPlaying && !audio.paused) {
      audio.pause();
    }
  }, [room?.isPlaying, room?.current?.queueId, room?.current?.id, room?.current?.source, setNeedsAudioUnlock, playAudio]);

  const handlePlayPause = useCallback(() => {
    if (!room) return;
    togglePlay(!room.isPlaying);
  }, [room, togglePlay]);

  const handleSeek = useCallback((time: number) => {
    const current = useRoomStore.getState().room?.current ?? null;
    seek(time);
    if (audioRef.current && readyTrackKey.current) {
      syncing.current = true;
      const dur = audioRef.current.duration;
      const target = capSeekTime(time, current, dur);
      audioRef.current.currentTime = target;
      syncTime(target);
      lastSyncAt.current = Date.now();
      setTimeout(() => { syncing.current = false; }, 300);
    }
  }, [seek, syncTime]);

  useEffect(() => {
    setSeekPlayback(handleSeek);
    return () => setSeekPlayback(null);
  }, [handleSeek, setSeekPlayback]);

  useEffect(() => {
    setRetryPlayback(retryPlayback);
    return () => setRetryPlayback(null);
  }, [retryPlayback, setRetryPlayback]);

  useEffect(() => {
    onWeChatBridgeReady(() => {
      retryPlayback();
    });
  }, [retryPlayback]);

  useEffect(() => {
    if (!tvMode || !needsAudioUnlock) return;

    const unlock = () => {
      useAudioStore.getState().retryPlayback?.(true);
    };

    document.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('click', unlock, { capture: true });
    document.addEventListener('touchstart', unlock, { capture: true, passive: true });

    return () => {
      document.removeEventListener('keydown', unlock, { capture: true });
      document.removeEventListener('click', unlock, { capture: true });
      document.removeEventListener('touchstart', unlock, { capture: true });
    };
  }, [tvMode, needsAudioUnlock]);

  useEffect(() => {
    const audio = audioRef.current;
    const current = room?.current;
    if (!audio || !current) return;

    const trackKey = trackKeyOf(current);
    if (readyTrackKey.current !== trackKey) return;

    const target = room.currentTime ?? 0;
    if (Math.abs(target - audio.currentTime) <= 2) return;

    syncing.current = true;
    const dur = audio.duration;
    audio.currentTime = capSeekTime(target, current, dur);
    setTimeout(() => { syncing.current = false; }, 300);
  }, [room?.currentTime, room?.current?.queueId, room?.current?.id, room?.current?.source]);

  useEffect(() => {
    const current = room?.current;
    const queue = room?.queue;
    if (!current || !queue?.length) return;
    if (readyTrackKey.current !== trackKeyOf(current)) return;
    prefetchQueueSongs(queue);
  }, [room?.queue, room?.current?.queueId, room?.current?.id, room?.current?.source]);

  useEffect(() => {
    return () => {
      loadGeneration.current += 1;
      lastTrackKey.current = null;
      readyTrackKey.current = null;
    };
  }, []);

  const handleSkip = useCallback(() => {
    readyTrackKey.current = null;
    requestSkip();
  }, [requestSkip]);

  return { handlePlayPause, handleSeek, handleSkip, audioRef };
}

