import type { MusicSource, SearchResult } from '../../types';
import { fetchWithTimeout } from '../http';
import { upgradeInsecureCoverUrl } from '../../lib/coverUrl';
import { metingSearchPlaylists } from './providers/meting';

export type PlaylistPlatform = 'netease' | 'qq';

export interface PlaylistImportResult {
  name: string;
  playlistId?: string;
  source: MusicSource;
  songs: SearchResult[];
  total: number;
  failed?: number;
}

export interface PlaylistSearchItem {
  id: string;
  platform: PlaylistPlatform;
  name: string;
  coverImgUrl?: string;
  creatorName?: string;
  trackCount: number;
  playCount: number;
}

/** @deprecated 使用 PlaylistSearchItem */
export type NeteasePlaylistSearchItem = PlaylistSearchItem;

export interface PlaylistSearchResult {
  playlists: PlaylistSearchItem[];
  total: number;
  page: number;
  limit: number;
}

function normalizePlaylist(
  raw: Record<string, unknown>,
  platform: PlaylistPlatform,
): PlaylistSearchItem | null {
  const id = String(raw.id || '').trim();
  if (!id) return null;

  const creator = raw.creator ?? raw.user;
  let creatorName = '';
  if (typeof creator === 'string') {
    creatorName = creator.trim();
  } else if (creator && typeof creator === 'object') {
    const entry = creator as Record<string, unknown>;
    creatorName = String(entry.nickname || entry.name || '').trim();
  }

  return {
    id,
    platform,
    name: String(raw.name || raw.title || '未命名歌单'),
    coverImgUrl: upgradeInsecureCoverUrl(String(raw.cover || raw.coverImgUrl || raw.pic || '')),
    creatorName,
    trackCount: Number(raw.trackCount || raw.track_count || raw.song_count || raw.musicNum || 0),
    playCount: Number(raw.playCount || raw.playcount || raw.play_count || 0),
  };
}

function interleavePlaylists(
  netease: PlaylistSearchItem[],
  tencent: PlaylistSearchItem[],
): PlaylistSearchItem[] {
  const merged: PlaylistSearchItem[] = [];
  const max = Math.max(netease.length, tencent.length);
  for (let i = 0; i < max; i++) {
    if (i < netease.length) merged.push(netease[i]);
    if (i < tencent.length) merged.push(tencent[i]);
  }
  return merged;
}

async function fetchMetingPlaylists(
  server: Extract<MusicSource, 'netease' | 'tencent'>,
  keyword: string,
): Promise<PlaylistSearchItem[]> {
  const platform: PlaylistPlatform = server === 'netease' ? 'netease' : 'qq';
  const data = await metingSearchPlaylists(server, keyword);
  return data
    .map((item) => normalizePlaylist(item, platform))
    .filter((item): item is PlaylistSearchItem => Boolean(item));
}

export async function importPlaylist(
  platform: PlaylistPlatform,
  input: string,
): Promise<PlaylistImportResult> {
  const res = await fetchWithTimeout(
    '/api/music/playlist/import',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, input: input.trim() }),
    },
    120000,
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : '歌单导入失败');
  }
  return data as PlaylistImportResult;
}

export type PlaylistChannelFilter = 'all' | 'netease' | 'qq';

/** 歌单搜索，支持按渠道筛选（红点 / 绿点） */
export async function searchPlaylists(
  keyword: string,
  page = 1,
  limit = 20,
  channel: PlaylistChannelFilter = 'all',
): Promise<PlaylistSearchResult> {
  const trimmed = keyword.trim();
  if (!trimmed) {
    return { playlists: [], total: 0, page, limit };
  }

  if (channel === 'netease') {
    return searchNeteasePlaylists(trimmed, page, limit);
  }
  if (channel === 'qq') {
    return searchTencentPlaylists(trimmed, page, limit);
  }

  const [neteaseBatch, tencentBatch] = await Promise.allSettled([
    fetchMetingPlaylists('netease', trimmed),
    fetchMetingPlaylists('tencent', trimmed),
  ]);

  const netease = neteaseBatch.status === 'fulfilled' ? neteaseBatch.value : [];
  const tencent = tencentBatch.status === 'fulfilled' ? tencentBatch.value : [];
  const all = interleavePlaylists(netease, tencent);
  const start = (page - 1) * limit;

  return {
    playlists: all.slice(start, start + limit),
    total: all.length,
    page,
    limit,
  };
}

/** 仅搜索红点歌单（推荐面板等场景） */
export async function searchNeteasePlaylists(
  keyword: string,
  page = 1,
  limit = 20,
): Promise<PlaylistSearchResult> {
  const trimmed = keyword.trim();
  if (!trimmed) {
    return { playlists: [], total: 0, page, limit };
  }

  const all = await fetchMetingPlaylists('netease', trimmed);
  const start = (page - 1) * limit;

  return {
    playlists: all.slice(start, start + limit),
    total: all.length,
    page,
    limit,
  };
}

/** 仅搜索绿点歌单（推荐面板等场景） */
export async function searchTencentPlaylists(
  keyword: string,
  page = 1,
  limit = 20,
): Promise<PlaylistSearchResult> {
  const trimmed = keyword.trim();
  if (!trimmed) {
    return { playlists: [], total: 0, page, limit };
  }

  const all = await fetchMetingPlaylists('tencent', trimmed);
  const start = (page - 1) * limit;

  return {
    playlists: all.slice(start, start + limit),
    total: all.length,
    page,
    limit,
  };
}

export async function fetchNeteasePlaylistMetas(ids: string[]): Promise<PlaylistSearchItem[]> {
  if (ids.length === 0) return [];
  const params = new URLSearchParams({ ids: ids.join(',') });
  const res = await fetchWithTimeout(`/api/music/netease/playlists/meta?${params.toString()}`, {}, 15000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : '获取歌单信息失败');
  }
  const playlists = Array.isArray(data.playlists) ? data.playlists : [];
  return playlists.map((item: Record<string, unknown>) => ({
    id: String(item.id || ''),
    platform: 'netease' as const,
    name: String(item.name || '未命名歌单'),
    coverImgUrl: upgradeInsecureCoverUrl(String(item.coverImgUrl || '')),
    creatorName: String(item.creatorName || ''),
    trackCount: Number(item.trackCount || 0),
    playCount: Number(item.playCount || 0),
  })).filter((item: PlaylistSearchItem) => item.id);
}
