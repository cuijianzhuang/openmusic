import type { QueueItem } from '../types';
import { snapSmoothPlaybackTime } from '../hooks/useSmoothPlaybackTime';
import { resolveTrackDurationSeconds } from '../hooks/useTrackDuration';
import { useAudioStore } from '../stores/audioStore';
import { getClientPlaybackState, getPlaybackTime } from './playbackState';
import { isAudioBuffering } from './audioBuffering';
import { shouldSkipRoutineSync as shouldSkipByBufferingState } from './syncStateMachine';
import { resetDriftController } from './driftController';
import {
  assessPlaybackResult,
  tryPlayWithAutoplayFallback,
  type PlayResult,
} from './audioUnlock';

/**
 * 离散事件同步（非连续 drift 控制）：
 * - NORMAL（距结束 >3s）：不追赶，避免听感扰动
 * - FINAL（距结束 ≤3s）：playbackRate=1，diff>0 时仅一次性 seek 提前对齐
 */
const FINAL_WINDOW_SEC = 3;

let finalSyncTrackId: string | null = null;
let finalSyncDone = false;

function durationSources() {
  const { lrcDurationMs, lrcTrackKey, mediaDurationMs, mediaTrackKey } = useAudioStore.getState();
  return { lrcDurationMs, lrcTrackKey, mediaDurationMs, mediaTrackKey };
}

function isExplicitForce(options: ApplySyncOptions): boolean {
  return options.forceZero === true || options.forceTime !== undefined;
}

export interface ApplySyncOptions {
  song: QueueItem;
  capTime: (time: number, mediaDur: number) => number;
  tvMode?: boolean;
  forceTime?: number;
  forceZero?: boolean;
  /** 服务端 playback_state 更新；NORMAL 段不追赶，FINAL 段走收尾规则 */
  forceCorrection?: boolean;
}

function resolveTargetTime(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): number {
  const mediaDur = audio.duration;
  if (options.forceZero) return options.capTime(0, mediaDur);
  if (options.forceTime !== undefined) return options.capTime(options.forceTime, mediaDur);
  const state = getClientPlaybackState();
  const t = state ? getPlaybackTime(state) : 0;
  return options.capTime(Math.max(0, t), mediaDur);
}

function getRemainingTimeSec(song: QueueItem, positionSec: number): number {
  const durationSec = resolveTrackDurationSeconds(song, durationSources());
  if (durationSec <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, durationSec - positionSec);
}

function ensureFinalSyncTrack(trackId: string): void {
  if (finalSyncTrackId !== trackId) {
    finalSyncTrackId = trackId;
    finalSyncDone = false;
  }
}

function lockPlaybackRate(audio: HTMLAudioElement): void {
  resetDriftController(audio);
}

function explicitHardSeek(audio: HTMLAudioElement, target: number): void {
  lockPlaybackRate(audio);
  audio.currentTime = target;
  snapSmoothPlaybackTime(target);
}

function shouldSkipRoutineSync(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): boolean {
  if (isExplicitForce(options)) return false;
  if (shouldSkipByBufferingState(false)) return true;
  return isAudioBuffering(audio);
}

/** NORMAL / FINAL 离散追赶（不含 seek/切歌等显式 force） */
function applyDiscretePhaseSync(
  audio: HTMLAudioElement,
  target: number,
  options: ApplySyncOptions,
): 'played' {
  lockPlaybackRate(audio);

  const trackId = getClientPlaybackState()?.trackId || options.song.queueId;
  ensureFinalSyncTrack(trackId);

  const remaining = getRemainingTimeSec(options.song, target);
  if (remaining > FINAL_WINDOW_SEC) {
    return 'played';
  }

  if (finalSyncDone) {
    return 'played';
  }

  const diff = target - audio.currentTime;
  if (diff > 0) {
    audio.currentTime = target;
    snapSmoothPlaybackTime(target);
    finalSyncDone = true;
  }

  return 'played';
}

async function applyExplicitForceSync(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): Promise<PlayResult | 'paused' | 'idle'> {
  const state = getClientPlaybackState();
  const target = resolveTargetTime(audio, options);
  const isPlaying = state?.status === 'playing';

  if (!isPlaying) {
    lockPlaybackRate(audio);
    if (!audio.paused) audio.pause();
    explicitHardSeek(audio, target);
    return 'paused';
  }

  explicitHardSeek(audio, target);

  if (audio.paused) {
    const initial = await tryPlayWithAutoplayFallback(audio, Boolean(options.tvMode));
    const result = await assessPlaybackResult(audio, initial);
    if (result !== 'played') return result;
  }

  return 'played';
}

export async function applyFollowerSync(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): Promise<PlayResult | 'paused' | 'idle'> {
  if (!audio.src) return 'idle';

  if (isExplicitForce(options)) {
    return applyExplicitForceSync(audio, options);
  }

  if (shouldSkipRoutineSync(audio, options)) {
    return 'played';
  }

  const state = getClientPlaybackState();
  const isPlaying = state?.status === 'playing';
  const target = resolveTargetTime(audio, options);

  if (!isPlaying) {
    lockPlaybackRate(audio);
    if (!audio.paused) audio.pause();
    return 'paused';
  }

  if (audio.paused) {
    const initial = await tryPlayWithAutoplayFallback(audio, Boolean(options.tvMode));
    const result = await assessPlaybackResult(audio, initial);
    if (result !== 'played') return result;
  }

  if (shouldSkipRoutineSync(audio, options)) {
    return 'played';
  }

  return applyDiscretePhaseSync(audio, target, options);
}

export async function applyVisibilityResume(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): Promise<PlayResult | 'paused' | 'idle'> {
  return applyFollowerSync(audio, options);
}

export function resetPlaybackRate(audio: HTMLAudioElement): void {
  resetDriftController(audio);
}

export async function applyPostBufferSync(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): Promise<void> {
  if (!audio.src || audio.paused || audio.ended) return;
  if (getClientPlaybackState()?.status !== 'playing') return;
  if (isExplicitForce(options)) {
    await applyExplicitForceSync(audio, options);
    return;
  }
  if (shouldSkipRoutineSync(audio, options)) return;

  const target = resolveTargetTime(audio, options);
  applyDiscretePhaseSync(audio, target, options);
}

export function resetPhaseSync(): void {
  finalSyncTrackId = null;
  finalSyncDone = false;
}
