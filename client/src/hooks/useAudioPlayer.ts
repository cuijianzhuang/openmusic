import { useEffect, useRef, useCallback, useState, type MutableRefObject } from 'react';
import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';
import { useSocket } from '../hooks/useSocket';
import { useMediaSession } from '../hooks/useMediaSession';
import { getTrackKey } from '../api/music';
import { snapSmoothPlaybackTime } from '../hooks/useSmoothPlaybackTime';
import {
  isTrustedMediaDurationSeconds,
  resolveAutoSkipThresholdSeconds,
  resolveDisplayDurationSeconds,
  resolveReferenceDurationSeconds,
  resolveTrackDurationSeconds,
} from '../hooks/useTrackDuration';
import { reportTrackDurationToServer } from '../lib/reportTrackDuration';
import type { QueueItem } from '../types';
import { getAudioController } from '../lib/audioController';
import {
  onWeChatBridgeReady,
  playInUserGesture,
  tryPlayWithAutoplayFallback,
  assessPlaybackResult,
  playbackNeedsUnlock,
  isAudioSessionUnlocked,
  markAudioSessionUnlocked,
  resetAudioSessionUnlocked,
  shouldShowUnlockOverlay,
  shouldPromptAudioUnlock,
  isMobileDevice,
  isRestrictedAutoplayEnv,
  type PlayResult,
} from '../lib/audioUnlock';
import { sharedAudioGeneration } from '../lib/audioElement';
import { ensureGalaxyAudioOutput } from '../components/galaxy/lib/galaxyAudio';
import {
  prefetchUpcomingFromRoom,
  rememberSongUrl,
  resolveSongUrl,
  isTrackSourceError,
  fetchServiceFallbackUrl,
  invalidateUnloadedSongUrlCache,
} from '../lib/songPreloadCache';
import {
  classifyMediaPlaybackError,
  MAX_TEMP_PLAYBACK_RETRIES,
} from '../lib/audioPlaybackError';
import {
  recordSongPlaybackFailure,
  recordSongPlaybackSuccess,
} from '../lib/playbackQualityLock';
import { waitForAudioMinimumReady } from '../lib/audioReady';
import { applyFollowerSync, applyVisibilityResume, applyPostBufferSync, isEndedWhileServerPlaying } from '../lib/playbackSync';
import { getClientPlaybackState, optimisticSeekPosition } from '../lib/playbackState';
import { attachAudioBufferingListeners, isAudioBuffering, setAudioBufferEndHandler } from '../lib/audioBuffering';
import { flushPendingPlaybackSnapshot } from '../lib/playbackSchedule';
import { isSongPreviewSuppressingRoom, stopSongPreview } from '../lib/songPreviewPlayer';
import {
  bindAudioQueueId,
  clearAudioQueueBinding,
  canSyncAudioForQueue,
  isAudioBoundToQueue,
  shouldSkipTrackLoad,
} from '../lib/audioTrackBinding';

let audioListenersAttached = false;
let audioListenersTarget: HTMLAudioElement | null = null;

/** 播放中低频漂移校准（非 RAF，避免高频 seek） */
const CALIBRATION_INTERVAL_MS = 6000;
/** 音源脱节时重试 load 的最小间隔 */
const LOAD_WATCHDOG_INTERVAL_MS = 4000;

type LoadLock = {
  queueId: string | null;
  gen: number;
};

const EMPTY_LOAD_LOCK: LoadLock = { queueId: null, gen: 0 };

function releaseLoadLock(lockRef: { current: LoadLock }, queueId: string, gen: number): void {
  const lock = lockRef.current;
  if (lock.queueId === queueId && lock.gen === gen) {
    lockRef.current = EMPTY_LOAD_LOCK;
  }
}

interface AudioRuntime {
  audioRef: MutableRefObject<HTMLAudioElement | null>;
  endedTrackKey: MutableRefObject<string | null>;
  skippingRef: MutableRefObject<boolean>;
  tempRetries: MutableRefObject<number>;
  lowestFallbackAttempted: MutableRefObject<boolean>;
  successRecordedTrackKey: MutableRefObject<string | null>;
  stallRetryTimer: MutableRefObject<number | null>;
  requestSkip: () => void;
  finishSong: (queueId: string) => void;
  playAudio: (audio: HTMLAudioElement) => Promise<PlayResult>;
  applyPlaybackResult: (
    result: PlayResult,
    audio: HTMLAudioElement,
    liveRoom: NonNullable<ReturnType<typeof useRoomStore.getState>['room']>,
  ) => void;
}

let activeAudioRuntime: AudioRuntime | null = null;

const UNLOCK_POLL_MS = isMobileDevice() ? 120 : 800;

function trackKeyOf(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  return getTrackKey(song);
}

function durationSources() {
  const { lrcDurationMs, lrcTrackKey, mediaDurationMs, mediaTrackKey } = useAudioStore.getState();
  return { lrcDurationMs, lrcTrackKey, mediaDurationMs, mediaTrackKey };
}

function capSeekTime(time: number, song: QueueItem | null | undefined, mediaDur: number): number {
  const sources = durationSources();
  const referenceDur = song ? resolveReferenceDurationSeconds(song, sources) : 0;
  const fileDur = isTrustedMediaDurationSeconds(mediaDur, referenceDur) ? mediaDur : 0;
  const trackDur = song ? resolveTrackDurationSeconds(song, sources) : 0;
  const displayDur = song ? resolveDisplayDurationSeconds(song, sources) : fileDur;
  const capBase = fileDur || trackDur || (song ? resolveAutoSkipThresholdSeconds(song, sources, fileDur) : 0) || displayDur;
  const cap = capBase > 0 ? capBase - 0.05 : time;
  return Math.max(0, Math.min(time, cap));
}

function playbackStateMatchesCurrentTrack(song: QueueItem): boolean {
  const state = getClientPlaybackState();
  return !state?.trackId || state.trackId === song.queueId;
}

function tryFlushPendingSnapshot(): boolean {
  return flushPendingPlaybackSnapshot();
}

function syncMediaDuration(audio: HTMLAudioElement, song: QueueItem, trackKey: string) {
  const dur = audio.duration;
  const referenceDur = resolveReferenceDurationSeconds(song, durationSources());
  if (!isTrustedMediaDurationSeconds(dur, referenceDur)) return;
  const durationMs = Math.round(dur * 1000);
  useAudioStore.getState().setMediaDuration(trackKey, durationMs);
  reportTrackDurationToServer(song.queueId, durationMs);
}

interface UseAudioPlayerOptions {
  tvMode?: boolean;
}

export function useAudioPlayer(options: UseAudioPlayerOptions = {}) {
  const tvMode = options.tvMode ?? false;
  const controller = getAudioController();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const room = useRoomStore((s) => s.room);
  const isPlaybackLeader = useRoomStore((s) => s.isPlaybackLeader);
  const trackLoading = useAudioStore((s) => s.trackLoading);
  const setTrackLoading = useAudioStore((s) => s.setTrackLoading);
  const setLrcDuration = useAudioStore((s) => s.setLrcDuration);
  const setMediaDuration = useAudioStore((s) => s.setMediaDuration);
  const setSeekPlayback = useAudioStore((s) => s.setSeekPlayback);
  const setLocalPlayback = useAudioStore((s) => s.setLocalPlayback);
  const setNeedsAudioUnlock = useAudioStore((s) => s.setNeedsAudioUnlock);
  const needsAudioUnlock = useAudioStore((s) => s.needsAudioUnlock);
  const setRetryPlayback = useAudioStore((s) => s.setRetryPlayback);
  const playbackVersion = useAudioStore((s) => s.playbackVersion);
  const trackReloadNonce = useAudioStore((s) => s.trackReloadNonce);
  const { togglePlay, seek, skipSong, finishSong, requestSkip: requestSkipVote } = useSocket();

  const endedTrackKey = useRef<string | null>(null);
  const loadGeneration = useRef(0);
  const loadLockRef = useRef<LoadLock>(EMPTY_LOAD_LOCK);
  const lastTrackReloadNonceRef = useRef(0);
  const [loadRetryNonce, setLoadRetryNonce] = useState(0);
  const skippingRef = useRef(false);
  const justSkippedRef = useRef(false);
  const prevQueueIdRef = useRef<string | null>(null);
  const tempRetries = useRef(0);
  const lowestFallbackAttempted = useRef(false);
  const successRecordedTrackKey = useRef<string | null>(null);
  const stallRetryTimer = useRef<number | null>(null);
  const lastSkipAt = useRef(0);
  const wasLeaderRef = useRef(isPlaybackLeader);

  const shouldSkipForEndedTrackKey = useCallback((song: QueueItem, audio: HTMLAudioElement): boolean => {
    if (isEndedWhileServerPlaying(audio, song)) return false;
    return endedTrackKey.current === trackKeyOf(song);
  }, []);

  const handleBeyondDuration = useCallback((song: QueueItem) => {
    if (!useRoomStore.getState().isPlaybackLeader) return;
    finishSong(song.queueId);
  }, [finishSong]);

  const playAudio = useCallback(async (audio: HTMLAudioElement) => {
    if (isSongPreviewSuppressingRoom()) {
      if (!audio.paused) audio.pause();
      return 'played' as PlayResult;
    }
    const result = await tryPlayWithAutoplayFallback(audio, tvMode);
    return assessPlaybackResult(audio, result);
  }, [tvMode]);

  const applyPlaybackResult = useCallback((
    result: PlayResult,
    audio: HTMLAudioElement,
    liveRoom: NonNullable<typeof room>,
  ) => {
    if (isSongPreviewSuppressingRoom()) {
      if (!audio.paused) audio.pause();
      return;
    }
    const latestRoom = useRoomStore.getState().room;
    if (
      !latestRoom?.current
      || !liveRoom.current
      || trackKeyOf(latestRoom.current) !== trackKeyOf(liveRoom.current)
    ) {
      return;
    }

    if (playbackNeedsUnlock(result, audio)) {
      const stillLoading = useAudioStore.getState().trackLoading;
      if (!stillLoading && skippingRef.current) return;
      if (stillLoading && !isRestrictedAutoplayEnv()) return;
      if (stillLoading && !audio.src) return;

      if (isAudioSessionUnlocked()) {
        controller.enqueue(async () => {
          if (isSongPreviewSuppressingRoom()) {
            if (!audio.paused) audio.pause();
            return;
          }
          await audio.play().catch(() => {});
          if (audio.paused) {
            resetAudioSessionUnlocked();
            if (shouldShowUnlockOverlay()) {
              useAudioStore.getState().setNeedsAudioUnlock(true);
            }
          }
        });
        return;
      }
      if (shouldShowUnlockOverlay()) {
        setNeedsAudioUnlock(true);
      }
      return;
    }
    setNeedsAudioUnlock(false);
  }, [controller, setNeedsAudioUnlock]);

  const handleSyncResult = useCallback((
    result: Awaited<ReturnType<typeof applyFollowerSync>>,
    audio: HTMLAudioElement,
    liveRoom: NonNullable<typeof room>,
    song: QueueItem,
  ) => {
    if (result === 'beyond_duration') {
      handleBeyondDuration(song);
      return;
    }
    if (result === 'blocked' || result === 'error') {
      applyPlaybackResult(result, audio, liveRoom);
    } else if (result === 'played') {
      endedTrackKey.current = null;
      setNeedsAudioUnlock(false);
    }
  }, [applyPlaybackResult, handleBeyondDuration, setNeedsAudioUnlock]);

  const enqueuePause = useCallback(() => {
    controller.enqueue(() => {
      controller.audio.pause();
    });
  }, [controller]);

  const applySync = useCallback((
    options: { forceZero?: boolean; forceTime?: number; forceCorrection?: boolean } = {},
  ) => {
    controller.enqueue(async () => {
      // 试听占用本机时禁止跟播，否则会 play 主轨把试听挤掉
      if (isSongPreviewSuppressingRoom()) return;
      const liveRoom = useRoomStore.getState().room;
      if (!liveRoom?.current || skippingRef.current) return;
      const song = liveRoom.current;
      const audio = controller.audio;
      if (!isAudioBoundToQueue(audio, song.queueId)) return;
      if (shouldSkipForEndedTrackKey(song, audio)) return;
      if (!playbackStateMatchesCurrentTrack(song)) return;
      if (!audio.src) return;
      const result = await applyFollowerSync(audio, {
        song,
        capTime: (time, mediaDur) => capSeekTime(time, song, mediaDur),
        tvMode,
        forceZero: options.forceZero,
        forceTime: options.forceTime,
        forceCorrection: options.forceCorrection,
      });

      handleSyncResult(result, audio, liveRoom, song);
    });
  }, [controller, tvMode, shouldSkipForEndedTrackKey, handleSyncResult]);

  const applyVisibilitySync = useCallback(() => {
    controller.enqueue(async () => {
      if (isSongPreviewSuppressingRoom()) return;
      const liveRoom = useRoomStore.getState().room;
      if (!liveRoom?.current || skippingRef.current) return;
      const song = liveRoom.current;
      const audio = controller.audio;
      if (!isAudioBoundToQueue(audio, song.queueId)) return;
      if (shouldSkipForEndedTrackKey(song, audio)) return;
      if (!playbackStateMatchesCurrentTrack(song)) return;
      if (!audio.src) return;
      const result = await applyVisibilityResume(audio, {
        song,
        capTime: (time, mediaDur) => capSeekTime(time, song, mediaDur),
        tvMode,
      });

      handleSyncResult(result, audio, liveRoom, song);
    });
  }, [controller, tvMode, shouldSkipForEndedTrackKey, handleSyncResult]);

  const requestSkip = useCallback((options: { bypassThrottle?: boolean } = {}) => {
    if (skippingRef.current) return;
    const { isPlaybackLeader, room: live } = useRoomStore.getState();
    if (!isPlaybackLeader) return;

    const now = Date.now();
    if (!options.bypassThrottle && now - lastSkipAt.current < 2000) return;
    lastSkipAt.current = now;

    skippingRef.current = true;
    justSkippedRef.current = true;
    loadGeneration.current += 1;
    loadLockRef.current = EMPTY_LOAD_LOCK;
    useAudioStore.getState().setNeedsAudioUnlock(false);
    controller.clearQueue();
    controller.enqueue(() => {
      clearAudioQueueBinding(controller.audio);
      controller.audio.pause();
    });
    snapSmoothPlaybackTime(0);
    if (live) {
      useRoomStore.getState().setRoom({ ...live, currentTime: 0 });
    }
    skipSong().finally(() => {
      skippingRef.current = false;
    });
  }, [controller, skipSong]);

  const initAudio = useCallback(() => {
    const audio = controller.audio;
    audioRef.current = audio;
    activeAudioRuntime = {
      audioRef,
      endedTrackKey,
      skippingRef,
      tempRetries,
      lowestFallbackAttempted,
      successRecordedTrackKey,
      stallRetryTimer,
      requestSkip,
      finishSong,
      playAudio,
      applyPlaybackResult,
    };

    if (!audioListenersAttached || audioListenersTarget !== audio) {
      audioListenersAttached = true;
      audioListenersTarget = audio;
      attachAudioBufferingListeners(audio);

      audio.addEventListener('ended', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        const live = useRoomStore.getState();
        const current = live.room?.current;
        if (!current) return;
        if (!isAudioBoundToQueue(audio, current.queueId)) return;

        const pbState = getClientPlaybackState();
        const serverStillPlaying = pbState?.status === 'playing'
          && (!pbState.trackId || pbState.trackId === current.queueId);

        if (serverStillPlaying) {
          runtime.endedTrackKey.current = null;
        } else {
          runtime.endedTrackKey.current = trackKeyOf(current);
        }

        audio.pause();
        if (useRoomStore.getState().isPlaybackLeader) {
          runtime.finishSong(current.queueId);
        }
      });

      audio.addEventListener('error', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        const live = useRoomStore.getState();
        if (!live.room?.current || runtime.skippingRef.current) return;
        if (!isAudioBoundToQueue(audio, live.room.current.queueId)) return;

        const song = live.room.current;
        const isLeader = useRoomStore.getState().isPlaybackLeader;

        recordSongPlaybackFailure();

        void classifyMediaPlaybackError(audio).then((errorClass) => {
          if (errorClass === 'temporary') {
            if (runtime.tempRetries.current < MAX_TEMP_PLAYBACK_RETRIES) {
              runtime.tempRetries.current += 1;
              controller.enqueue(async () => {
                const a = controller.audio;
                a.load();
                await a.play().catch(() => {});
              });
              return;
            }
            if (isLeader) runtime.requestSkip();
            return;
          }

          if (runtime.lowestFallbackAttempted.current) {
            if (isLeader) runtime.requestSkip();
            return;
          }

          runtime.lowestFallbackAttempted.current = true;
          void fetchServiceFallbackUrl(song).then((fallbackUrl) => {
            if (fallbackUrl) {
              runtime.tempRetries.current = 0;
              controller.enqueue(async () => {
                const a = controller.audio;
                a.pause();
                a.currentTime = 0;
                a.src = fallbackUrl;
                bindAudioQueueId(a, song.queueId);
                a.load();
                await a.play().catch(() => {});
              });
              return;
            }
            if (isLeader) runtime.requestSkip();
          });
        });
      });

      audio.addEventListener('stalled', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        const live = useRoomStore.getState();
        if (!live.room?.current || runtime.skippingRef.current) return;
        if (!isAudioBoundToQueue(audio, live.room.current.queueId)) return;
        if (audio.paused || audio.ended) return;
        if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
        if (runtime.stallRetryTimer.current) return;

        runtime.stallRetryTimer.current = window.setTimeout(() => {
          runtime.stallRetryTimer.current = null;
          if (audio.paused || audio.ended) return;
          if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
          if (runtime.tempRetries.current >= MAX_TEMP_PLAYBACK_RETRIES) return;

          runtime.tempRetries.current += 1;
          controller.enqueue(async () => {
            const a = controller.audio;
            a.load();
            await a.play().catch(() => {});
          });
        }, 2500);
      });

      audio.addEventListener('playing', () => {
        const runtime = activeAudioRuntime;
        if (runtime) {
          runtime.tempRetries.current = 0;
          if (runtime.stallRetryTimer.current) {
            window.clearTimeout(runtime.stallRetryTimer.current);
            runtime.stallRetryTimer.current = null;
          }

          const live = useRoomStore.getState().room?.current;
          if (live) {
            const trackKey = trackKeyOf(live);
            if (runtime.successRecordedTrackKey.current !== trackKey) {
              runtime.successRecordedTrackKey.current = trackKey;
              const recovered = recordSongPlaybackSuccess();
              if (recovered) {
                invalidateUnloadedSongUrlCache(trackKey);
              }
            }
          }
        }
        ensureGalaxyAudioOutput();
        markAudioSessionUnlocked();
        useAudioStore.getState().setNeedsAudioUnlock(false);
        const live = useRoomStore.getState().room;
        if (live?.queue.length || live?.nextRandom) {
          prefetchUpcomingFromRoom(live);
        }
      });

      audio.addEventListener('loadedmetadata', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        const live = useRoomStore.getState().room?.current;
        if (!live || !isAudioBoundToQueue(audio, live.queueId)) return;
        syncMediaDuration(audio, live, trackKeyOf(live));
        tryFlushPendingSnapshot();
      });

      audio.addEventListener('loadeddata', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        const live = useRoomStore.getState().room?.current;
        if (!live || !isAudioBoundToQueue(audio, live.queueId)) return;
        syncMediaDuration(audio, live, trackKeyOf(live));
        tryFlushPendingSnapshot();
      });

      audio.addEventListener('durationchange', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        const live = useRoomStore.getState().room?.current;
        if (!live || !isAudioBoundToQueue(audio, live.queueId)) return;
        syncMediaDuration(audio, live, trackKeyOf(live));
      });
    }

    return audio;
  }, [controller, requestSkip, finishSong, playAudio, applyPlaybackResult]);

  const retryPlayback = useCallback(async (fromUserGesture = false) => {
    const liveRoom = useRoomStore.getState().room;
    if (!liveRoom?.current) return;

    if (!liveRoom.isPlaying && !fromUserGesture) {
      setNeedsAudioUnlock(false);
      return;
    }

    // 用户主动恢复房间播放时结束试听；静默跟播则继续让路给试听
    if (isSongPreviewSuppressingRoom()) {
      if (!fromUserGesture) return;
      stopSongPreview({ resumeRoom: false });
    }

    if (fromUserGesture) {
      markAudioSessionUnlocked();
      setNeedsAudioUnlock(false);
      tryFlushPendingSnapshot();
      if (controller.audio.src) playInUserGesture(controller.audio);
    }

    if (!canSyncAudioForQueue(controller.audio, liveRoom.current.queueId)) return;

    // 解锁/补播：必须先对齐服务端进度，routine 同步 mid-track 不会 seek
    applySync({ forceCorrection: true });
  }, [controller, applySync, setNeedsAudioUnlock]);

  useEffect(() => {
    if (!room?.current) return;
    if (shouldPromptAudioUnlock(Boolean(room.isPlaying))) {
      setNeedsAudioUnlock(true);
    }
  }, [room?.current?.queueId, room?.current?.id, room?.current?.source, room?.isPlaying, setNeedsAudioUnlock]);

  // Layer 1：初始化 — 仅 track 变化时 load，所有音频写操作走队列
  useEffect(() => {
    initAudio();
    const current = room?.current;

    if (!current) {
      loadGeneration.current += 1;
      loadLockRef.current = EMPTY_LOAD_LOCK;
      controller.enqueue(() => {
        const audio = controller.audio;
        audio.pause();
        clearAudioQueueBinding(audio);
        audio.removeAttribute('src');
        audio.load();
      });
      endedTrackKey.current = null;
      prevQueueIdRef.current = null;
      tempRetries.current = 0;
      setTrackLoading(false);
      setLrcDuration(null, null);
      setMediaDuration(null, null);
      return;
    }

    const trackKey = trackKeyOf(current);

    if (trackReloadNonce !== lastTrackReloadNonceRef.current) {
      lastTrackReloadNonceRef.current = trackReloadNonce;
      clearAudioQueueBinding(controller.audio);
      loadLockRef.current = EMPTY_LOAD_LOCK;
    }

    if (prevQueueIdRef.current && prevQueueIdRef.current !== current.queueId) {
      loadGeneration.current += 1;
      loadLockRef.current = EMPTY_LOAD_LOCK;
      justSkippedRef.current = true;
      endedTrackKey.current = null;
      enqueuePause();
      snapSmoothPlaybackTime(0);
    }
    prevQueueIdRef.current = current.queueId;
    if (endedTrackKey.current && endedTrackKey.current !== trackKey) {
      endedTrackKey.current = null;
    }

    if (shouldSkipTrackLoad(controller.audio, current.queueId)) {
      return;
    }

    if (loadLockRef.current.queueId === current.queueId) {
      return;
    }

    if (isTrackSourceError(current)) {
      setTrackLoading(false);
      if (useRoomStore.getState().isPlaybackLeader) {
        requestSkip({ bypassThrottle: true });
      }
      return;
    }

    const gen = ++loadGeneration.current;
    const queueId = current.queueId;

    const loadTrack = async () => {
      loadLockRef.current = { queueId, gen };
      tempRetries.current = 0;
      lowestFallbackAttempted.current = false;
      successRecordedTrackKey.current = null;
      setTrackLoading(true);

      try {
        const liveBeforeLoad = useRoomStore.getState().room;
        if (!shouldPromptAudioUnlock(Boolean(liveBeforeLoad?.isPlaying))) {
          setNeedsAudioUnlock(false);
        } else {
          setNeedsAudioUnlock(true);
        }
        setLrcDuration(null, null);
        setMediaDuration(null, null);

        let url: string;
        try {
          url = await resolveSongUrl(current);
        } catch (err) {
          console.error('Failed to load song:', err);
          if (gen !== loadGeneration.current) return;
          clearAudioQueueBinding(controller.audio);
          if (useRoomStore.getState().isPlaybackLeader) {
            requestSkip();
          }
          return;
        }

        if (gen !== loadGeneration.current) return;

        await controller.exec(async () => {
          if (gen !== loadGeneration.current) return;
          const audio = controller.audio;
          const liveNow = useRoomStore.getState().room?.current;
          if (!liveNow || liveNow.queueId !== current.queueId) return;
          audio.pause();
          clearAudioQueueBinding(audio);
          audio.currentTime = 0;
          snapSmoothPlaybackTime(0);
          audio.src = url;
          bindAudioQueueId(audio, current.queueId);
          audio.load();
        });

        if (gen !== loadGeneration.current) return;

        const liveAfterSrc = useRoomStore.getState().room;
        if (
          isRestrictedAutoplayEnv()
          && liveAfterSrc?.isPlaying
          && liveAfterSrc.current
          && trackKeyOf(liveAfterSrc.current) === trackKey
        ) {
          await controller.exec(async () => {
            if (gen !== loadGeneration.current) return;
            const audio = controller.audio;
            const earlyProbe = await playAudio(audio);
            if (!playbackNeedsUnlock(earlyProbe, audio)) {
              audio.pause();
            }
            if (playbackNeedsUnlock(earlyProbe, audio) && liveAfterSrc) {
              applyPlaybackResult(earlyProbe, audio, liveAfterSrc);
            }
          });
        }

        await waitForAudioMinimumReady(controller.audio);
        if (gen !== loadGeneration.current) return;

        rememberSongUrl(trackKey, url);
        syncMediaDuration(controller.audio, current, trackKey);
        tryFlushPendingSnapshot();

        const liveAfterLoad = useRoomStore.getState().room;
        if (
          isRestrictedAutoplayEnv()
          && liveAfterLoad?.isPlaying
          && liveAfterLoad.current
          && trackKeyOf(liveAfterLoad.current) === trackKey
          && !useAudioStore.getState().needsAudioUnlock
        ) {
          await controller.exec(async () => {
            if (gen !== loadGeneration.current) return;
            const audio = controller.audio;
            const probe = await playAudio(audio);
            if (!playbackNeedsUnlock(probe, audio)) {
              audio.pause();
            }
            if (playbackNeedsUnlock(probe, audio) && liveAfterLoad) {
              applyPlaybackResult(probe, audio, liveAfterLoad);
            }
          });
        }

        const liveRoom = useRoomStore.getState().room;
        if (liveRoom) prefetchUpcomingFromRoom(liveRoom);
      } catch (err) {
        console.error('Failed to load song:', err);
        if (gen !== loadGeneration.current) return;
        clearAudioQueueBinding(controller.audio);
        if (useRoomStore.getState().isPlaybackLeader) {
          requestSkip();
        }
      } finally {
        releaseLoadLock(loadLockRef, queueId, gen);
        if (gen === loadGeneration.current) {
          setTrackLoading(false);
          const live = useRoomStore.getState().room;
          if (
            live?.isPlaying
            && live.current
            && live.current.queueId === queueId
            && trackKeyOf(live.current) === trackKey
            && canSyncAudioForQueue(controller.audio, live.current.queueId)
          ) {
            const forceZero = justSkippedRef.current;
            justSkippedRef.current = false;
            applySync(forceZero ? { forceZero: true } : { forceCorrection: true });
          }
        }
      }
    };

    void loadTrack();
  }, [
    room?.current?.id,
    room?.current?.queueId,
    room?.current?.source,
    loadRetryNonce,
    trackReloadNonce,
    sharedAudioGeneration,
    tvMode,
    initAudio,
    controller,
    requestSkip,
    enqueuePause,
    applySync,
    setTrackLoading,
    setLrcDuration,
    setMediaDuration,
    setNeedsAudioUnlock,
    playAudio,
    applyPlaybackResult,
  ]);

  // room.current 与 audio.src 脱节时重试 load（受 loadLock 约束，避免重复 reload 风暴）
  useEffect(() => {
    const id = window.setInterval(() => {
      const liveRoom = useRoomStore.getState().room;
      const current = liveRoom?.current;
      if (!current) return;
      const audio = controller.audio;
      if (shouldSkipTrackLoad(audio, current.queueId)) return;
      if (loadLockRef.current.queueId) return;
      if (useAudioStore.getState().trackLoading) return;
      setLoadRetryNonce((n) => n + 1);
    }, LOAD_WATCHDOG_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [controller]);

  // 服务端 PlaybackState（150ms 防抖后）→ 统一同步
  useEffect(() => {
    if (trackLoading) return;
    if (isSongPreviewSuppressingRoom()) return;
    const liveRoom = useRoomStore.getState().room;
    if (!liveRoom?.current) return;
    if (!canSyncAudioForQueue(controller.audio, liveRoom.current.queueId)) return;
    if (!playbackStateMatchesCurrentTrack(liveRoom.current)) return;
    if (skippingRef.current) return;

    const forceZero = justSkippedRef.current;
    justSkippedRef.current = false;
    if (!forceZero && shouldSkipForEndedTrackKey(liveRoom.current, controller.audio)) return;

    applySync(forceZero ? { forceZero: true } : { forceCorrection: true });
  }, [playbackVersion, trackLoading, applySync, shouldSkipForEndedTrackKey, controller]);

  // 离散同步：NORMAL 不追赶，FINAL（≤3s）一次性对齐；6s 仅检查是否进入 FINAL
  useEffect(() => {
    if (tvMode) return;

    const id = window.setInterval(() => {
      if (document.hidden) return;
      if (isSongPreviewSuppressingRoom()) return;
      const liveRoom = useRoomStore.getState().room;
      if (!liveRoom?.current || !liveRoom.isPlaying) return;
      if (skippingRef.current || controller.isRunning) return;
      if (useAudioStore.getState().trackLoading) return;
      if (isAudioBuffering(controller.audio)) return;
      if (!canSyncAudioForQueue(controller.audio, liveRoom.current.queueId)) return;
      if (!playbackStateMatchesCurrentTrack(liveRoom.current)) return;
      if (shouldSkipForEndedTrackKey(liveRoom.current, controller.audio)) return;
      if (!controller.audio.src) return;
      applySync();
    }, CALIBRATION_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [tvMode, controller, applySync, shouldSkipForEndedTrackKey, room?.isPlaying, room?.current?.queueId]);

  useEffect(() => {
    setAudioBufferEndHandler((audio) => {
      if (isSongPreviewSuppressingRoom()) return;
      const liveRoom = useRoomStore.getState().room;
      if (!liveRoom?.current || skippingRef.current) return;
      if (!canSyncAudioForQueue(controller.audio, liveRoom.current.queueId)) return;
      if (!playbackStateMatchesCurrentTrack(liveRoom.current)) return;
      if (useAudioStore.getState().trackLoading) return;

      const song = liveRoom.current;
      controller.enqueue(async () => {
        if (isSongPreviewSuppressingRoom()) return;
        await applyPostBufferSync(audio, {
          song,
          capTime: (time, mediaDur) => capSeekTime(time, song, mediaDur),
          tvMode,
        });
      });
    });
    return () => setAudioBufferEndHandler(null);
  }, [controller, tvMode]);

  // 刚成为播放主控：对齐服务端时间轴
  useEffect(() => {
    const becameLeader = isPlaybackLeader && !wasLeaderRef.current;
    wasLeaderRef.current = isPlaybackLeader;
    if (!becameLeader || tvMode || trackLoading) return;

    const current = room?.current;
    if (!current) return;
    if (!canSyncAudioForQueue(controller.audio, current.queueId)) return;

    applySync();
  }, [isPlaybackLeader, tvMode, room?.current?.queueId, trackLoading, applySync, controller]);

  // visibilitychange：切走时不做任何事；切回时仅软恢复（浏览器暂停了才 play）
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) return;
      if (isSongPreviewSuppressingRoom()) return;

      const liveRoom = useRoomStore.getState().room;
      if (!liveRoom?.current) return;
      if (!canSyncAudioForQueue(controller.audio, liveRoom.current.queueId)) return;
      if (!playbackStateMatchesCurrentTrack(liveRoom.current)) return;
      if (shouldSkipForEndedTrackKey(liveRoom.current, controller.audio)) return;
      if (useAudioStore.getState().trackLoading || skippingRef.current) return;
      if (!controller.audio.src) return;

      applyVisibilitySync();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [controller, applyVisibilitySync, shouldSkipForEndedTrackKey]);

  const handlePlayPause = useCallback(() => {
    if (!room) return;
    togglePlay(!room.isPlaying);
  }, [room, togglePlay]);

  const handleLocalPlayback = useCallback((isPlaying: boolean) => {
    const live = useRoomStore.getState().room;
    const audio = controller.audio;
    if (!isPlaying) {
      audio.pause();
      if (live) useRoomStore.getState().setRoom({ ...live, isPlaying: false });
      return;
    }
    useAudioStore.getState().retryPlayback?.(true);
  }, [controller]);

  const handleSeek = useCallback((time: number) => {
    const live = useRoomStore.getState().room;
    const current = live?.current;
    if (!live || !current) return;

    const capped = capSeekTime(time, current, controller.audio.duration);
    endedTrackKey.current = null;
    const optimistic = optimisticSeekPosition(live.id, current.queueId, capped, live.isPlaying);
    useAudioStore.getState().setPlaybackVersion(optimistic.version);
    snapSmoothPlaybackTime(capped);
    useRoomStore.getState().setRoom({ ...live, currentTime: capped });

    if (canSyncAudioForQueue(controller.audio, current.queueId)) {
      controller.audio.currentTime = capped;
      applySync({ forceTime: capped });
    }
    seek(capped);
  }, [controller, seek, applySync]);

  useMediaSession({
    enabled: !tvMode,
    togglePlay,
    skipSong,
    requestSkip: requestSkipVote,
    seekTo: handleSeek,
  });

  useEffect(() => {
    setSeekPlayback(handleSeek);
    return () => setSeekPlayback(null);
  }, [handleSeek, setSeekPlayback]);

  useEffect(() => {
    setLocalPlayback(handleLocalPlayback);
    return () => setLocalPlayback(null);
  }, [handleLocalPlayback, setLocalPlayback]);

  useEffect(() => {
    setRetryPlayback(retryPlayback);
    return () => setRetryPlayback(null);
  }, [retryPlayback, setRetryPlayback]);

  useEffect(() => {
    onWeChatBridgeReady(() => {
      const liveRoom = useRoomStore.getState().room;
      if (isSongPreviewSuppressingRoom()) return;
      if (!controller.audio.src || !liveRoom?.current || !liveRoom.isPlaying) return;
      if (!playbackStateMatchesCurrentTrack(liveRoom.current)) return;
      if (useAudioStore.getState().trackLoading || skippingRef.current) return;
      applySync();
    });
  }, [applySync]);

  useEffect(() => {
    if (!needsAudioUnlock || !shouldShowUnlockOverlay()) return;
    if (!tvMode) return;

    const unlock = () => {
      markAudioSessionUnlocked();
      useAudioStore.getState().setNeedsAudioUnlock(false);
      useAudioStore.getState().retryPlayback?.(true);
    };

    document.addEventListener('keydown', unlock, { capture: true });
    return () => document.removeEventListener('keydown', unlock, { capture: true });
  }, [tvMode, needsAudioUnlock]);

  useEffect(() => {
    const check = () => {
      if (document.hidden) return;
      if (isSongPreviewSuppressingRoom()) return;
      const liveRoom = useRoomStore.getState().room;
      if (!liveRoom?.current || !liveRoom.isPlaying) return;
      const loading = useAudioStore.getState().trackLoading;
      if (loading && (!isRestrictedAutoplayEnv() || !controller.audio.src)) return;
      if (skippingRef.current || controller.isRunning) return;
      if (!controller.audio.src || !controller.audio.paused) return;
      if (!canSyncAudioForQueue(controller.audio, liveRoom.current.queueId)) return;
      if (!playbackStateMatchesCurrentTrack(liveRoom.current)) return;
      if (shouldSkipForEndedTrackKey(liveRoom.current, controller.audio)) return;

      tryFlushPendingSnapshot();
      // 等待解锁期间也要把暂停的 audio 对齐到服务端，点击后不会从旧进度开播
      applySync({ forceCorrection: true });
    };

    const id = window.setInterval(check, UNLOCK_POLL_MS);
    return () => window.clearInterval(id);
  }, [controller, room?.current?.queueId, room?.isPlaying, applySync, shouldSkipForEndedTrackKey]);

  useEffect(() => {
    const roomState = useRoomStore.getState().room;
    if (!roomState?.current) return;
    if (!canSyncAudioForQueue(controller.audio, roomState.current.queueId)) return;
    prefetchUpcomingFromRoom(roomState);
  }, [room?.queue, room?.nextRandom?.queueId, room?.nextRandom?.id, room?.current?.queueId, room?.current?.id, room?.current?.source]);

  useEffect(() => {
    return () => {
      loadGeneration.current += 1;
      loadLockRef.current = EMPTY_LOAD_LOCK;
      if (activeAudioRuntime?.audioRef === audioRef) {
        activeAudioRuntime = null;
      }
    };
  }, []);

  const handleSkip = useCallback(() => {
    requestSkip();
  }, [requestSkip]);

  return { handlePlayPause, handleSeek, handleSkip, audioRef };
}
