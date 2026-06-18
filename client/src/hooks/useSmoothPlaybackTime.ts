import { useEffect } from 'react';
import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';
import { getSharedAudio } from '../lib/audioElement';

let rafId = 0;
let loopSubscribers = 0;
const anchor = { time: 0, at: Date.now() };
let lastTrackKey = '';

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function tick() {
  if (loopSubscribers <= 0) {
    stopLoop();
    return;
  }

  const { room, isOwner } = useRoomStore.getState();
  const isPlaying = room?.isPlaying ?? false;
  const roomTime = room?.currentTime ?? 0;
  const setSmoothPlaybackTime = useAudioStore.getState().setSmoothPlaybackTime;

  if (!isPlaying) {
    setSmoothPlaybackTime(roomTime);
    rafId = requestAnimationFrame(tick);
    return;
  }

  const audio = getSharedAudio();
  const song = room?.current;
  const loading = useAudioStore.getState().trackLoading;

  if (isOwner && !loading && song && audio.src && isFinite(audio.currentTime)) {
    const trackKey = `${song.queueId}:${song.id}`;
    if (trackKey === lastTrackKey) {
      const t = audio.currentTime;
      setSmoothPlaybackTime(t);
      if (!audio.paused) {
        anchor.time = t;
        anchor.at = Date.now();
      }
      rafId = requestAnimationFrame(tick);
      return;
    }
  }

  setSmoothPlaybackTime(anchor.time + (Date.now() - anchor.at) / 1000);

  rafId = requestAnimationFrame(tick);
}

function startLoop() {
  if (!rafId) rafId = requestAnimationFrame(tick);
}

/** seek / 切歌时立即对齐进度，避免外层进度条缓慢追赶 */
export function snapSmoothPlaybackTime(time: number) {
  anchor.time = time;
  anchor.at = Date.now();
  useAudioStore.getState().setSmoothPlaybackTime(time);
}

/**
 * 歌词/进度条用的高频播放时间（全局单例）。
 * 房主：直接读 audio.currentTime；听众：在服务端 tick 之间线性插值。
 */
export function useSmoothPlaybackTime(): number {
  const roomTime = useRoomStore((s) => s.room?.currentTime ?? 0);
  const isPlaying = useRoomStore((s) => s.room?.isPlaying ?? false);
  const current = useRoomStore((s) => s.room?.current);
  const isOwner = useRoomStore((s) => s.isOwner);
  const trackLoading = useAudioStore((s) => s.trackLoading);
  const smoothTime = useAudioStore((s) => s.smoothPlaybackTime);

  useEffect(() => {
    const trackKey = current ? `${current.queueId}:${current.id}` : '';
    const trackChanged = trackKey !== lastTrackKey;
    lastTrackKey = trackKey;

    if (trackChanged) {
      snapSmoothPlaybackTime(0);
      return;
    }

    // 房主播放中：新用户加入会触发 room_update，不要用服务端时间覆盖进度条
    if (isOwner && isPlaying) return;

    anchor.time = roomTime;
    anchor.at = Date.now();
    useAudioStore.getState().setSmoothPlaybackTime(roomTime);
  }, [roomTime, current?.queueId, current?.id, isOwner, isPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      useAudioStore.getState().setSmoothPlaybackTime(roomTime);
      return;
    }

    loopSubscribers += 1;
    startLoop();

    return () => {
      loopSubscribers -= 1;
      if (loopSubscribers <= 0) stopLoop();
    };
  }, [isPlaying, current?.queueId, current?.id, isOwner, trackLoading]);

  return isPlaying ? smoothTime : roomTime;
}
