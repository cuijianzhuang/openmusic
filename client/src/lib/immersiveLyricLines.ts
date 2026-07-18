/**
 * 沉浸模式多语歌词分行（所有视觉预设共用：星河 3D / 声波地形 DOM）
 * - 独立 translation 字段
 * - 或「原文 （翻译）」括号格式
 * - 或文本内已有换行
 */

export interface ResolveImmersiveLyricOptions {
  /** 是否显示翻译，默认 true */
  showTranslation?: boolean;
}

function stripEmbeddedTranslation(text: string): string {
  const m = text.match(/^(.*)\s*[（(]\s*([^（）()\n]+?)\s*[）)]\s*$/u);
  const head = m?.[1]?.trim();
  return head || text;
}

export function resolveImmersiveLyricLines(
  text: string,
  translation?: string | null,
  options?: ResolveImmersiveLyricOptions,
): string[] {
  const showTranslation = options?.showTranslation !== false;
  const original = String(text || '').replace(/\r\n/g, '\n').trim();
  const trans = String(translation || '').replace(/\r\n/g, '\n').trim();

  if (!showTranslation) {
    if (!original) return [];
    if (original.includes('\n')) {
      const first = original.split('\n').map((line) => line.trim()).find(Boolean);
      return first ? [stripEmbeddedTranslation(first)] : [];
    }
    return [stripEmbeddedTranslation(original)];
  }

  if (original && trans && original !== trans) {
    return [original, `（${trans.replace(/^[（(]|[）)]$/g, '').trim()}）`];
  }

  if (!original) return [];

  if (original.includes('\n')) {
    return original
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  // 贪婪取末尾一对括号作为翻译
  const m = original.match(/^(.*)\s*[（(]\s*([^（）()\n]+?)\s*[）)]\s*$/u);
  const head = m?.[1]?.trim();
  const tail = m?.[2]?.trim();
  if (head && tail) {
    return [head, `（${tail}）`];
  }

  return [original];
}

/** 同时间戳相邻行合并为原文 + 翻译（常见双语 LRC） */
export function mergeLyricTranslations<T extends { time: number; text: string; translation?: string }>(
  lines: T[],
): T[] {
  if (lines.length < 2) return lines;

  const out: T[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i]!;
    const next = lines[i + 1];
    const curText = String(cur.text || '').trim();
    const nextText = String(next?.text || '').trim();

    if (
      next
      && Math.abs(next.time - cur.time) < 0.051
      && !cur.translation
      && curText
      && nextText
      && curText !== nextText
    ) {
      out.push({ ...cur, text: curText, translation: nextText });
      i += 1;
      continue;
    }

    out.push(cur);
  }
  return out;
}
