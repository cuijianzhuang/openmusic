import { create } from 'zustand';

interface AudioStore {
  trackLoading: boolean;
  setTrackLoading: (loading: boolean) => void;
  /** 歌词解析出的时长（毫秒） */
  lrcDurationMs: number | null;
  lrcTrackKey: string | null;
  setLrcDuration: (trackKey: string | null, ms: number | null) => void;
  /** 音频文件真实时长（毫秒） */
  mediaDurationMs: number | null;
  mediaTrackKey: string | null;
  setMediaDuration: (trackKey: string | null, ms: number | null) => void;
  seekPlayback: ((time: number) => void) | null;
  setSeekPlayback: (fn: ((time: number) => void) | null) => void;
  /** 浏览器拦截自动播放（常见于微信内置浏览器） */
  needsAudioUnlock: boolean;
  setNeedsAudioUnlock: (needs: boolean) => void;
  retryPlayback: ((fromUserGesture?: boolean) => Promise<void>) | null;
  setRetryPlayback: (fn: ((fromUserGesture?: boolean) => Promise<void>) | null) => void;
  /** 全局平滑播放时间（进度条/歌词共用，避免多组件各自维护状态） */
  smoothPlaybackTime: number;
  setSmoothPlaybackTime: (time: number) => void;
}

export const useAudioStore = create<AudioStore>((set) => ({
  trackLoading: false,
  setTrackLoading: (trackLoading) => set({ trackLoading }),
  lrcDurationMs: null,
  lrcTrackKey: null,
  setLrcDuration: (lrcTrackKey, lrcDurationMs) => set({ lrcTrackKey, lrcDurationMs }),
  mediaDurationMs: null,
  mediaTrackKey: null,
  setMediaDuration: (mediaTrackKey, mediaDurationMs) => set({ mediaTrackKey, mediaDurationMs }),
  seekPlayback: null,
  setSeekPlayback: (seekPlayback) => set({ seekPlayback }),
  needsAudioUnlock: false,
  setNeedsAudioUnlock: (needsAudioUnlock) => set({ needsAudioUnlock }),
  retryPlayback: null,
  setRetryPlayback: (retryPlayback) => set({ retryPlayback }),
  smoothPlaybackTime: 0,
  setSmoothPlaybackTime: (smoothPlaybackTime) => set({ smoothPlaybackTime }),
}));
