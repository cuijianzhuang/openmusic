import { configureInlineAudio } from './audioUnlock';
import { useAudioStore } from '../stores/audioStore';
import { getAudioController } from './audioController';
import { clearAudioQueueBinding } from './audioTrackBinding';
import { resetGalaxyAudioWireIfLoaded } from './galaxyAudioBridge';

let sharedAudio: HTMLAudioElement | null = null;
let loudnessMultiplier = 1;

/** 通知 useAudioPlayer：共享 audio 已替换，需重新绑定事件 */
export let sharedAudioGeneration = 0;

export function applyAudioVolume(volume: number): void {
  const audio = sharedAudio;
  if (!audio) return;
  const userVolume = Math.min(1, Math.max(0, volume));
  audio.volume = Math.min(1, Math.max(0, userVolume * loudnessMultiplier));
}

export function applyTrackLoudness(
  loudness?: { gain?: number; peak?: number; lra?: number } | null,
): void {
  const gain = Number(loudness?.gain);
  const peak = Number(loudness?.peak);
  const safeGainDb = Number.isFinite(gain) ? Math.min(0, Math.max(-24, gain)) : 0;
  const gainMultiplier = 10 ** (safeGainDb / 20);
  const peakMultiplier = Number.isFinite(peak) && peak > 1 ? 0.98 / peak : 1;
  loudnessMultiplier = Math.min(1, gainMultiplier, peakMultiplier);
  applyAudioVolume(useAudioStore.getState().volume);
}

export function getSharedAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    configureInlineAudio(sharedAudio);
    applyAudioVolume(useAudioStore.getState().volume);
  }
  return sharedAudio;
}

/**
 * 释放 Web Audio 劫持并重建共享 audio 元素。
 * 在离开房间或从频谱/代理模式切回直链播放时必须调用，否则可能永久无声。
 */
export function resetSharedAudioElement(): HTMLAudioElement {
  getAudioController().clearQueue();
  if (sharedAudio) {
    sharedAudio.pause();
    clearAudioQueueBinding(sharedAudio);
  }
  resetGalaxyAudioWireIfLoaded();
  sharedAudio = new Audio();
  sharedAudioGeneration += 1;
  configureInlineAudio(sharedAudio);
  applyAudioVolume(useAudioStore.getState().volume);
  return sharedAudio;
}

export function stopSharedAudio(): void {
  getAudioController().clearQueue();
  if (sharedAudio) {
    sharedAudio.pause();
    clearAudioQueueBinding(sharedAudio);
  }
  resetGalaxyAudioWireIfLoaded();
  loudnessMultiplier = 1;
  sharedAudio = null;
  sharedAudioGeneration += 1;
}
