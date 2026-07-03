import { getCoverUrl } from '../api/music';
import type { QueueItem } from '../types';
import {
  isTrustedMediaDurationSeconds,
  resolveAutoSkipThresholdSeconds,
  resolveDisplayDurationSeconds,
  resolveReferenceDurationSeconds,
  resolveTrackDurationSeconds,
} from '../hooks/useTrackDuration';
import { getSharedAudio } from './audioElement';
import { isAudioBoundToQueue } from './audioTrackBinding';
import { waitForAudioMinimumReady } from './audioReady';
import { isProxiedMediaUrl, isSameOriginMediaUrl } from './mediaProxyUrl';
import { flushPendingPlaybackSnapshot } from './playbackSchedule';
import { applyFollowerSync } from './playbackSync';
import { getClientPlaybackState, getPlaybackTime } from './playbackState';
import { invalidateTrackUrlCache, resolveSongUrl } from './songPreloadCache';
import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';

const TRACK_READY_POLL_MS = 50;
const TRACK_READY_TIMEOUT_MS = 20000;

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

export function preloadGalaxyBackground(): Promise<unknown> {
  return import('../components/galaxy/GalaxyBackground3D');
}

async function waitForCurrentTrackProxyReady(
  song: QueueItem,
  timeoutMs = TRACK_READY_TIMEOUT_MS,
): Promise<void> {
  const audio = getSharedAudio();
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const loading = useAudioStore.getState().trackLoading;
    const src = audio.currentSrc || audio.src || '';
    const bound = isAudioBoundToQueue(audio, song.queueId);
    const proxied = Boolean(src && (isProxiedMediaUrl(src) || isSameOriginMediaUrl(src)));

    if (!loading && bound && proxied && audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, TRACK_READY_POLL_MS));
  }

  throw new Error('immersive track proxy timeout');
}

function capSeekTime(time: number, song: QueueItem, mediaDur: number): number {
  const audioStore = useAudioStore.getState();
  const sources = {
    lrcDurationMs: audioStore.lrcDurationMs,
    lrcTrackKey: audioStore.lrcTrackKey,
    mediaDurationMs: audioStore.mediaDurationMs,
    mediaTrackKey: audioStore.mediaTrackKey,
  };
  const referenceDur = resolveReferenceDurationSeconds(song, sources);
  const fileDur = isTrustedMediaDurationSeconds(mediaDur, referenceDur) ? mediaDur : 0;
  const trackDur = resolveTrackDurationSeconds(song, sources);
  const displayDur = resolveDisplayDurationSeconds(song, sources);
  const capBase = fileDur || trackDur || resolveAutoSkipThresholdSeconds(song, sources, fileDur) || displayDur;
  const cap = capBase > 0 ? capBase - 0.05 : time;
  return Math.max(0, Math.min(time, cap));
}

/** 代理音源就绪后，将播放进度对齐到房间当前进度 */
async function syncRoomPlaybackAfterProxyReload(song: QueueItem): Promise<void> {
  const audio = getSharedAudio();
  if (!audio.src || !isAudioBoundToQueue(audio, song.queueId)) return;

  flushPendingPlaybackSnapshot();

  const liveRoom = useRoomStore.getState().room;
  if (!liveRoom?.current || liveRoom.current.queueId !== song.queueId) return;

  const playbackState = getClientPlaybackState();
  let targetTime = Math.max(0, Number(liveRoom.currentTime) || 0);
  if (playbackState?.trackId === song.queueId) {
    targetTime = getPlaybackTime(playbackState);
  }

  await applyFollowerSync(audio, {
    song,
    capTime: (time, mediaDur) => capSeekTime(time, song, mediaDur),
    forceTime: targetTime,
  });
}

export interface PrepareImmersiveEnterOptions {
  song: QueueItem | null;
  needsProxyReload: boolean;
}

/** 进入沉浸模式前预加载 Galaxy chunk、封面与（如需）代理音源 */
export async function prepareImmersiveEnter(options: PrepareImmersiveEnterOptions): Promise<void> {
  const { song, needsProxyReload } = options;
  const coverUrl = song ? getCoverUrl(song, 'medium') : null;

  const tasks: Promise<unknown>[] = [preloadGalaxyBackground()];

  if (coverUrl) {
    tasks.push(preloadImage(coverUrl));
  }

  if (needsProxyReload && song) {
    invalidateTrackUrlCache(song);
    tasks.push((async () => {
      useAudioStore.getState().requestTrackReload();
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      });
      await resolveSongUrl(song, { refresh: true });
      await waitForCurrentTrackProxyReady(song);
      await waitForAudioMinimumReady(getSharedAudio());
      await syncRoomPlaybackAfterProxyReload(song);
    })());
  }

  await Promise.all(tasks);
}
