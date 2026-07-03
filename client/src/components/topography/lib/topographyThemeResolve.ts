import * as THREE from 'three';
import type { RoomVisualFxSettings } from '../../../lib/roomVisualPreset';
import { TOPOGRAPHY_THEMES, type TopographyThemeColors } from './topographyThemes';

export function resolveTopographyTheme(fx: RoomVisualFxSettings): TopographyThemeColors {
  const base = TOPOGRAPHY_THEMES.nocturnal;
  const theme: TopographyThemeColors = {
    ...base,
    uBaseColor1: base.uBaseColor1.clone(),
    uBaseColor2: base.uBaseColor2.clone(),
    uFogColor: base.uFogColor.clone(),
    uCoolCore: base.uCoolCore.clone(),
    uCoolEdge: base.uCoolEdge.clone(),
    uWarmCore: base.uWarmCore.clone(),
    uWarmEdge: base.uWarmEdge.clone(),
    uRippleColor: base.uRippleColor.clone(),
    uGlowIntensity: base.uGlowIntensity * (0.75 + fx.colorBoost * 0.35),
  };

  if (fx.visualTintMode === 'custom') {
    const accent = new THREE.Color(fx.visualTintColor);
    theme.uRippleColor.copy(accent);
    theme.uCoolCore.copy(accent);
    theme.uCoolEdge.copy(accent).lerp(new THREE.Color('#ffffff'), 0.35);
  }

  if (fx.backgroundColorMode === 'custom') {
    const bg = new THREE.Color(fx.backgroundColor);
    theme.uBaseColor1.copy(bg);
    theme.uFogColor.copy(bg);
    theme.uBaseColor2.copy(bg).lerp(new THREE.Color('#ffffff'), 0.12);
  }

  return theme;
}
