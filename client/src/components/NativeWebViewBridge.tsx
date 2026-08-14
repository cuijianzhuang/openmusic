import { useEffect } from 'react';
import type { Song } from '../types';
import { getCoverUrl, songKey } from '../api/music';
import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';
import { canPauseInRoom, canSeekInRoom } from '../lib/roomPermissions';
import { getClientPlaybackState, getPlaybackTime } from '../lib/playbackState';

interface Props {
  song: Song | null;
  isPlaying: boolean;
  togglePlay: (isPlaying: boolean) => Promise<boolean>;
  skipSong: () => Promise<{ success: boolean }>;
}

type NativePlayerPermissions = {
  canPause: boolean;
  canSkip: boolean;
  canSeek: boolean;
};

function sendPlayerState(
  song: Song | null,
  isPlaying: boolean,
  permissions: NativePlayerPermissions,
) {
  const bridge = window.flutter_inappwebview;
  if (!bridge) return;
  if (!song) {
    void bridge.callHandler('omPlayerState', { title: '' });
    return;
  }

  const audio = useAudioStore.getState();
  const playbackState = getClientPlaybackState();
  const serverClockMatchesSong = playbackState?.trackId === (song as { queueId?: string }).queueId;
  const position = serverClockMatchesSong
    ? getPlaybackTime(playbackState)
    : audio.smoothPlaybackTime;
  const rawDuration = audio.mediaDurationMs != null
    ? audio.mediaDurationMs / 1000
    : Number(song.duration) || 0;
  const duration = rawDuration > 10000 ? rawDuration / 1000 : rawDuration;
  const cover = getCoverUrl(song, 'medium');
  void bridge.callHandler('omPlayerState', {
    title: song.name,
    artist: song.artist,
    cover: new URL(cover, window.location.origin).toString(),
    playing: isPlaying,
    position,
    duration,
    canPause: permissions.canPause,
    canSkip: permissions.canSkip,
    canSeek: permissions.canSeek,
  });
}

/** Synchronizes the Web room player with the Flutter-native bottom bar. */
export default function NativeWebViewBridge({ song, isPlaying, togglePlay, skipSong }: Props) {
  const songId = song ? songKey(song) : '';
  const room = useRoomStore((state) => state.room);
  const canControlPlayback = useRoomStore((state) => state.canControlPlayback);
  const permissions: NativePlayerPermissions = {
    canPause: canPauseInRoom(room, canControlPlayback),
    canSkip: canControlPlayback,
    canSeek: canSeekInRoom(room, canControlPlayback),
  };

  useEffect(() => {
    const report = () => sendPlayerState(song, isPlaying, permissions);
    report();
    const timer = window.setInterval(report, 750);
    return () => window.clearInterval(timer);
  }, [song, songId, isPlaying, permissions.canPause, permissions.canSkip, permissions.canSeek]);

  useEffect(() => () => {
    if (window.flutter_inappwebview) {
      void window.flutter_inappwebview.callHandler('omPlayerState', { title: '' });
    }
  }, []);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; time?: unknown }>).detail;
      if (detail?.action === 'play' && permissions.canPause) void togglePlay(true);
      if (detail?.action === 'pause' && permissions.canPause) void togglePlay(false);
      if (detail?.action === 'next' && permissions.canSkip) void skipSong();
      if (detail?.action === 'seek' && permissions.canSeek) {
        const time = Number(detail.time);
        if (Number.isFinite(time) && time >= 0) useAudioStore.getState().seekPlayback?.(time);
      }
    };
    window.addEventListener('omNativePlayerCommand', onCommand);
    return () => window.removeEventListener('omNativePlayerCommand', onCommand);
  }, [permissions.canPause, permissions.canSeek, permissions.canSkip, skipSong, togglePlay]);

  return null;
}
