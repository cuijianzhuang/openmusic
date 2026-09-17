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
const GUEST_CATEGORIES_KEY = 'openmusic:favorite-categories:v1:guest';
const ACCOUNT_CATEGORIES_PREFIX = 'openmusic:favorite-categories:v1:account:';

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

function categoriesCacheKey(accountId?: string): string {
  return accountId ? `${ACCOUNT_CATEGORIES_PREFIX}${accountId}` : GUEST_CATEGORIES_KEY;
}

function readCategories(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeCategories(key: string, categories: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(categories)); } catch { /* storage unavailable */ }
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
  const { listFavorites, listFavoriteCategories, createFavoriteCategory, setFavorite, setFavoriteCategory, importFavorites } = useSocket();
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set(sharedFavoriteIds));
  const [syncState, setSyncState] = useState<FavoritesSyncState>(() => sharedSyncState);
  const [categories, setCategories] = useState<string[]>(() => readCategories(GUEST_CATEGORIES_KEY));
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

  const listCachedCategories = useCallback(async () => {
    const account = await fetchAccountSession().catch(() => null);
    if (!account) {
      const cachedCategories = readCategories(GUEST_CATEGORIES_KEY);
      setCategories(cachedCategories);
      return { success: true, categories: cachedCategories };
    }
    const result = await listFavoriteCategories();
    if (result.success) {
      const nextCategories = result.categories || [];
      writeCategories(categoriesCacheKey(account.id), nextCategories);
      setCategories(nextCategories);
    }
    return result;
  }, [listFavoriteCategories]);

  const addFavoriteCategory = useCallback(async (name: string) => {
    const account = await fetchAccountSession().catch(() => null);
    if (!account) {
      const trimmedName = name.trim();
      const currentCategories = readCategories(GUEST_CATEGORIES_KEY);
      if (!trimmedName || trimmedName.length > 30) return { success: false as const, error: '分类名称需为 1-30 个字符' };
      if (trimmedName === '未分类') return { success: false as const, error: '“未分类”是系统分类，不能重复创建' };
      if (currentCategories.some((category) => category.toLowerCase() === trimmedName.toLowerCase())) return { success: false as const, error: '该分类已存在' };
      if (currentCategories.length >= 50) return { success: false as const, error: '自定义分类已达到上限' };
      const nextCategories = [...currentCategories, trimmedName];
      writeCategories(GUEST_CATEGORIES_KEY, nextCategories);
      setCategories(nextCategories);
      return { success: true as const, category: trimmedName, categories: nextCategories };
    }
    const result = await createFavoriteCategory(name);
    if (result.success && result.categories) {
      writeCategories(categoriesCacheKey(account.id), result.categories);
      setCategories(result.categories);
    }
    return result;
  }, [createFavoriteCategory]);

  const setCachedFavoriteCategory = useCallback(async (song: FavoriteSong, category: string) => {
    const account = await fetchAccountSession().catch(() => null);
    if (!account) {
      const nextCategory = category.trim();
      let resolvedCategory = '';
      if (nextCategory) {
        const currentCategories = readCategories(GUEST_CATEGORIES_KEY);
        resolvedCategory = currentCategories.find((item) => item.toLowerCase() === nextCategory.toLowerCase()) || '';
        if (!resolvedCategory) return { success: false as const, error: '请选择已创建的收藏分类' };
      }
      const next = sharedFavoriteSongs.map((item) => {
        if (songKey(item) !== songKey(song)) return item;
        if (resolvedCategory) return { ...item, category: resolvedCategory };
        const { category: _category, ...withoutCategory } = item;
        return withoutCategory;
      });
      updateSharedFavorites(next, GUEST_CACHE_KEY);
      return { success: true as const, favorites: next, category: resolvedCategory || null };
    }
    const result = await setFavoriteCategory(song, category);
    if (result.success && result.favorites) updateSharedFavorites(result.favorites, accountCacheKey(account.id));
    return result;
  }, [setFavoriteCategory]);

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
    setFavoriteCategory: setCachedFavoriteCategory,
    importFavorites: importCachedFavorites,
    applyFavorites,
    reloadFavorites,
    syncState,
    retryFavoritesSync,
    categories,
    listCategories: listCachedCategories,
    addCategory: addFavoriteCategory,
  };
}
