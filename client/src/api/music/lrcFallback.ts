import { fetchWithTimeout } from '../http';

const LRC_LINE_RE = /\[\d{2}:\d{2}/;

export function hasValidLrc(text: string): boolean {
  const trimmed = text?.trim() || '';
  if (!trimmed) return false;
  if (/暂无歌词|无歌词|not found|404/i.test(trimmed)) return false;
  return LRC_LINE_RE.test(trimmed);
}

export async function fetchFallbackLrc(
  songName: string,
  options: { artist?: string; album?: string } = {},
): Promise<string> {
  const name = songName.trim();
  if (!name) return '';

  const params = new URLSearchParams({ msg: name, n: '1' });
  const artist = options.artist?.trim();
  const album = options.album?.trim();
  if (artist) params.set('artist', artist);
  if (album) params.set('album', album);
  const res = await fetchWithTimeout(`/api/music/lrc-fallback?${params}`);
  if (!res.ok) return '';
  const text = await res.text();
  return hasValidLrc(text) ? text : '';
}
