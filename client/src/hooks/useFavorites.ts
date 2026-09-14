import { useCallback, useEffect, useRef, useState } from 'react';
import { songKey } from '../api/music';
import { useSocket } from './useSocket';
import type { FavoriteSong, Song } from '../types';
import { fetchAccountSession } from '../lib/accountAuth';
import { getClientId } from '../lib/clientId';
import {
  markFavoritesSyncAttempt,
  markFavoritesSyncFailed,
  markFavoritesSyncPending,
  markFavoritesSyncResult,
  readFavoritesSyncState,
  syncAccountFavorites,
  type FavoritesSyncState,
} from '../lib/favoritesSync';

let sharedFavoriteIds = new Set<string>();
let sharedFavoriteSongs: FavoriteSong[] = [];
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();
let sharedSyncState = readFavoritesSyncState();
const syncListeners = new Set<() => void>();

const GUEST_CACHE_KEY = 'openmusic:favorites-cache:v1:guest';
const ACCOUNT_CACHE_PREFIX = 'openmusic:favorites-cache:v1:account:';
const GUEST_ID_KEY = 'openmusic:favorites-cache:v1:guest-identity';

function rememberGuestIdentity(): string {
  const id = getClientId();
  try { localStorage.setItem(GUEST_ID_KEY, id); } catch { /* storage unavailable */ }
  return id;
}

function readCache(key: string): FavoriteSong[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is FavoriteSong => Boolean(
      item && typeof item === 'object' && String(item.id || '').trim() && String(item.name || '').trim(),
    ));
  } catch {
    return [];
  }
}

function writeCache(key: string, songs: FavoriteSong[]): void {
  try { localStorage.setItem(key, JSON.stringify(songs.slice(0, 5000))); } catch { /* storage unavailable */ }
}

function removeCache(key: string): void {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

function accountCacheKey(accountId: string): string {
  return `${ACCOUNT_CACHE_PREFIX}${accountId}`;
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function updateSharedFavorites(songs: FavoriteSong[], cacheKey?: string) {
  sharedFavoriteSongs = songs;
  sharedFavoriteIds = new Set(songs.map((item) => songKey(item)));
  if (cacheKey) writeCache(cacheKey, songs);
  notifyListeners();
}

function updateSharedSyncState(state: FavoritesSyncState) {
  sharedSyncState = state;
  syncListeners.forEach((listener) => listener());
}

export function useFavorites() {
  const { listFavorites, setFavorite, importFavorites } = useSocket();
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set(sharedFavoriteIds));
  const [syncState, setSyncState] = useState<FavoritesSyncState>(() => sharedSyncState);
  const retryTimer = useRef<number | null>(null);

  useEffect(() => {
    const listener = () => setFavoriteIds(new Set(sharedFavoriteIds));
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => {
    const listener = () => setSyncState(sharedSyncState);
    syncListeners.add(listener);
    return () => { syncListeners.delete(listener); };
  }, []);

  const ensureLoaded = useCallback(async () => {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const guestCached = readCache(GUEST_CACHE_KEY);
      if (guestCached.length) updateSharedFavorites(guestCached, GUEST_CACHE_KEY);

      let account: Awaited<ReturnType<typeof fetchAccountSession>> = null;
      try { account = await fetchAccountSession(); } catch { /* use cache */ }

      if (!account) {
        if (guestCached.length) rememberGuestIdentity();
        if (!guestCached.length) updateSharedFavorites([], GUEST_CACHE_KEY);
        return;
      }

      const cacheKey = accountCacheKey(account.id);
      const accountCached = readCache(cacheKey);
      if (accountCached.length) updateSharedFavorites(accountCached, cacheKey);

      if (guestCached.length) updateSharedSyncState(markFavoritesSyncPending());
      const result = await listFavorites();
      if (!result.success) {
        if (guestCached.length) updateSharedSyncState(markFavoritesSyncFailed(result.error || '收藏同步失败'));
        return;
      }

      let next = result.favorites || [];
      if (guestCached.length) {
        const attempt = markFavoritesSyncAttempt();
        updateSharedSyncState(attempt);
        try {
          const imported = await syncAccountFavorites(guestCached);
          if (!imported.success) throw new Error(imported.error || '收藏同步失败');
          if (imported.favorites) next = imported.favorites;
          removeCache(GUEST_CACHE_KEY);
          const syncResult = imported.identitySame ? 'identity_same' : 'merged';
          updateSharedSyncState(markFavoritesSyncResult(syncResult, attempt));
        } catch (error) {
          updateSharedSyncState(markFavoritesSyncFailed(error, attempt));
          throw error;
        }
      }
      updateSharedFavorites(next, cacheKey);
    })().catch(() => undefined);
    return loadPromise;
  }, [importFavorites, listFavorites]);

  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  useEffect(() => {
    const onAccountSessionChanged = () => {
      loadPromise = null;
      updateSharedFavorites(readCache(GUEST_CACHE_KEY), GUEST_CACHE_KEY);
      if (readCache(GUEST_CACHE_KEY).length) updateSharedSyncState(markFavoritesSyncPending());
      void ensureLoaded();
    };
    window.addEventListener('openmusic:account-session-changed', onAccountSessionChanged);
    return () => window.removeEventListener('openmusic:account-session-changed', onAccountSessionChanged);
  }, [ensureLoaded]);

  useEffect(() => {
    const retryWhenOnline = () => {
      if (!readCache(GUEST_CACHE_KEY).length) return;
      loadPromise = null;
      void ensureLoaded();
    };
    window.addEventListener('online', retryWhenOnline);
    return () => window.removeEventListener('online', retryWhenOnline);
  }, [ensureLoaded]);

  useEffect(() => {
    if (syncState.status !== 'failed' || retryTimer.current !== null) return undefined;
    const delay = Math.min(60_000, 2_000 * (2 ** Math.min(syncState.retryCount, 5)));
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null;
      loadPromise = null;
      void ensureLoaded();
    }, delay);
    return () => {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    };
  }, [ensureLoaded, syncState.retryCount, syncState.status]);

  const isFavorite = useCallback(
    (song: Song | null) => (song ? favoriteIds.has(songKey(song)) : false),
    [favoriteIds],
  );

  const toggleFavorite = useCallback(async (song: Song) => {
    const key = songKey(song);
    let account: Awaited<ReturnType<typeof fetchAccountSession>> = null;
    try {
      account = await fetchAccountSession();
    } catch {
      return { success: false as const, error: '账户状态暂时无法确认，请稍后重试' };
    }

    if (!account) {
      rememberGuestIdentity();
      const next = sharedFavoriteSongs.filter((item) => songKey(item) !== key);
      if (!favoriteIds.has(key)) next.unshift({ ...song, favoritedAt: Date.now() });
      updateSharedFavorites(next, GUEST_CACHE_KEY);
      return { success: true as const, favorites: next };
    }

    const result = await setFavorite(song, !favoriteIds.has(key));
    if (!result.success) return { success: false as const, error: result.error || '收藏失败' };
    if (result.favorites) updateSharedFavorites(result.favorites, accountCacheKey(account.id));
    return { success: true as const, favorites: result.favorites || sharedFavoriteSongs };
  }, [favoriteIds, setFavorite]);

  const applyFavorites = useCallback((favorites: FavoriteSong[]) => {
    updateSharedFavorites(favorites);
    void fetchAccountSession().then((account) => {
      if (account) writeCache(accountCacheKey(account.id), favorites);
    }).catch(() => undefined);
  }, []);

  const reloadFavorites = useCallback(async () => {
    loadPromise = null;
    await ensureLoaded();
  }, [ensureLoaded]);

  const retryFavoritesSync = useCallback(async () => {
    updateSharedSyncState(markFavoritesSyncPending());
    loadPromise = null;
    await ensureLoaded();
    return readFavoritesSyncState();
  }, [ensureLoaded]);

  const listCachedFavorites = useCallback(async () => {
    await ensureLoaded();
    return { success: true, favorites: sharedFavoriteSongs, error: undefined as string | undefined };
  }, [ensureLoaded]);

  const setCachedFavorite = useCallback(async (song: Song, favorite: boolean) => {
    if (favoriteIds.has(songKey(song)) !== favorite) return toggleFavorite(song);
    return { success: true as const, favorites: sharedFavoriteSongs, favorite };
  }, [favoriteIds, toggleFavorite]);

  const importCachedFavorites = useCallback(async (songs: Song[]) => {
    let account: Awaited<ReturnType<typeof fetchAccountSession>> = null;
    try {
      account = await fetchAccountSession();
    } catch {
      return { success: false as const, error: '账户状态暂时无法确认，请稍后重试' };
    }
    if (!account) {
      rememberGuestIdentity();
      const seen = new Set(sharedFavoriteSongs.map((item) => songKey(item)));
      const before = sharedFavoriteSongs.length;
      const next = [...sharedFavoriteSongs];
      for (const song of songs) {
        const key = songKey(song);
        if (seen.has(key)) continue;
        seen.add(key);
        next.unshift({ ...song, favoritedAt: Date.now() });
      }
      updateSharedFavorites(next, GUEST_CACHE_KEY);
      return { success: true as const, favorites: next, imported: next.length - before, dropped: 0 };
    }
    const result = await importFavorites(songs);
    if (result.success && result.favorites) updateSharedFavorites(result.favorites, accountCacheKey(account.id));
    return result;
  }, [importFavorites]);

  return {
    favoriteIds,
    favorites: sharedFavoriteSongs,
    isFavorite,
    toggleFavorite,
    listFavorites: listCachedFavorites,
    setFavorite: setCachedFavorite,
    importFavorites: importCachedFavorites,
    applyFavorites,
    reloadFavorites,
    syncState,
    retryFavoritesSync,
  };
}
