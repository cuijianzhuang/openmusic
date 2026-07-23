import type { MusicSource, SearchResult } from '../../types';

const SOURCE_PRIORITY: Record<MusicSource, number> = {
  netease: 0,
  tencent: 1,
  kugou: 2,
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '').trim();
}

/** 搜索相关度规范化：去大小写、括号附注与标点 */
function normalizeRelevanceText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/\b(?:feat\.?|ft\.?|with)\b.*$/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

/** 最长连续公共子串长度 */
function longestCommonSubstringLength(a: string, b: string): number {
  if (!a || !b) return 0;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  const maxProbe = Math.min(short.length, 16);
  for (let len = maxProbe; len >= 2; len -= 1) {
    for (let i = 0; i + len <= short.length; i += 1) {
      if (long.includes(short.slice(i, i + len))) return len;
    }
  }
  return 0;
}

function artistRelevanceBonus(keyword: string, artist: string): number {
  if (!artist) return 0;
  if (artist === keyword) return 40;
  if (artist.includes(keyword) || keyword.includes(artist)) return 20;
  const overlap = longestCommonSubstringLength(keyword, artist);
  if (overlap >= 2 && overlap / keyword.length >= 0.5) return 10;
  return 0;
}

/**
 * 通用搜索相关度（所有歌曲共用）：
 * 歌名精确 > 前缀/包含 > 公共子串覆盖；歌手命中仅作加分，或歌名无关时的兜底。
 */
export function scoreTitleRelevance(keyword: string, song: Pick<SearchResult, 'name' | 'artist'>): number {
  const kw = normalizeRelevanceText(keyword);
  if (!kw) return 0;

  const name = normalizeRelevanceText(song.name);
  const artist = normalizeRelevanceText(song.artist);
  if (!name && !artist) return 0;

  let nameScore = 0;
  if (name) {
    if (name === kw) {
      nameScore = 1000;
    } else if (name.startsWith(kw)) {
      nameScore = 880;
    } else if (kw.startsWith(name) && name.length >= 2) {
      nameScore = 820;
    } else if (name.includes(kw)) {
      nameScore = 760;
    } else if (kw.includes(name) && name.length >= 2) {
      nameScore = 700;
    } else {
      const overlap = longestCommonSubstringLength(kw, name);
      const coverage = overlap / kw.length;
      if (overlap >= 2 && (coverage >= 0.4 || overlap >= 4)) {
        nameScore = Math.round(280 + coverage * 420 + overlap * 8);
      }
    }
  }

  if (nameScore > 0) {
    return nameScore + artistRelevanceBonus(kw, artist);
  }

  // 歌名不相关时：搜歌手名仍应靠前
  if (artist) {
    if (artist === kw) return 520;
    if (artist.includes(kw)) return 460;
    if (kw.includes(artist) && artist.length >= 2) return 400;
  }

  return 0;
}

/** 按关键词相关度稳定排序；所有搜索结果共用 */
export function rankSearchResultsByKeyword(songs: SearchResult[], keyword: string): SearchResult[] {
  const trimmed = keyword.trim();
  if (!trimmed || songs.length <= 1) return songs;

  return songs
    .map((song, index) => ({ song, index, score: scoreTitleRelevance(trimmed, song) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.song);
}

/** 歌手名 + 歌名（跨平台去重键） */
export function trackTitleKey(song: Pick<SearchResult, 'name' | 'artist'>): string {
  return `${normalize(song.name)}|${normalize(song.artist)}`;
}

/** 去除完全相同的条目（同平台同 ID） */
function dedupExact(songs: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const key = `${song.source}:${song.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 跨平台去重：歌名 + 歌手一致视为同一首
 * 保留优先级：红点 > 绿点 > 蓝点（先丢蓝点，再丢绿点）
 */
function dedupeCrossSource(songs: SearchResult[]): SearchResult[] {
  const best = new Map<string, SearchResult>();

  for (const song of songs) {
    const key = trackTitleKey(song);
    const prev = best.get(key);
    if (!prev || SOURCE_PRIORITY[song.source] < SOURCE_PRIORITY[prev.source]) {
      best.set(key, song);
    }
  }

  const emitted = new Set<string>();
  const result: SearchResult[] = [];

  for (const song of songs) {
    const key = trackTitleKey(song);
    const winner = best.get(key)!;
    if (song.source !== winner.source || song.id !== winner.id) continue;
    if (emitted.has(key)) continue;
    emitted.add(key);
    result.push(song);
  }

  return result;
}

export interface InterleaveOptions {
  /** 跨平台按歌名+歌手去重，优先级：红点 > 绿点 > 蓝点 */
  dedupeCrossSource?: boolean;
  /** 仅保留指定平台结果 */
  sourceOnly?: MusicSource;
  /** 搜索关键词：合并后按相关度重排（所有歌曲） */
  keyword?: string;
}

/**
 * 多平台结果交替合并；可选跨平台去重；
 * 传入 keyword 时对全部结果按相关度重排（智能去重 / 单平台筛选均适用）。
 */
export function interleaveSearchResults(
  groups: Partial<Record<MusicSource, SearchResult[]>>,
  options: InterleaveOptions = {},
): SearchResult[] {
  const keyword = options.keyword?.trim() || '';

  // 各平台先按相关度排好，再交替，避免某一平台噪声占满前排槽位
  const prepare = (songs: SearchResult[]) => {
    const exact = dedupExact(songs);
    return keyword ? rankSearchResultsByKeyword(exact, keyword) : exact;
  };

  let merged: SearchResult[];

  if (options.sourceOnly) {
    merged = prepare(groups[options.sourceOnly] ?? []);
  } else {
    const netease = prepare(groups.netease ?? []);
    const tencent = prepare(groups.tencent ?? []);
    const kugou = prepare(groups.kugou ?? []);
    merged = [];
    const max = Math.max(netease.length, tencent.length, kugou.length);

    for (let i = 0; i < max; i++) {
      if (i < netease.length) merged.push(netease[i]);
      if (i < tencent.length) merged.push(tencent[i]);
      if (i < kugou.length) merged.push(kugou[i]);
    }

    if (options.dedupeCrossSource) {
      merged = dedupeCrossSource(merged);
    }
  }

  return keyword ? rankSearchResultsByKeyword(merged, keyword) : merged;
}

/** @deprecated 使用 interleaveSearchResults */
export function mergeSearchResults(songs: SearchResult[]): SearchResult[] {
  return dedupExact(songs);
}
export function songKey(song: Pick<SearchResult, 'source' | 'id'>): string {
  return `${song.source}-${song.id}`;
}

/** 歌手名规范化，用于分组标题去重 */
export function artistGroupKey(artist: string): string {
  return normalize(artist);
}
