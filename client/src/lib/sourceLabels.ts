import type { MusicSource } from '../types';
import type { PlaylistPlatform } from '../api/music/playlist';

/** 用户可见的音源简称（避免第三方品牌名称） */
export const SOURCE_SHORT_LABELS: Record<MusicSource, string> = {
  netease: '红点',
  tencent: '绿点',
  kugou: '蓝点',
};

export const SOURCE_COLORS: Record<MusicSource, string> = {
  netease: '#ec4141',
  tencent: '#31c27c',
  kugou: '#2688ee',
};

export const PLAYLIST_PLATFORM_LABELS: Record<PlaylistPlatform, string> = {
  netease: '红点',
  qq: '绿点',
};

export function getSourceShortLabel(source?: MusicSource): string {
  if (!source) return SOURCE_SHORT_LABELS.netease;
  return SOURCE_SHORT_LABELS[source] ?? SOURCE_SHORT_LABELS.netease;
}

/** 跨源取链 tip：红点无音源，已通过绿点获取到音源 */
export function formatCrossSourceTip(
  originalSource?: MusicSource,
  fromSource?: MusicSource | null,
): string {
  const original = getSourceShortLabel(originalSource);
  const from = fromSource ? getSourceShortLabel(fromSource) : '其他平台';
  return `${original}无音源，已通过${from}获取到音源`;
}
