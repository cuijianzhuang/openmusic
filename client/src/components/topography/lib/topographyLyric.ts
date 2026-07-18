import { filterDisplayLyrics } from '../../../api/music';
import { resolveImmersiveLyricLines } from '../../../lib/immersiveLyricLines';
import type { LyricLine } from '../../../types';

export interface ActiveLyricState {
  text: string;
  translation?: string;
  /** 原文 / 翻译分行（有翻译时第二项为翻译） */
  lines: string[];
  progress: number;
}

/** @deprecated 使用 lib/immersiveLyricLines.resolveImmersiveLyricLines */
export function splitImmersiveLyricLines(
  text: string,
  translation?: string | null,
  showTranslation = true,
): string[] {
  return resolveImmersiveLyricLines(text, translation, { showTranslation });
}

/** 当前行歌词 + 行内卡拉 OK 进度（0–1） */
export function getActiveLyricWithProgress(
  lines: LyricLine[],
  currentTime: number,
  showTranslation = true,
): ActiveLyricState | null {
  const displayLines = filterDisplayLyrics(lines);
  if (!displayLines.length) return null;

  const activeIndex = displayLines.findIndex((line, i) => {
    const next = displayLines[i + 1];
    return currentTime >= line.time && (!next || currentTime < next.time);
  });

  if (activeIndex < 0) {
    if (currentTime < displayLines[0].time) return null;
    const last = displayLines[displayLines.length - 1];
    const resolved = resolveImmersiveLyricLines(last.text, last.translation, { showTranslation });
    return {
      text: resolved[0] || last.text,
      translation: showTranslation ? last.translation : undefined,
      lines: resolved,
      progress: 1,
    };
  }

  const current = displayLines[activeIndex];
  const next = displayLines[activeIndex + 1];
  const duration = next ? Math.max(0.08, next.time - current.time) : 4;
  const progress = Math.max(0, Math.min(1, (currentTime - current.time) / duration));
  const resolved = resolveImmersiveLyricLines(current.text, current.translation, { showTranslation });
  return {
    text: resolved[0] || current.text,
    translation: showTranslation ? current.translation : undefined,
    lines: resolved,
    progress,
  };
}
