import type { QueueItem } from '../types';
import { snapSmoothPlaybackTime } from '../hooks/useSmoothPlaybackTime';
import { getClientPlaybackState, getPlaybackTime } from './playbackState';
import { isAudioBuffering } from './audioBuffering';
import {
  SyncState,
  allowsHardCorrection,
  getSyncState,
  isForceCorrection,
  markForceHardCorrection,
  markHardCorrection,
  requiresSoftSyncOnly,
  shouldSkipRoutineSync as shouldSkipBySyncState,
} from './syncStateMachine';
import {
  applyCurrentDriftRate,
  applyDriftCorrection,
  resetDriftController,
} from './driftController';
import {
  assessPlaybackResult,
  tryPlayWithAutoplayFallback,
  type PlayResult,
} from './audioUnlock';

const DRIFT_LOCK_SEC = 0.05;
const HARD_DRIFT_SEC = 0.8;
const POST_BUFFER_SEEK_SEC = 1.5;
const VISIBILITY_EXTREME_SEEK_SEC = 2;

export interface ApplySyncOptions {
  song: QueueItem;
  capTime: (time: number, mediaDur: number) => number;
  tvMode?: boolean;
  forceTime?: number;
  forceZero?: boolean;
  /** 服务端 playback_state / 切歌边界：绕过 recovery 状态机，仍受 cooldown（大偏差可 override） */
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

function shouldSkipRoutineSync(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): boolean {
  const force = isForceCorrection(options);
  if (shouldSkipBySyncState(force)) return true;
  if (force) return false;
  return isAudioBuffering(audio);
}

function applyVisibilitySoftSync(audio: HTMLAudioElement): 'played' {
  applyCurrentDriftRate(audio);
  return 'played';
}

function applySoftDriftOnly(audio: HTMLAudioElement, target: number): 'played' {
  applyDriftCorrection(audio, target - audio.currentTime);
  return 'played';
}

function hardSeek(
  audio: HTMLAudioElement,
  target: number,
  options: ApplySyncOptions,
): void {
  if (isForceCorrection(options)) {
    markForceHardCorrection();
  } else {
    markHardCorrection();
  }
  resetDriftController(audio);
  audio.currentTime = target;
  snapSmoothPlaybackTime(target);
}

function applySoftSyncForState(audio: HTMLAudioElement, target: number): 'played' {
  if (getSyncState() === SyncState.VISIBILITY_RECOVER) {
    return applyVisibilitySoftSync(audio);
  }
  return applySoftDriftOnly(audio, target);
}

function applyRoutineDriftSync(
  audio: HTMLAudioElement,
  target: number,
  options: ApplySyncOptions,
): 'played' {
  const diff = target - audio.currentTime;
  const absDiff = Math.abs(diff);
  const force = isForceCorrection(options);

  if (allowsHardCorrection(force, absDiff) && absDiff >= HARD_DRIFT_SEC) {
    hardSeek(audio, target, options);
    return 'played';
  }

  applyDriftCorrection(audio, diff);
  return 'played';
}

function maybeHardSeek(
  audio: HTMLAudioElement,
  target: number,
  options: ApplySyncOptions,
  thresholdSec: number,
): boolean {
  const absDiff = Math.abs(target - audio.currentTime);
  if (!allowsHardCorrection(isForceCorrection(options), absDiff)) return false;
  if (absDiff < thresholdSec) return false;
  hardSeek(audio, target, options);
  return true;
}

export async function applyFollowerSync(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): Promise<PlayResult | 'paused' | 'idle'> {
  if (!audio.src) return 'idle';

  if (shouldSkipRoutineSync(audio, options)) {
    return 'played';
  }

  const state = getClientPlaybackState();
  const isPlaying = state?.status === 'playing';
  const target = resolveTargetTime(audio, options);
  const force = isForceCorrection(options);

  if (!isPlaying) {
    resetDriftController(audio);
    if (!audio.paused) audio.pause();
    const absDiff = Math.abs(audio.currentTime - target);
    if (allowsHardCorrection(force, absDiff) && absDiff > DRIFT_LOCK_SEC) {
      hardSeek(audio, target, options);
    }
    return 'paused';
  }

  const diffBeforePlay = target - audio.currentTime;
  const absDiffBefore = Math.abs(diffBeforePlay);
  const threshold = force ? DRIFT_LOCK_SEC : HARD_DRIFT_SEC;
  if (allowsHardCorrection(force, absDiffBefore) && absDiffBefore >= threshold) {
    hardSeek(audio, target, options);
  }

  if (audio.paused) {
    const initial = await tryPlayWithAutoplayFallback(audio, Boolean(options.tvMode));
    const result = await assessPlaybackResult(audio, initial);
    if (result !== 'played') return result;
  }

  if (shouldSkipRoutineSync(audio, options)) {
    return 'played';
  }

  if (requiresSoftSyncOnly(force)) {
    return applySoftSyncForState(audio, target);
  }

  return applyRoutineDriftSync(audio, target, options);
}

export async function applyVisibilityResume(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): Promise<PlayResult | 'paused' | 'idle'> {
  if (!audio.src) return 'idle';

  const state = getClientPlaybackState();
  const target = resolveTargetTime(audio, options);
  const isPlaying = state?.status === 'playing';
  const force = isForceCorrection(options);

  if (!isPlaying) {
    resetDriftController(audio);
    if (!audio.paused) audio.pause();
    const absDiff = Math.abs(audio.currentTime - target);
    if (allowsHardCorrection(force, absDiff) && absDiff > DRIFT_LOCK_SEC) {
      hardSeek(audio, target, options);
    }
    return 'paused';
  }

  const absDiffBefore = Math.abs(target - audio.currentTime);

  if (absDiffBefore > VISIBILITY_EXTREME_SEEK_SEC) {
    if (allowsHardCorrection(force, absDiffBefore)) {
      hardSeek(audio, target, options);
    }
  } else if (force) {
    maybeHardSeek(audio, target, options, DRIFT_LOCK_SEC);
  } else if (allowsHardCorrection(false, absDiffBefore)) {
    maybeHardSeek(audio, target, options, HARD_DRIFT_SEC);
  }

  if (audio.paused) {
    const initial = await tryPlayWithAutoplayFallback(audio, Boolean(options.tvMode));
    const result = await assessPlaybackResult(audio, initial);
    if (result !== 'played') return result;
  }

  if (requiresSoftSyncOnly(force)) {
    return applySoftSyncForState(audio, target);
  }

  return applyRoutineDriftSync(audio, target, options);
}

export function resetPlaybackRate(audio: HTMLAudioElement): void {
  resetDriftController(audio);
}

export async function applyPostBufferSync(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): Promise<void> {
  if (!audio.src || audio.paused || audio.ended) return;

  const state = getClientPlaybackState();
  if (state?.status !== 'playing') return;

  const target = resolveTargetTime(audio, options);
  const diff = target - audio.currentTime;
  const absDiff = Math.abs(diff);
  const force = isForceCorrection(options);

  if (requiresSoftSyncOnly(force)) {
    applySoftSyncForState(audio, target);
    return;
  }

  if (absDiff > POST_BUFFER_SEEK_SEC && allowsHardCorrection(force, absDiff)) {
    hardSeek(audio, target, options);
    return;
  }

  applyDriftCorrection(audio, diff);
}
