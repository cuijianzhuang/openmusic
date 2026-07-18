import type { CSSProperties } from 'react';
import type { RoomVisualFxSettings } from '../../../lib/roomVisualPreset';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 与星河 3D 歌词相同的滑块量程，映射为视口 2D 变换 */
export function buildTopographyLyricTransform(
  fx: RoomVisualFxSettings,
  fitScale = 1,
): Pick<CSSProperties, 'transform'> {
  const scale = clamp(Number(fx.lyricScale) || 1, 0.35, 1.65);
  const safeFit = clamp(Number(fitScale) || 1, 0.35, 1);
  const offsetX = clamp(Number(fx.lyricOffsetX) || 0, -2, 2) * 12;
  const offsetY = clamp(Number(fx.lyricOffsetY) || 0, -1.2, 1.35) * -10;
  const offsetZ = clamp(Number(fx.lyricOffsetZ) || 0, -1.6, 1.6);
  const depthScale = 1 + offsetZ * 0.14;
  const tiltX = clamp(Number(fx.lyricTiltX) || 0, -42, 42);
  const tiltY = clamp(Number(fx.lyricTiltY) || 0, -42, 42);

  return {
    transform: `translate3d(${offsetX}vw, ${offsetY}vh, ${offsetZ * 48}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${scale * depthScale * safeFit})`,
  };
}

export function topographyLyricGlowStrength(fx: RoomVisualFxSettings): number {
  if (!fx.lyricGlow) return 0;
  return clamp(Number(fx.lyricGlowStrength) || 0, 0, 0.85);
}

export function topographyLyricGlowBlurPx(fx: RoomVisualFxSettings, beatBoost = 0): number {
  const strength = topographyLyricGlowStrength(fx);
  if (strength <= 0) return 0;
  const drive = Math.min(1.7, strength / 0.5);
  return (10 + strength * 54 + beatBoost * 22) * drive;
}
