import { useEffect, useRef } from 'react';
import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';
import {
  resolveDisplayDurationSeconds,
} from './useTrackDuration';
import {
  bindMediaSessionActions,
  clearMediaSession,
  isMediaSessionSupported,
  resolveMediaArtworkUrl,
  updateMediaSessionMetadata,
  updateMediaSessionPlaybackState,
  updateMediaSessionPositionState,
} from '../lib/mediaSession';
import {
  clearNativePlaybackMedia,
  isNativePlaybackMediaAvailable,
  subscribeNativeMediaActions,
  syncNativePlaybackMetadata,
  syncNativePlaybackState,
} from '../lib/nativePlaybackMedia';
import {
  installBackgroundPlaybackGuards,
  shouldIgnoreBackgroundRoomPause,
} from '../lib/backgroundPlayback';
import { canPauseInRoom, canSeekInRoom } from '../lib/roomPermissions';
import { readRoomPureMode } from '../lib/roomPureMode';
import type { RoomState } from '../types';

const SEEK_STEP_SEC = 10;
const POSITION_UPDATE_MS = 1000;

type MediaSessionControls = {
  /** false 时禁用（如 TV 投屏页不占用系统媒体会话） */
  enabled?: boolean;
  togglePlay: (isPlaying: boolean) => void | Promise<boolean>;
  skipSong: () => Promise<{ success: boolean; error?: string }>;
  requestSkip: () => Promise<{ success: boolean; error?: string }>;
  seekTo: (time: number) => void;
};

/** 系统媒体栏各按键是否可用：房间开关 ∩ 成员权限 */
function resolveSystemMediaControlFlags(
  room: RoomState | null | undefined,
  canControlPlayback: boolean,
): { playBound: boolean; prevBound: boolean; nextBound: boolean } {
  const systemPlay = room?.systemMediaPlayBound !== false;
  const systemSkip = room?.systemMediaSkipBound !== false;
  return {
    playBound: systemPlay && canPauseInRoom(room, canControlPlayback),
    prevBound: canSeekInRoom(room, canControlPlayback),
    nextBound: systemSkip && canControlPlayback,
  };
}

/**
 * 将房间播放/暂停/切歌同步到系统媒体控件（锁屏、通知栏、耳机键、键盘多媒体键）。
 * Android Capacitor 另同步原生 MediaStyle 切歌栏（WebView 无 Media Session API）。
 * 无对应权限时不注册/不展示按键。
 */
export function useMediaSession({
  enabled = true,
  togglePlay,
  skipSong,
  requestSkip,
  seekTo,
}: MediaSessionControls): void {
  const controlsRef = useRef({ togglePlay, skipSong, requestSkip, seekTo });
  controlsRef.current = { togglePlay, skipSong, requestSkip, seekTo };

  useEffect(() => {
    if (!enabled) {
      clearMediaSession();
      void clearNativePlaybackMedia();
      return;
    }

    const webSessionOk = isMediaSessionSupported();
    const nativeOk = isNativePlaybackMediaAvailable();
    if (!webSessionOk && !nativeOk) return;

    installBackgroundPlaybackGuards();

    const handlePlay = () => {
      const { room, canControlPlayback } = useRoomStore.getState();
      if (!room?.current) return;
      if (!resolveSystemMediaControlFlags(room, canControlPlayback).playBound) return;
      const { localPlayback } = useAudioStore.getState();
      if (!room.isPlaying) {
        updateMediaSessionPlaybackState('playing');
        void controlsRef.current.togglePlay(true);
        localPlayback?.(true);
      } else {
        localPlayback?.(true);
      }
    };

    const handlePause = () => {
      const { room, canControlPlayback } = useRoomStore.getState();
      if (!room?.current) return;
      if (!resolveSystemMediaControlFlags(room, canControlPlayback).playBound) return;
      const { localPlayback } = useAudioStore.getState();

      if (shouldIgnoreBackgroundRoomPause() && room.isPlaying) {
        updateMediaSessionPlaybackState('playing');
        if (!document.hidden) {
          localPlayback?.(true);
        }
        void syncNativePlaybackState({ playing: true });
        return;
      }

      updateMediaSessionPlaybackState('paused');
      localPlayback?.(false);
      void controlsRef.current.togglePlay(false);
    };

    const handleNext = () => {
      const { room, canControlPlayback } = useRoomStore.getState();
      if (!resolveSystemMediaControlFlags(room, canControlPlayback).nextBound) return;
      useAudioStore.getState().setTrackLoading(true);
      void controlsRef.current.skipSong().then((res) => {
        if (!res.success) useAudioStore.getState().setTrackLoading(false);
      });
    };

    const handlePrevious = () => {
      const { room, canControlPlayback } = useRoomStore.getState();
      if (!resolveSystemMediaControlFlags(room, canControlPlayback).prevBound) return;
      const time = useAudioStore.getState().smoothPlaybackTime;
      controlsRef.current.seekTo(Math.max(0, time - SEEK_STEP_SEC));
    };

    const syncPosition = () => {
      const room = useRoomStore.getState().room;
      const current = room?.current;
      if (!current) return;

      const { smoothPlaybackTime, mediaDurationMs, mediaTrackKey, lrcDurationMs, lrcTrackKey } = useAudioStore.getState();
      const duration = resolveDisplayDurationSeconds(current, {
        lrcDurationMs,
        lrcTrackKey,
        mediaDurationMs,
        mediaTrackKey,
      });
      if (!(duration > 0)) return;

      const position = Math.min(Math.max(0, smoothPlaybackTime), duration);
      if (webSessionOk) {
        updateMediaSessionPositionState({
          duration,
          position,
          playbackRate: 1,
        });
      }
      if (nativeOk) {
        void syncNativePlaybackState({
          playing: Boolean(room?.isPlaying),
          durationSec: duration,
          positionSec: position,
        });
      }
    };

    const syncHandlers = () => {
      const state = useRoomStore.getState();
      const canControl = state.canControlPlayback;
      const canSeek = canSeekInRoom(state.room, canControl);
      const hasTrack = Boolean(state.room?.current);
      const { playBound, prevBound, nextBound } = resolveSystemMediaControlFlags(state.room, canControl);

      if (webSessionOk) {
        bindMediaSessionActions({
          play: hasTrack && playBound ? handlePlay : undefined,
          pause: hasTrack && playBound ? handlePause : undefined,
          nexttrack: hasTrack && nextBound ? handleNext : undefined,
          previoustrack: hasTrack && prevBound ? handlePrevious : undefined,
          seekbackward: hasTrack && canSeek
            ? (details) => {
              const step = Number(details.seekOffset) > 0 ? Number(details.seekOffset) : SEEK_STEP_SEC;
              const time = useAudioStore.getState().smoothPlaybackTime;
              controlsRef.current.seekTo(Math.max(0, time - step));
            }
            : undefined,
          seekforward: hasTrack && canSeek
            ? (details) => {
              const step = Number(details.seekOffset) > 0 ? Number(details.seekOffset) : SEEK_STEP_SEC;
              const time = useAudioStore.getState().smoothPlaybackTime;
              controlsRef.current.seekTo(time + step);
            }
            : undefined,
          seekto: hasTrack && canSeek
            ? (details) => {
              if (typeof details.seekTime !== 'number' || !Number.isFinite(details.seekTime)) return;
              controlsRef.current.seekTo(Math.max(0, details.seekTime));
            }
            : undefined,
          stop: hasTrack && playBound
            ? () => {
                const room = useRoomStore.getState().room;
                if (shouldIgnoreBackgroundRoomPause() && room?.isPlaying) {
                  updateMediaSessionPlaybackState('playing');
                  if (!document.hidden) {
                    useAudioStore.getState().localPlayback?.(true);
                  }
                  void syncNativePlaybackState({ playing: true });
                  return;
                }
                useAudioStore.getState().localPlayback?.(false);
                void controlsRef.current.togglePlay(false);
              }
            : undefined,
        });
      }
    };

    const syncMetadataAndState = () => {
      const store = useRoomStore.getState();
      const room = store.room;
      const current = room?.current ?? null;
      const flags = resolveSystemMediaControlFlags(room, store.canControlPlayback);

      if (webSessionOk) {
        updateMediaSessionMetadata(current);
        if (!current) {
          updateMediaSessionPlaybackState('none');
        } else {
          updateMediaSessionPlaybackState(room?.isPlaying ? 'playing' : 'paused');
        }
      }

      if (!nativeOk) return;

      if (!current) {
        void clearNativePlaybackMedia();
        return;
      }

      const { smoothPlaybackTime, mediaDurationMs, mediaTrackKey, lrcDurationMs, lrcTrackKey } = useAudioStore.getState();
      const duration = resolveDisplayDurationSeconds(current, {
        lrcDurationMs,
        lrcTrackKey,
        mediaDurationMs,
        mediaTrackKey,
      });
      const pure = readRoomPureMode();

      // 先立刻同步按键权限（不等封面），避免无权限用户短暂看到可点按钮
      void syncNativePlaybackMetadata({
        hasTrack: true,
        title: pure ? '正在播放' : (current.name || '未知歌曲'),
        artist: pure ? '' : (current.artist || '未知歌手'),
        album: pure ? 'OpenMusic' : (current.album || 'OpenMusic'),
        playing: Boolean(room?.isPlaying),
        durationSec: duration > 0 ? duration : undefined,
        positionSec: Math.max(0, smoothPlaybackTime),
        playBound: flags.playBound,
        prevBound: flags.prevBound,
        nextBound: flags.nextBound,
      });

      void resolveMediaArtworkUrl(pure ? null : current).then((artworkUrl) => {
        const liveStore = useRoomStore.getState();
        const live = liveStore.room;
        if (live?.current?.queueId !== current.queueId) return;
        const liveFlags = resolveSystemMediaControlFlags(live, liveStore.canControlPlayback);
        void syncNativePlaybackMetadata({
          hasTrack: true,
          title: pure ? '正在播放' : (current.name || '未知歌曲'),
          artist: pure ? '' : (current.artist || '未知歌手'),
          album: pure ? 'OpenMusic' : (current.album || 'OpenMusic'),
          artworkUrl: pure ? '' : artworkUrl,
          playing: Boolean(live?.isPlaying),
          durationSec: duration > 0 ? duration : undefined,
          positionSec: Math.max(0, useAudioStore.getState().smoothPlaybackTime),
          playBound: liveFlags.playBound,
          prevBound: liveFlags.prevBound,
          nextBound: liveFlags.nextBound,
        });
      });
    };

    syncHandlers();
    syncMetadataAndState();
    syncPosition();

    let removeNativeActions: (() => void) | undefined;
    if (nativeOk) {
      void subscribeNativeMediaActions((action) => {
        if (action === 'play') handlePlay();
        else if (action === 'pause') handlePause();
        else if (action === 'nexttrack') handleNext();
        else if (action === 'previoustrack') handlePrevious();
      }).then((dispose) => {
        removeNativeActions = dispose;
      });
    }

    const unsubRoom = useRoomStore.subscribe((state, prev) => {
      if (
        state.room?.current?.queueId !== prev.room?.current?.queueId
        || state.room?.current?.name !== prev.room?.current?.name
        || state.room?.current?.artist !== prev.room?.current?.artist
        || state.room?.current?.pic !== prev.room?.current?.pic
        || state.room?.isPlaying !== prev.room?.isPlaying
        || state.canControlPlayback !== prev.canControlPlayback
        || state.room?.memberSeekEnabled !== prev.room?.memberSeekEnabled
        || state.room?.memberPauseEnabled !== prev.room?.memberPauseEnabled
        || state.room?.systemMediaPlayBound !== prev.room?.systemMediaPlayBound
        || state.room?.systemMediaSkipBound !== prev.room?.systemMediaSkipBound
        || Boolean(state.room?.current) !== Boolean(prev.room?.current)
      ) {
        syncHandlers();
        syncMetadataAndState();
        syncPosition();
      }
    });

    const unsubAudio = useAudioStore.subscribe((state, prev) => {
      if (
        state.mediaDurationMs !== prev.mediaDurationMs
        || state.lrcDurationMs !== prev.lrcDurationMs
      ) {
        syncPosition();
        syncMetadataAndState();
      }
    });

    const timer = window.setInterval(syncPosition, POSITION_UPDATE_MS);

    return () => {
      unsubRoom();
      unsubAudio();
      window.clearInterval(timer);
      removeNativeActions?.();
      clearMediaSession();
      void clearNativePlaybackMedia();
    };
  }, [enabled]);
}
