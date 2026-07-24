import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type NativeMediaAction =
  | 'play'
  | 'pause'
  | 'nexttrack'
  | 'previoustrack';

export type NativePlaybackMetadata = {
  hasTrack: boolean;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  playing?: boolean;
  durationSec?: number;
  positionSec?: number;
  /** 暂停/播放键：需有暂停权限且房间开启系统播放绑定 */
  playBound?: boolean;
  /** 上一首（回退）：需有拖进度权限 */
  prevBound?: boolean;
  /** 下一首：需有切歌权限且房间开启系统切歌绑定 */
  nextBound?: boolean;
};

type PlaybackMediaPlugin = {
  setMetadata(options: NativePlaybackMetadata): Promise<void>;
  setPlaybackState(options: {
    playing: boolean;
    durationSec?: number;
    positionSec?: number;
  }): Promise<void>;
  setControls(options: {
    playBound?: boolean;
    prevBound?: boolean;
    nextBound?: boolean;
  }): Promise<void>;
  clear(): Promise<void>;
  addListener(
    eventName: 'mediaAction',
    listenerFunc: (event: { action: NativeMediaAction }) => void,
  ): Promise<PluginListenerHandle>;
};

const PlaybackMedia = registerPlugin<PlaybackMediaPlugin>('PlaybackMedia');

/** 仅 Capacitor Android 需要原生 MediaStyle 通知栏（WebView 不支持 Media Session Web API） */
export function isNativePlaybackMediaAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function syncNativePlaybackMetadata(options: NativePlaybackMetadata): Promise<void> {
  if (!isNativePlaybackMediaAvailable()) return;
  try {
    await PlaybackMedia.setMetadata(options);
  } catch {
    // 非壳层 / 旧 APK 无插件时静默忽略
  }
}

export async function syncNativePlaybackState(options: {
  playing: boolean;
  durationSec?: number;
  positionSec?: number;
}): Promise<void> {
  if (!isNativePlaybackMediaAvailable()) return;
  try {
    await PlaybackMedia.setPlaybackState(options);
  } catch {
    // ignore
  }
}

export async function clearNativePlaybackMedia(): Promise<void> {
  if (!isNativePlaybackMediaAvailable()) return;
  try {
    await PlaybackMedia.clear();
  } catch {
    // ignore
  }
}

export async function subscribeNativeMediaActions(
  handler: (action: NativeMediaAction) => void,
): Promise<() => void> {
  if (!isNativePlaybackMediaAvailable()) return () => {};
  try {
    const handle = await PlaybackMedia.addListener('mediaAction', (event) => {
      if (event?.action) handler(event.action);
    });
    return () => {
      void handle.remove();
    };
  } catch {
    return () => {};
  }
}
