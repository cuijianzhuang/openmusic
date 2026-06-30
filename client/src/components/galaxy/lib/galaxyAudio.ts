import { getSharedAudio } from '../../../lib/audioElement';
import { isProxiedMediaUrl, isSameOriginMediaUrl } from '../../../lib/mediaProxyUrl';
import { shouldProxySongPlaybackUrl } from '../../../lib/roomVisualPreset';

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let freqBuf: Uint8Array<ArrayBuffer> | null = null;
let wired = false;
let playListenerAttached = false;

function currentAudioSrc(): string {
  const audio = getSharedAudio();
  return audio.currentSrc || audio.src || '';
}

/** 当前曲目已走同源/代理地址时，才接入 Web Audio，避免切背景时劫持直链导致无声 */
function canWireGalaxyAudioNow(): boolean {
  if (!shouldProxySongPlaybackUrl()) return false;
  const src = currentAudioSrc();
  if (!src) return false;
  return isProxiedMediaUrl(src) || isSameOriginMediaUrl(src);
}

const smooth = { bass: 0, mid: 0, treble: 0, beat: 0, energy: 0 };
let bassBaseline = 0.08;
let lastBeatAt = 0;

export interface GalaxyAudioBands {
  bass: number;
  mid: number;
  treble: number;
  beat: number;
  energy: number;
}

function attachPlayListener(): void {
  if (playListenerAttached) return;
  playListenerAttached = true;
  const audio = getSharedAudio();
  const resume = () => {
    const node = ensureAnalyser();
    if (node?.context && 'resume' in node.context) {
      void (node.context as AudioContext).resume();
    }
  };
  audio.addEventListener('play', resume);
  audio.addEventListener('playing', resume);
}

function wireAnalyser(audio: HTMLAudioElement): boolean {
  if (!audioCtx || !analyser) return false;
  if (wired) return true;

  try {
    const source = audioCtx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    wired = true;
    return true;
  } catch {
    try {
      const capture = (audio as HTMLAudioElement & { captureStream?: () => MediaStream }).captureStream?.();
      if (!capture) return false;
      const streamSrc = audioCtx.createMediaStreamSource(capture);
      streamSrc.connect(analyser);
      wired = true;
      return true;
    } catch {
      return false;
    }
  }
}

function ensureAnalyser(): AnalyserNode | null {
  attachPlayListener();
  if (!canWireGalaxyAudioNow()) return null;

  const audio = getSharedAudio();
  audioCtx = audioCtx ?? new AudioContext();
  if (!analyser) {
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.86;
    analyser.minDecibels = -82;
    analyser.maxDecibels = -8;
  }

  if (!wired) wireAnalyser(audio);
  return wired ? analyser : null;
}

export function resumeGalaxyAudioContext(): void {
  const node = ensureAnalyser();
  if (node?.context && 'resume' in node.context) {
    void (node.context as AudioContext).resume();
  }
}

function smoothToward(key: keyof typeof smooth, target: number, attack: number, release: number): number {
  const current = smooth[key];
  const k = target > current ? attack : release;
  const next = current + (target - current) * k;
  smooth[key] = next;
  return next;
}

export function readGalaxyAudioBands(): GalaxyAudioBands {
  const node = ensureAnalyser();
  if (!node) {
    return { bass: 0, mid: 0, treble: 0, beat: 0, energy: 0 };
  }

  if (!freqBuf || freqBuf.length !== node.frequencyBinCount) {
    freqBuf = new Uint8Array(node.frequencyBinCount);
  }
  node.getByteFrequencyData(freqBuf);

  const n = freqBuf.length;
  const bassEnd = Math.max(3, Math.floor(n * 0.09));
  const midEnd = Math.max(bassEnd + 1, Math.floor(n * 0.38));
  let bassSum = 0;
  let midSum = 0;
  let trebleSum = 0;
  for (let i = 0; i < bassEnd; i++) bassSum += freqBuf[i];
  for (let i = bassEnd; i < midEnd; i++) midSum += freqBuf[i];
  for (let i = midEnd; i < n; i++) trebleSum += freqBuf[i];

  const rawBass = bassSum / (bassEnd * 255);
  const rawMid = midSum / ((midEnd - bassEnd) * 255);
  const rawTreble = trebleSum / ((n - midEnd) * 255);
  const rawEnergy = (rawBass * 1.15 + rawMid * 0.85 + rawTreble * 0.65) / 2.65;

  bassBaseline = bassBaseline * 0.992 + rawBass * 0.008;
  const bassLift = Math.max(0, rawBass - bassBaseline * 0.82);
  const now = performance.now();
  let beat = 0;
  if (bassLift > 0.07 && rawBass > 0.12 && now - lastBeatAt > 140) {
    beat = 1;
    lastBeatAt = now;
  }

  const bass = smoothToward('bass', Math.min(1, rawBass * 1.15), 0.28, 0.1);
  const mid = smoothToward('mid', Math.min(1, rawMid * 1.1), 0.24, 0.09);
  const treble = smoothToward('treble', Math.min(1, rawTreble * 1.05), 0.22, 0.08);
  const energy = smoothToward('energy', Math.min(1, rawEnergy * 1.1), 0.26, 0.09);
  smooth.beat = smoothToward('beat', beat, 0.55, 0.12);

  return { bass, mid, treble, beat: smooth.beat, energy };
}
