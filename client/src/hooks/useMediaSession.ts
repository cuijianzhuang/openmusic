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
  clearExternalAudioFocusLoss,
  installBackgroundPlaybackGuards,
  markExternalAudioFocusLoss,
  markUserMediaPauseIntent,
  shouldIgnoreBackgroundRoomPause,
} from '../lib/backgroundPlayback';
import { canPauseInRoom, canSeekInRoom } from '../lib/roomPermissions';
import { readRoomPureMode } from '../lib/roomPureMode';
import type { RoomState } from '../types';

const SEEK_STEP_SEC = 10;
/** Web Media Session 进度同步间隔 */
const WEB_POSITION_UPDATE_MS = 1000;
/**
 * Android 原生侧按 MediaSession speed 外推进度。
 * JS 仅在前台低频校正；后台禁止覆盖，否则进度条会「+1 又退回」。
 */
const NATIVE_POSITION_CORRECT_MS = 12000;
const NATIVE_SEEK_DETECT_SEC = 2;

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
    // 通知栏不展示「上一首」（原为回退 10s，易与真·上一曲混淆）
    prevBound: false,
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

    let nativeAnchorSec = 0;
    let nativeAnchorAtMs = 0;
    let nativeAnchorPlaying = false;

    const markNativeAnchor = (position: number, playing: boolean) => {
      nativeAnchorSec = position;
      nativeAnchorAtMs = performance.now();
      nativeAnchorPlaying = playing;
    };

    const expectedNativePosition = () => {
      if (!nativeAnchorPlaying) return nativeAnchorSec;
      return nativeAnchorSec + Math.max(0, (performance.now() - nativeAnchorAtMs) / 1000);
    };

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

    const handlePause = (fromUserControl = false) => {
      const { room, canControlPlayback } = useRoomStore.getState();
      if (!room?.current) return;
      if (!resolveSystemMediaControlFlags(room, canControlPlayback).playBound) return;
      const { localPlayback } = useAudioStore.getState();

      // 系统抢焦点的 pause 忽略；通知栏/锁屏用户点的暂停必须生效
      if (shouldIgnoreBackgroundRoomPause(fromUserControl) && room.isPlaying) {
        updateMediaSessionPlaybackState('playing');
        if (!document.hidden) {
          localPlayback?.(true);
        }
        void syncNativePlaybackState({ playing: true });
        return;
      }

      markUserMediaPauseIntent();
      updateMediaSessionPlaybackState('paused');
      localPlayback?.(false);
      void syncNativePlaybackState({
        playing: false,
        forcePosition: true,
      });
      void controlsRef.current.togglePlay(false);
    };

    const handleExternalAudioFocusLoss = () => {
      const { room, canControlPlayback } = useRoomStore.getState();
      if (!room?.current || !room.isPlaying) return;
      const flags = resolveSystemMediaControlFlags(room, canControlPlayback);

      markExternalAudioFocusLoss();
      markUserMediaPauseIntent();
      updateMediaSessionPlaybackState('paused');
      useAudioStore.getState().localPlayback?.(false);
      void syncNativePlaybackState({ playing: false, forcePosition: true });

      if (flags.playBound) {
        void controlsRef.current.togglePlay(false);
      }
    };

    const handleAudioFocusGain = () => {
      clearExternalAudioFocusLoss();
      const { room } = useRoomStore.getState();
      if (!room?.current || !room.isPlaying) return;
      // 无暂停权限时房间仍在播，焦点回来仅恢复本机音频
      useAudioStore.getState().retryPlayback?.(true);
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

    const handleSeekTo = (positionSec: number) => {
      const { room, canControlPlayback } = useRoomStore.getState();
      if (!canSeekInRoom(room, canControlPlayback)) return;
      if (!Number.isFinite(positionSec)) return;
      controlsRef.current.seekTo(Math.max(0, positionSec));
    };

    /**
     * @param forceNative 切歌/暂停/进后台锚点/显式 seek 时强制写原生进度
     */
    const syncPosition = (forceNative = false) => {
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
      const playing = Boolean(room?.isPlaying);

      if (webSessionOk) {
        updateMediaSessionPositionState({
          duration,
          position,
          playbackRate: 1,
        });
      }
      if (!nativeOk) return;

      // 后台播放：禁止用可能停滞的 JS 时间覆盖原生外推进度
      if (!forceNative && playing && document.hidden) return;

      const drift = Math.abs(position - expectedNativePosition());
      if (!forceNative && playing && drift < NATIVE_SEEK_DETECT_SEC) return;

      const shouldForce = forceNative || !playing || drift >= NATIVE_SEEK_DETECT_SEC;
      markNativeAnchor(position, playing);
      void syncNativePlaybackState({
        playing,
        durationSec: duration,
        positionSec: position,
        forcePosition: shouldForce,
      });
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
          pause: hasTrack && playBound ? () => handlePause(false) : undefined,
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
                handlePause(false);
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
      const position = Math.max(0, smoothPlaybackTime);
      const playing = Boolean(room?.isPlaying);
      markNativeAnchor(position, playing);

      // 先立刻同步按键权限（不等封面），避免无权限用户短暂看到可点按钮
      void syncNativePlaybackMetadata({
        hasTrack: true,
        title: pure ? '正在播放' : (current.name || '未知歌曲'),
        artist: pure ? '' : (current.artist || '未知歌手'),
        album: pure ? 'OpenMusic' : (current.album || 'OpenMusic'),
        playing,
        durationSec: duration > 0 ? duration : undefined,
        positionSec: position,
        playBound: flags.playBound,
        prevBound: flags.prevBound,
        nextBound: flags.nextBound,
      });

      void resolveMediaArtworkUrl(pure ? null : current).then((artworkUrl) => {
        const liveStore = useRoomStore.getState();
        const live = liveStore.room;
        if (live?.current?.queueId !== current.queueId) return;
        const liveFlags = resolveSystemMediaControlFlags(live, liveStore.canControlPlayback);
        const livePos = Math.max(0, useAudioStore.getState().smoothPlaybackTime);
        const livePlaying = Boolean(live?.isPlaying);
        markNativeAnchor(livePos, livePlaying);
        void syncNativePlaybackMetadata({
          hasTrack: true,
          title: pure ? '正在播放' : (current.name || '未知歌曲'),
          artist: pure ? '' : (current.artist || '未知歌手'),
          album: pure ? 'OpenMusic' : (current.album || 'OpenMusic'),
          artworkUrl: pure ? '' : artworkUrl,
          playing: livePlaying,
          durationSec: duration > 0 ? duration : undefined,
          positionSec: livePos,
          playBound: liveFlags.playBound,
          prevBound: liveFlags.prevBound,
          nextBound: liveFlags.nextBound,
        });
      });
    };

    syncHandlers();
    syncMetadataAndState();
    syncPosition(true);

    let removeNativeActions: (() => void) | undefined;
    if (nativeOk) {
      void subscribeNativeMediaActions((event) => {
        // 原生通知栏/耳机键一律视为用户操作
        const fromUser = true;
        if (event.action === 'play') handlePlay();
        else if (event.action === 'pause') handlePause(fromUser);
        else if (event.action === 'nexttrack') handleNext();
        else if (event.action === 'audiofocusloss') handleExternalAudioFocusLoss();
        else if (event.action === 'audiofocusgain') handleAudioFocusGain();
        else if (event.action === 'seekto' && typeof event.positionSec === 'number') {
          handleSeekTo(event.positionSec);
        }
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
        syncPosition(true);
      }
    });

    const unsubAudio = useAudioStore.subscribe((state, prev) => {
      if (
        state.mediaDurationMs !== prev.mediaDurationMs
        || state.lrcDurationMs !== prev.lrcDurationMs
      ) {
        syncPosition(true);
        syncMetadataAndState();
      }
    });

    const onVisibility = () => {
      // 进后台前打一次权威锚点，之后交给原生外推
      syncPosition(true);
    };
    document.addEventListener('visibilitychange', onVisibility);

    const webTimer = webSessionOk
      ? window.setInterval(() => syncPosition(false), WEB_POSITION_UPDATE_MS)
      : 0;
    const nativeTimer = nativeOk
      ? window.setInterval(() => {
          if (document.hidden) return;
          syncPosition(false);
        }, NATIVE_POSITION_CORRECT_MS)
      : 0;

    return () => {
      unsubRoom();
      unsubAudio();
      document.removeEventListener('visibilitychange', onVisibility);
      if (webTimer) window.clearInterval(webTimer);
      if (nativeTimer) window.clearInterval(nativeTimer);
      removeNativeActions?.();
      clearMediaSession();
      void clearNativePlaybackMedia();
    };
  }, [enabled]);
}
