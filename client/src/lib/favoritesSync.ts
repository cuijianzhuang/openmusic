import type { FavoriteSong } from '../types';
import { fetchWithTimeout } from '../api/http';

export type FavoritesSyncStatus = 'idle' | 'pending' | 'syncing' | 'identity_same' | 'merged' | 'failed';

export interface FavoritesSyncState {
  status: FavoritesSyncStatus;
  retryCount: number;
  lastAttemptAt: number | null;
  lastError?: string;
}

export const INITIAL_FAVORITES_SYNC_STATE: FavoritesSyncState = {
  status: 'idle',
  retryCount: 0,
  lastAttemptAt: null,
};

const STATE_KEY = 'openmusic:favorites-sync:v1:guest';

export function readFavoritesSyncState(): FavoritesSyncState {
  try {
    const value = JSON.parse(localStorage.getItem(STATE_KEY) || 'null') as Partial<FavoritesSyncState> | null;
    if (!value || typeof value !== 'object') return INITIAL_FAVORITES_SYNC_STATE;
    let status: FavoritesSyncStatus = ['idle', 'pending', 'syncing', 'identity_same', 'merged', 'failed'].includes(String(value.status))
      ? value.status as FavoritesSyncStatus
      : 'idle';
    if (status === 'syncing') status = 'pending';
    return {
      status,
      retryCount: Number.isFinite(Number(value.retryCount)) ? Math.max(0, Number(value.retryCount)) : 0,
      lastAttemptAt: Number.isFinite(Number(value.lastAttemptAt)) ? Number(value.lastAttemptAt) : null,
      ...(value.lastError ? { lastError: String(value.lastError).slice(0, 300) } : {}),
    };
  } catch {
    return INITIAL_FAVORITES_SYNC_STATE;
  }
}

export function writeFavoritesSyncState(state: FavoritesSyncState): void {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

export function markFavoritesSyncPending(previous = readFavoritesSyncState()): FavoritesSyncState {
  const next = { ...previous, status: 'pending' as const, lastError: undefined };
  writeFavoritesSyncState(next);
  return next;
}

export function markFavoritesSyncAttempt(previous = readFavoritesSyncState()): FavoritesSyncState {
  const next = {
    ...previous,
    status: 'syncing' as const,
    lastAttemptAt: Date.now(),
    retryCount: previous.retryCount + 1,
    lastError: undefined,
  };
  writeFavoritesSyncState(next);
  return next;
}

export function markFavoritesSyncResult(status: 'identity_same' | 'merged', previous = readFavoritesSyncState()): FavoritesSyncState {
  const next = { ...previous, status, lastError: undefined };
  writeFavoritesSyncState(next);
  return next;
}

export function markFavoritesSyncFailed(error: unknown, previous = readFavoritesSyncState()): FavoritesSyncState {
  const message = error instanceof Error ? error.message : String(error || '收藏同步失败');
  const next = { ...previous, status: 'failed' as const, lastError: message.slice(0, 300) };
  writeFavoritesSyncState(next);
  return next;
}

export function mergeFavoriteSongs(base: FavoriteSong[], incoming: FavoriteSong[]): FavoriteSong[] {
  const result = [...base];
  const seen = new Set(result.map((song) => `${song.source || 'netease'}:${song.id}`));
  for (const song of incoming) {
    const key = `${song.source || 'netease'}:${song.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.unshift(song);
    }
  }
  return result.slice(0, 5000);
}

export async function syncAccountFavorites(songs: FavoriteSong[]): Promise<{
  success: boolean;
  status?: 'identity_same' | 'merged';
  identitySame?: boolean;
  favorites?: FavoriteSong[];
  imported?: number;
  dropped?: number;
  error?: string;
}> {
  const response = await fetchWithTimeout('/api/account/favorites/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songs: songs.slice(0, 1000) }),
  }, 10000);
  const data = await response.json().catch(() => ({})) as {
    success?: boolean;
    status?: 'identity_same' | 'merged';
    identitySame?: boolean;
    favorites?: FavoriteSong[];
    imported?: number;
    dropped?: number;
    error?: string;
  };
  if (!response.ok || !data.success) return { success: false, error: data.error || '收藏同步失败' };
  return data as Awaited<ReturnType<typeof syncAccountFavorites>>;
}
