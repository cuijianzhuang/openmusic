import type { QueueItem } from '../types';
import { snapSmoothPlaybackTime } from '../hooks/useSmoothPlaybackTime';
import { getClientPlaybackState, getPlaybackTime } from './playbackState';
import {
  assessPlaybackResult,
  tryPlayWithAutoplayFallback,
  type PlayResult,
} from './audioUnlock';

const DRIFT_LOCK_SEC = 0.05;
const MICRO_DRIFT_SEC = 0.3;
const VISIBILITY_GRACE_MS = 8000;
const RESUME_SOFT_DRIFT_SEC = 0.5;
const RESUME_HARD_DRIFT_SEC = 2;

let visibilityResumeAt = 0;

export function markVisibilityResume(): void {
  visibilityResumeAt = Date.now();
}

function inVisibilityGrace(): boolean {
  return visibilityResumeAt > 0 && Date.now() - visibilityResumeAt < VISIBILITY_GRACE_MS;
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}

function tunePlaybackRate(audio: HTMLAudioElement, diff: number): void {
  audio.playbackRate = diff > 0 ? 1.03 : 0.97;
}

export interface ApplySyncOptions {
  song: QueueItem;
  capTime: (time: number, mediaDur: number) => number;
  tvMode?: boolean;
  forceTime?: number;
  forceZero?: boolean;
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

export async function applyFollowerSync(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): Promise<PlayResult | 'paused' | 'idle'> {
  if (!audio.src) return 'idle';
  if (isDocumentHidden()) return 'idle';

  const state = getClientPlaybackState();
  const isPlaying = state?.status === 'playing';
  const target = resolveTargetTime(audio, options);

  if (!isPlaying) {
    audio.playbackRate = 1;
    if (!audio.paused) audio.pause();
    if (Math.abs(audio.currentTime - target) > DRIFT_LOCK_SEC) {
      audio.currentTime = target;
      snapSmoothPlaybackTime(target);
    }
    return 'paused';
  }

  if (audio.paused) {
    const initial = await tryPlayWithAutoplayFallback(audio, Boolean(options.tvMode));
    const result = await assessPlaybackResult(audio, initial);
    if (result !== 'played') return result;
  }

  const diff = target - audio.currentTime;

  if (Math.abs(diff) < DRIFT_LOCK_SEC) {
    audio.playbackRate = 1;
    return 'played';
  }

  if (inVisibilityGrace() || Math.abs(diff) < MICRO_DRIFT_SEC) {
    tunePlaybackRate(audio, diff);
    return 'played';
  }

  audio.playbackRate = 1;
  audio.currentTime = target;
  snapSmoothPlaybackTime(target);
  return 'played';
}

export async function applyVisibilityResume(
  audio: HTMLAudioElement,
  options: ApplySyncOptions,
): Promise<PlayResult | 'paused' | 'idle'> {
  if (!audio.src || isDocumentHidden()) return 'idle';

  const state = getClientPlaybackState();
  const target = resolveTargetTime(audio, options);
  const isPlaying = state?.status === 'playing';

  if (!isPlaying) {
    audio.playbackRate = 1;
    if (!audio.paused) audio.pause();
    if (Math.abs(audio.currentTime - target) > DRIFT_LOCK_SEC) {
      audio.currentTime = target;
      snapSmoothPlaybackTime(target);
    }
    return 'paused';
  }

  if (audio.paused) {
    const initial = await tryPlayWithAutoplayFallback(audio, Boolean(options.tvMode));
    const result = await assessPlaybackResult(audio, initial);
    if (result !== 'played') return result;
  }

  const diff = target - audio.currentTime;
  const absDiff = Math.abs(diff);

  if (absDiff < RESUME_SOFT_DRIFT_SEC) {
    audio.playbackRate = 1;
    return 'played';
  }

  if (absDiff < RESUME_HARD_DRIFT_SEC) {
    tunePlaybackRate(audio, diff);
    return 'played';
  }

  audio.playbackRate = 1;
  audio.currentTime = target;
  snapSmoothPlaybackTime(target);
  return 'played';
}

export function resetPlaybackRate(audio: HTMLAudioElement): void {
  audio.playbackRate = 1;
}
