import type { LucideIcon } from 'lucide-react';
import { Dices, ListOrdered, Repeat, Repeat1, Shuffle } from 'lucide-react';

/** 房间播放顺序 */
export type PlayMode = 'order' | 'shuffle' | 'loop-one' | 'loop-all' | 'shuffle-loop';

export const PLAY_MODE_ORDER: PlayMode[] = [
  'order',
  'shuffle',
  'loop-one',
  'loop-all',
  'shuffle-loop',
];

export const PLAY_MODE_META: Record<PlayMode, { label: string; short: string; Icon: LucideIcon }> = {
  order: { label: '顺序播放', short: '顺序', Icon: ListOrdered },
  shuffle: { label: '随机播放', short: '随机', Icon: Shuffle },
  'loop-one': { label: '单曲循环', short: '单曲', Icon: Repeat1 },
  'loop-all': { label: '列表循环', short: '列表', Icon: Repeat },
  'shuffle-loop': { label: '列表内随机', short: '列表随机', Icon: Dices },
};

export function normalizePlayMode(value: unknown): PlayMode {
  const mode = String(value || '').trim().toLowerCase();
  return (PLAY_MODE_ORDER as string[]).includes(mode) ? (mode as PlayMode) : 'order';
}

export function nextPlayMode(current: unknown): PlayMode {
  const mode = normalizePlayMode(current);
  const idx = PLAY_MODE_ORDER.indexOf(mode);
  return PLAY_MODE_ORDER[(idx + 1) % PLAY_MODE_ORDER.length];
}
