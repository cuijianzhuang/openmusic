import type { PlaybackState } from '../types';
import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';
import { getSharedAudio } from './audioElement';
import {
  applyPlaybackState,
  getPlaybackTime,
  playbackStateFromRoom,
  resetPlaybackStateCache,
} from './playbackState';
import type { RoomState } from '../types';

let pendingSnapshot: PlaybackState | null = null;
/** useAudioPlayer 在曲目 load ready 后设置，与 snapshot.trackId 对齐 */
let audioReadyTrackQueueId: string | null = null;

export function markAudioReadyTrackQueueId(queueId: string | null): void {
  audioReadyTrackQueueId = queueId;
}

function syncRoomPlaybackFromState(state: PlaybackState) {
  const { room } = useRoomStore.getState();
  if (!room || room.id !== state.roomId) return;
  if (!room.current || room.current.queueId !== state.trackId) return;
  useRoomStore.getState().setRoom({
    ...room,
    currentTime: getPlaybackTime(state),
    isPlaying: state.status === 'playing',
  });
}

function isAudioReadyForSnapshot(trackId: string): boolean {
  const audio = getSharedAudio();
  if (!audio.src) return false;
  if (audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
  const duration = audio.duration;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const { room } = useRoomStore.getState();
  if (!room?.current || room.current.queueId !== trackId) return false;
  if (audioReadyTrackQueueId !== trackId) return false;
  return true;
}

function queueSnapshot(state: PlaybackState): void {
  if (!pendingSnapshot || state.version >= pendingSnapshot.version) {
    pendingSnapshot = state;
  }
}

/** 立即应用（加入房间等初始同步） */
export function commitPlaybackState(state: PlaybackState): boolean {
  if (!applyPlaybackState(state)) return false;
  useAudioStore.getState().setPlaybackVersion(state.version);
  syncRoomPlaybackFromState(state);
  return true;
}

/** 应用服务端播放状态；audio 未 ready 时先入队，避免 currentTime=0 跳秒 */
export function schedulePlaybackState(state: PlaybackState): void {
  if (!isAudioReadyForSnapshot(state.trackId)) {
    queueSnapshot(state);
    return;
  }
  pendingSnapshot = null;
  commitPlaybackState(state);
}

/** audio ready 后刷入待处理的 snapshot */
export function flushPendingPlaybackSnapshot(): boolean {
  if (!pendingSnapshot) return false;
  const state = pendingSnapshot;
  if (!isAudioReadyForSnapshot(state.trackId)) return false;
  pendingSnapshot = null;
  return commitPlaybackState(state);
}

export function hasPendingPlaybackSnapshot(): boolean {
  return pendingSnapshot !== null;
}

export function resetPlaybackScheduling(): void {
  pendingSnapshot = null;
  audioReadyTrackQueueId = null;
}

export function seedPlaybackFromRoom(room: RoomState): void {
  if (!room.current) {
    resetPlaybackStateCache();
    resetPlaybackScheduling();
    useAudioStore.getState().setPlaybackVersion(0);
    return;
  }
  const state = playbackStateFromRoom(
    room.id,
    room.current.queueId,
    room.isPlaying,
    room.currentTime,
  );
  schedulePlaybackState(state);
}
