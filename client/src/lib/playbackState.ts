import type { PlaybackState } from '../types';

/** 客户端缓存：服务端快照 + 本地收/提交时间 */
export type ClientPlaybackState = PlaybackState & {
  /** 收到 playback_state（或入 pending 队列）时刻，Date.now() */
  receivedAt: number;
  /** apply 到客户端缓存时刻，Date.now() */
  committedAt: number;
  basePositionSec: number;
};

const clientState = {
  server: null as ClientPlaybackState | null,
  localVersion: 0,
};

function statePositionSeconds(state: PlaybackState): number {
  const position = Number(state.positionSec ?? state.currentTime ?? 0);
  return Number.isFinite(position) && position > 0 ? position : 0;
}

/** 仅用服务端时间戳推算快照时刻进度，避免 client/server 时钟偏差 */
function positionSecAtServerSnapshot(state: PlaybackState): number {
  const base = statePositionSeconds(state);
  const startedAt = Number(state.startedAt);
  const serverNowMs = Number(state.serverNowMs);
  if (Number.isFinite(startedAt) && startedAt > 0 && Number.isFinite(serverNowMs) && serverNowMs > 0) {
    return Math.max(0, (serverNowMs - startedAt) / 1000);
  }
  if (Number.isFinite(serverNowMs) && serverNowMs > 0) {
    return base;
  }
  return base;
}

function deriveBasePositionSec(
  state: PlaybackState,
  receivedAt: number,
  committedAt: number,
): number {
  if (state.status !== 'playing') {
    return statePositionSeconds(state);
  }
  const atReceive = positionSecAtServerSnapshot(state);
  const queueDelaySec = Math.max(0, (committedAt - receivedAt) / 1000);
  return Math.max(0, atReceive + queueDelaySec);
}

/**
 * 播放进度：在 commit 时用服务端自洽时间戳定锚，之后仅用本机单调时钟外推。
 * 禁止 Date.now() - startedAt（client/server 时钟不一致时会跳秒，日志里常见 ~45s 固定偏差）。
 */
export function getPlaybackTime(state: PlaybackState | null | undefined): number {
  if (!state) return 0;
  if (state.status !== 'playing') {
    return statePositionSeconds(state);
  }
  const cached = state as Partial<ClientPlaybackState>;
  const base = cached.basePositionSec ?? statePositionSeconds(state);
  const anchor = cached.committedAt ?? cached.receivedAt ?? 0;
  if (anchor > 0) {
    return Math.max(0, base + (Date.now() - anchor) / 1000);
  }
  return positionSecAtServerSnapshot(state);
}

export function getClientPlaybackState(): ClientPlaybackState | null {
  return clientState.server;
}

export function getClientPlaybackVersion(): number {
  return clientState.localVersion;
}

export function getPlaybackSnapshotTiming(): {
  receivedAt: number;
  committedAt: number;
  snapshotAgeMs: number;
} | null {
  const s = clientState.server;
  if (!s) return null;
  return {
    receivedAt: s.receivedAt,
    committedAt: s.committedAt,
    snapshotAgeMs: Math.max(0, s.committedAt - s.receivedAt),
  };
}

export type ApplyPlaybackTiming = {
  receivedAt: number;
  committedAt?: number;
};

export function applyPlaybackState(
  state: PlaybackState,
  timing?: ApplyPlaybackTiming,
): boolean {
  if (state.version < clientState.localVersion) return false;
  const committedAt = timing?.committedAt ?? Date.now();
  const receivedAt = timing?.receivedAt ?? committedAt;
  const basePositionSec = deriveBasePositionSec(state, receivedAt, committedAt);
  clientState.server = {
    ...state,
    positionSec: statePositionSeconds(state),
    basePositionSec,
    receivedAt,
    committedAt,
  };
  clientState.localVersion = state.version;
  return true;
}

export function resetPlaybackStateCache(): void {
  clientState.server = null;
  clientState.localVersion = 0;
}

export function optimisticSeekPosition(
  roomId: string,
  trackId: string,
  positionSec: number,
  isPlaying: boolean,
): PlaybackState {
  const version = clientState.localVersion;
  const now = Date.now();
  const state = playbackStateFromRoom(roomId, trackId, isPlaying, positionSec, version);
  applyPlaybackState(state, { receivedAt: now, committedAt: now });
  return state;
}

/** 本地点暂停/播放：立刻改缓存状态，避免 forceCorrection 仍按 playing 把音频拉起来 */
export function optimisticSetPlaying(
  roomId: string,
  trackId: string,
  isPlaying: boolean,
  positionSec: number,
): PlaybackState {
  const version = clientState.localVersion;
  const now = Date.now();
  const pos = Math.max(0, Number(positionSec) || 0);
  const state = playbackStateFromRoom(roomId, trackId, isPlaying, pos, version);
  applyPlaybackState(state, { receivedAt: now, committedAt: now });
  return state;
}

export function playbackStateFromRoom(
  roomId: string,
  trackId: string,
  isPlaying: boolean,
  currentTime: number,
  version = 0,
  durationMs = 0,
): PlaybackState {
  const now = Date.now();
  const positionSec = Math.max(0, Number(currentTime) || 0);
  const durationSec = Number(durationMs) > 0 ? Number(durationMs) / 1000 : 0;
  return {
    roomId,
    version,
    trackId,
    status: isPlaying ? 'playing' : 'paused',
    positionSec,
    durationSec: durationSec > 0 ? durationSec : undefined,
    serverNowMs: now,
    startedAt: isPlaying ? now - positionSec * 1000 : 0,
    currentTime: positionSec,
    updatedAt: now,
  };
}
