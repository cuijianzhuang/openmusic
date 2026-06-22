import type { PlaybackState } from '../types';

type CachedPlaybackState = PlaybackState & {
  receivedAtMs: number;
  basePositionSec: number;
};

const clientState = {
  server: null as CachedPlaybackState | null,
  localVersion: 0,
};

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function statePositionSeconds(state: PlaybackState): number {
  const position = Number(state.positionSec ?? state.currentTime ?? 0);
  return Number.isFinite(position) && position > 0 ? position : 0;
}

export function getPlaybackTime(state: PlaybackState | null | undefined): number {
  if (!state) return 0;
  const cached = state as Partial<CachedPlaybackState>;
  const base = cached.basePositionSec ?? statePositionSeconds(state);
  if (state.status !== 'playing') return base;
  const receivedAt = cached.receivedAtMs ?? nowMs();
  return Math.max(0, base + (nowMs() - receivedAt) / 1000);
}

export function getClientPlaybackState(): PlaybackState | null {
  return clientState.server;
}

export function getClientPlaybackVersion(): number {
  return clientState.localVersion;
}

export function applyPlaybackState(state: PlaybackState): boolean {
  if (state.version < clientState.localVersion) return false;
  clientState.server = {
    ...state,
    positionSec: statePositionSeconds(state),
    basePositionSec: statePositionSeconds(state),
    receivedAtMs: nowMs(),
  };
  clientState.localVersion = state.version;
  return true;
}

export function resetPlaybackStateCache(): void {
  clientState.server = null;
  clientState.localVersion = 0;
}

export function playbackStateFromRoom(
  roomId: string,
  trackId: string,
  isPlaying: boolean,
  currentTime: number,
  version = 0,
): PlaybackState {
  const now = Date.now();
  const positionSec = Math.max(0, Number(currentTime) || 0);
  return {
    roomId,
    version,
    trackId,
    status: isPlaying ? 'playing' : 'paused',
    positionSec,
    serverNowMs: now,
    startedAt: isPlaying ? now - positionSec * 1000 : 0,
    currentTime: positionSec,
    updatedAt: now,
  };
}
