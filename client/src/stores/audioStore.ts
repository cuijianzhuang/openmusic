import { create } from 'zustand';

const VOLUME_KEY = 'openmusic:volume';

function readStoredVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw == null) return 1;
    const v = Number(raw);
    if (!Number.isFinite(v)) return 1;
    return Math.min(1, Math.max(0, v));
  } catch {
    return 1;
  }
}

interface AudioStore {
  trackLoading: boolean;
  setTrackLoading: (loading: boolean) => void;
  lrcDurationMs: number | null;
  lrcTrackKey: string | null;
  setLrcDuration: (trackKey: string | null, ms: number | null) => void;
  mediaDurationMs: number | null;
  mediaTrackKey: string | null;
  setMediaDuration: (trackKey: string | null, ms: number | null) => void;
  seekPlayback: ((time: number) => void) | null;
  setSeekPlayback: (fn: ((time: number) => void) | null) => void;
  localPlayback: ((isPlaying: boolean) => void) | null;
  setLocalPlayback: (fn: ((isPlaying: boolean) => void) | null) => void;
  needsAudioUnlock: boolean;
  setNeedsAudioUnlock: (needs: boolean) => void;
  retryPlayback: ((fromUserGesture?: boolean) => Promise<void>) | null;
  setRetryPlayback: (fn: ((fromUserGesture?: boolean) => Promise<void>) | null) => void;
  smoothPlaybackTime: number;
  setSmoothPlaybackTime: (time: number) => void;
  playbackVersion: number;
  setPlaybackVersion: (playbackVersion: number) => void;
  volume: number;
  setVolume: (volume: number) => void;
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
  localPlayback: null,
  setLocalPlayback: (localPlayback) => set({ localPlayback }),
  needsAudioUnlock: false,
  setNeedsAudioUnlock: (needsAudioUnlock) => set({ needsAudioUnlock }),
  retryPlayback: null,
  setRetryPlayback: (retryPlayback) => set({ retryPlayback }),
  smoothPlaybackTime: 0,
  setSmoothPlaybackTime: (smoothPlaybackTime) => set({ smoothPlaybackTime }),
  playbackVersion: 0,
  setPlaybackVersion: (playbackVersion) => set({ playbackVersion }),
  volume: readStoredVolume(),
  setVolume: (volume) => {
    const next = Math.min(1, Math.max(0, volume));
    set({ volume: next });
    try {
      localStorage.setItem(VOLUME_KEY, String(next));
    } catch {
      // localStorage may be unavailable.
    }
  },
}));
