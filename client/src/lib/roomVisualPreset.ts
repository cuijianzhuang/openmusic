import type { LyricFontKey } from './lyricStyle';

const MODE_KEY = 'openmusic:room-visual-mode';
const FX_KEY = 'openmusic:room-visual-fx';

/** Mineradio 着色器预设：0=emily … 5=galaxy，6=topography */
export type RoomVisualPresetId = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 房间背景模式 */
export type RoomVisualMode =
  | 'emily'
  | 'tunnel'
  | 'vinyl'
  | 'galaxy'
  | 'topography'
  | 'cover-bg'
  | 'off';

export const ROOM_VISUAL_DISPLAY_ORDER: RoomVisualMode[] = [
  'cover-bg',
  'emily',
  'galaxy',
  'topography',
  'vinyl',
  'tunnel',
];

export const ROOM_VISUAL_MODES: RoomVisualMode[] = ROOM_VISUAL_DISPLAY_ORDER;

export const ROOM_VISUAL_MODE_META: Record<
  RoomVisualMode,
  {
    name: string;
    hasSettings: boolean;
    shaderPreset?: RoomVisualPresetId;
  }
> = {
  emily: { name: 'emily专辑封面', hasSettings: true, shaderPreset: 0 },
  tunnel: { name: '滚筒', hasSettings: true, shaderPreset: 1 },
  vinyl: { name: '唱片', hasSettings: true, shaderPreset: 4 },
  galaxy: { name: '星河', hasSettings: true, shaderPreset: 5 },
  topography: { name: '声波地形', hasSettings: true, shaderPreset: 6 },
  'cover-bg': { name: '封面背景', hasSettings: false },
  off: { name: '关闭背景', hasSettings: false },
};

/** @deprecated 使用 ROOM_VISUAL_MODES */
export const ROOM_VISUAL_PRESET_CYCLE = ROOM_VISUAL_MODES;

/** @deprecated 使用 ROOM_VISUAL_MODE_META */
export const ROOM_VISUAL_PRESET_META = Object.fromEntries(
  ROOM_VISUAL_MODES.map((mode) => [mode, ROOM_VISUAL_MODE_META[mode]]),
) as Record<RoomVisualMode, { name: string; hasSettings: boolean }>;

const LEGACY_MODE_ALIASES: Record<string, RoomVisualMode> = {
  cover: 'emily',
  skull: 'galaxy',
  orbit: 'galaxy',
  void: 'cover-bg',
  soundwave: 'galaxy',
  vortex: 'galaxy',
  aurora: 'galaxy',
  raindrop: 'galaxy',
};

const LEGACY_NUMERIC_MODE: Record<number, RoomVisualMode> = {
  0: 'emily',
  1: 'tunnel',
  2: 'galaxy',
  3: 'cover-bg',
  4: 'vinyl',
  5: 'galaxy',
  6: 'topography',
};

export interface RoomVisualFxSettings {
  intensity: number;
  depth: number;
  point: number;
  speed: number;
  twist: number;
  colorBoost: number;
  scatter: number;
  bgFade: number;
  bloomStrength: number;
  coverResolution: number;
  cinemaShake: number;
  bloom: boolean;
  edge: boolean;
  cinema: boolean;
  floatLayer: boolean;
  cameraDistance: number;
  visualTintColor: string;
  visualTintMode: 'auto' | 'custom';
  uiAccentColor: string;
  homeAccentColor: string;
  homeIconColor: string;
  visualIconColor: string;
  backgroundColorMode: 'cover' | 'custom';
  backgroundColor: string;
  backgroundOpacity: number;
  controlGlassChromaticOffset: number;
  backgroundMedia: string | null;
  lyricGlowStrength: number;
  lyricScale: number;
  lyricOffsetX: number;
  lyricOffsetY: number;
  lyricOffsetZ: number;
  lyricTiltX: number;
  lyricTiltY: number;
  lyricGlow: boolean;
  lyricGlowBeat: boolean;
  lyricGlowParticles: boolean;
  lyricCameraLock: boolean;
  particleLyrics: boolean;
  /** 是否显示歌词翻译（默认开启） */
  lyricShowTranslation: boolean;
  lyricColorMode: 'auto' | 'custom';
  lyricColor: string;
  lyricHighlightMode: 'auto' | 'custom';
  lyricHighlightColor: string;
  lyricGlowLinked: boolean;
  lyricGlowColor: string;
  lyricFont: LyricFontKey;
  lyricLetterSpacing: number;
  lyricLineHeight: number;
  lyricWeight: number;
  shelfMode: 'off' | 'side' | 'stage';
  shelfCameraMode: 'dynamic' | 'static';
  shelfPresence: 'auto' | 'always';
  shelfShowPodcasts: boolean;
  shelfMergeCollections: boolean;
  shelfAccentColor: string;
  shelfSize: number;
  shelfOffsetX: number;
  shelfOffsetY: number;
  shelfOffsetZ: number;
  shelfAngleY: number;
  shelfOpacity: number;
  shelfBgOpacity: number;
  cameraInteraction: 'off' | 'gesture';
}

export const DEFAULT_ROOM_VISUAL_FX: RoomVisualFxSettings = {
  intensity: 0.85,
  depth: 1.0,
  point: 1.0,
  speed: 1.0,
  twist: 0.0,
  colorBoost: 1.1,
  scatter: 0.0,
  bgFade: 0.2,
  bloomStrength: 0.62,
  coverResolution: 1.55,
  cinemaShake: 0.5,
  bloom: false,
  edge: false,
  cinema: true,
  floatLayer: true,
  cameraDistance: 1.0,
  visualTintColor: '#9db8cf',
  visualTintMode: 'auto',
  uiAccentColor: '#00f5d4',
  homeAccentColor: '#00f5d4',
  homeIconColor: '#f4d28a',
  visualIconColor: '#7fd8ff',
  backgroundColorMode: 'cover',
  backgroundColor: '#000000',
  backgroundOpacity: 1,
  controlGlassChromaticOffset: 90,
  backgroundMedia: null,
  lyricGlowStrength: 0.28,
  lyricScale: 0.7,
  lyricOffsetX: 0,
  lyricOffsetY: 0,
  lyricOffsetZ: 0,
  lyricTiltX: 0,
  lyricTiltY: 0,
  lyricGlow: true,
  lyricGlowBeat: true,
  lyricGlowParticles: false,
  lyricCameraLock: false,
  particleLyrics: true,
  lyricShowTranslation: true,
  lyricColorMode: 'auto',
  lyricColor: '#a9b8c8',
  lyricHighlightMode: 'auto',
  lyricHighlightColor: '#fac900',
  lyricGlowLinked: true,
  lyricGlowColor: '#008aff',
  lyricFont: 'hei',
  lyricLetterSpacing: 0,
  lyricLineHeight: 1.0,
  lyricWeight: 900,
  shelfMode: 'side',
  shelfCameraMode: 'static',
  shelfPresence: 'always',
  shelfShowPodcasts: false,
  shelfMergeCollections: false,
  shelfAccentColor: '#f4d28a',
  shelfSize: 1.0,
  shelfOffsetX: 1,
  shelfOffsetY: 0,
  shelfOffsetZ: 0,
  shelfAngleY: -15,
  shelfOpacity: 1.0,
  shelfBgOpacity: 0.9,
  cameraInteraction: 'off',
};

/** 歌词 Tab「恢复默认」使用的字段 */
export function defaultLyricFxPatch(): Partial<RoomVisualFxSettings> {
  return {
    lyricGlow: DEFAULT_ROOM_VISUAL_FX.lyricGlow,
    lyricGlowBeat: DEFAULT_ROOM_VISUAL_FX.lyricGlowBeat,
    lyricGlowParticles: DEFAULT_ROOM_VISUAL_FX.lyricGlowParticles,
    lyricGlowStrength: DEFAULT_ROOM_VISUAL_FX.lyricGlowStrength,
    lyricScale: DEFAULT_ROOM_VISUAL_FX.lyricScale,
    lyricOffsetX: DEFAULT_ROOM_VISUAL_FX.lyricOffsetX,
    lyricOffsetY: DEFAULT_ROOM_VISUAL_FX.lyricOffsetY,
    lyricOffsetZ: DEFAULT_ROOM_VISUAL_FX.lyricOffsetZ,
    lyricTiltX: DEFAULT_ROOM_VISUAL_FX.lyricTiltX,
    lyricTiltY: DEFAULT_ROOM_VISUAL_FX.lyricTiltY,
    particleLyrics: DEFAULT_ROOM_VISUAL_FX.particleLyrics,
    lyricShowTranslation: DEFAULT_ROOM_VISUAL_FX.lyricShowTranslation,
    lyricCameraLock: DEFAULT_ROOM_VISUAL_FX.lyricCameraLock,
    lyricColorMode: DEFAULT_ROOM_VISUAL_FX.lyricColorMode,
    lyricColor: DEFAULT_ROOM_VISUAL_FX.lyricColor,
    lyricHighlightMode: DEFAULT_ROOM_VISUAL_FX.lyricHighlightMode,
    lyricHighlightColor: DEFAULT_ROOM_VISUAL_FX.lyricHighlightColor,
    lyricGlowLinked: DEFAULT_ROOM_VISUAL_FX.lyricGlowLinked,
    lyricGlowColor: DEFAULT_ROOM_VISUAL_FX.lyricGlowColor,
    lyricFont: DEFAULT_ROOM_VISUAL_FX.lyricFont,
    lyricLetterSpacing: DEFAULT_ROOM_VISUAL_FX.lyricLetterSpacing,
    lyricLineHeight: DEFAULT_ROOM_VISUAL_FX.lyricLineHeight,
    lyricWeight: DEFAULT_ROOM_VISUAL_FX.lyricWeight,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function normalizeHexColor(input: string, fallback: string): string {
  const raw = String(input || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  return fallback;
}

export function normalizeCoverResolution(value: number): number {
  return clamp(Number(value) || 1, 0.75, 1.55);
}

export function readRoomVisualMode(): RoomVisualMode {
  try {
    const keys = [MODE_KEY, 'openmusic:room-visual-preset'];
    for (const key of keys) {
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      if (LEGACY_MODE_ALIASES[raw]) return LEGACY_MODE_ALIASES[raw];
      if (ROOM_VISUAL_MODES.includes(raw as RoomVisualMode)) {
        return raw === 'off' ? 'cover-bg' : (raw as RoomVisualMode);
      }
      const legacy = LEGACY_NUMERIC_MODE[Number(raw)];
      if (legacy) return legacy === 'off' ? 'cover-bg' : legacy;
    }
  } catch {
    // ignore
  }
  return 'cover-bg';
}

/** 与 Room 页实际渲染的背景一致 */
export function readEffectiveRoomVisualMode(): RoomVisualMode {
  return readRoomVisualMode();
}

/** 封面背景层需 Canvas 采样时走 media-proxy */
export function visualModeUsesProxiedCover(mode: RoomVisualMode): boolean {
  return mode === 'cover-bg';
}

/**
 * 着色器背景需 Web Audio 分析播放频谱，跨域音频须同源代理。
 * cover-bg / off 仅播歌不解析频谱，歌曲 URL 直链即可。
 */
export function shouldProxySongPlaybackUrl(mode?: RoomVisualMode): boolean {
  const effective = mode ?? readEffectiveRoomVisualMode();
  if (effective === 'off' || effective === 'cover-bg') return false;
  return ROOM_VISUAL_MODE_META[effective].shaderPreset !== undefined;
}

export function writeRoomVisualMode(mode: RoomVisualMode): void {
  try {
    sessionStorage.setItem(MODE_KEY, mode);
  } catch {
    // ignore
  }
}

/** @deprecated 使用 readRoomVisualMode */
export function readRoomVisualPreset(): RoomVisualMode {
  return readRoomVisualMode();
}

/** @deprecated 使用 writeRoomVisualMode */
export function writeRoomVisualPreset(mode: RoomVisualMode): void {
  writeRoomVisualMode(mode);
}

export function readRoomVisualFx(): RoomVisualFxSettings {
  try {
    const raw = sessionStorage.getItem(FX_KEY);
    if (!raw) return { ...DEFAULT_ROOM_VISUAL_FX };
    const parsed = JSON.parse(raw) as Partial<RoomVisualFxSettings>;
    return {
      intensity: clamp(Number(parsed.intensity) || DEFAULT_ROOM_VISUAL_FX.intensity, 0.2, 1.6),
      depth: clamp(Number(parsed.depth) || DEFAULT_ROOM_VISUAL_FX.depth, 0.2, 1.8),
      point: clamp(Number(parsed.point) || DEFAULT_ROOM_VISUAL_FX.point, 0.5, 2.2),
      speed: clamp(Number(parsed.speed) || DEFAULT_ROOM_VISUAL_FX.speed, 0.2, 2.5),
      twist: clamp(Number(parsed.twist) ?? DEFAULT_ROOM_VISUAL_FX.twist, 0, 0.6),
      colorBoost: clamp(Number(parsed.colorBoost) || DEFAULT_ROOM_VISUAL_FX.colorBoost, 0.5, 2.0),
      scatter: clamp(Number(parsed.scatter) ?? DEFAULT_ROOM_VISUAL_FX.scatter, 0, 0.5),
      bgFade: clamp(Number(parsed.bgFade) ?? DEFAULT_ROOM_VISUAL_FX.bgFade, 0, 1.2),
      bloomStrength: clamp(Number(parsed.bloomStrength) ?? DEFAULT_ROOM_VISUAL_FX.bloomStrength, 0, 1.6),
      coverResolution: normalizeCoverResolution(
        Number(parsed.coverResolution) || DEFAULT_ROOM_VISUAL_FX.coverResolution,
      ),
      cinemaShake: clamp(Number(parsed.cinemaShake) ?? DEFAULT_ROOM_VISUAL_FX.cinemaShake, 0, 1.8),
      bloom: parsed.bloom === true,
      edge: parsed.edge === true,
      cameraDistance: clamp(Number(parsed.cameraDistance) || DEFAULT_ROOM_VISUAL_FX.cameraDistance, 0.55, 1.65),
      visualTintColor: normalizeHexColor(parsed.visualTintColor || '', DEFAULT_ROOM_VISUAL_FX.visualTintColor),
      visualTintMode: parsed.visualTintMode === 'custom' ? 'custom' : 'auto',
      uiAccentColor: normalizeHexColor(parsed.uiAccentColor || '', DEFAULT_ROOM_VISUAL_FX.uiAccentColor),
      homeAccentColor: normalizeHexColor(parsed.homeAccentColor || '', DEFAULT_ROOM_VISUAL_FX.homeAccentColor),
      homeIconColor: normalizeHexColor(parsed.homeIconColor || '', DEFAULT_ROOM_VISUAL_FX.homeIconColor),
      visualIconColor: normalizeHexColor(parsed.visualIconColor || '', DEFAULT_ROOM_VISUAL_FX.visualIconColor),
      backgroundColorMode: parsed.backgroundColorMode === 'custom' ? 'custom' : 'cover',
      backgroundColor: normalizeHexColor(parsed.backgroundColor || '', DEFAULT_ROOM_VISUAL_FX.backgroundColor),
      backgroundOpacity: clamp(Number(parsed.backgroundOpacity) ?? DEFAULT_ROOM_VISUAL_FX.backgroundOpacity, 0, 1),
      controlGlassChromaticOffset: clamp(
        Number(parsed.controlGlassChromaticOffset) ?? DEFAULT_ROOM_VISUAL_FX.controlGlassChromaticOffset,
        0,
        140,
      ),
      backgroundMedia: typeof parsed.backgroundMedia === 'string' && parsed.backgroundMedia ? parsed.backgroundMedia : null,
      cinema: parsed.cinema !== false,
      floatLayer: parsed.floatLayer !== false,
      lyricGlowStrength: clamp(
        Number(parsed.lyricGlowStrength) ?? DEFAULT_ROOM_VISUAL_FX.lyricGlowStrength,
        0,
        0.85,
      ),
      lyricScale: clamp(Number(parsed.lyricScale) || DEFAULT_ROOM_VISUAL_FX.lyricScale, 0.35, 1.65),
      lyricOffsetX: clamp(Number(parsed.lyricOffsetX) ?? 0, -2, 2),
      lyricOffsetY: clamp(Number(parsed.lyricOffsetY) ?? 0, -1.2, 1.35),
      lyricOffsetZ: clamp(Number(parsed.lyricOffsetZ) ?? 0, -1.6, 1.6),
      lyricTiltX: clamp(Number(parsed.lyricTiltX) ?? 0, -42, 42),
      lyricTiltY: clamp(Number(parsed.lyricTiltY) ?? 0, -42, 42),
      lyricGlow: parsed.lyricGlow !== false,
      lyricGlowBeat: parsed.lyricGlowBeat !== false,
      lyricGlowParticles: parsed.lyricGlowParticles === true,
      lyricCameraLock: parsed.lyricCameraLock === true,
      particleLyrics: parsed.particleLyrics !== false,
      lyricShowTranslation: parsed.lyricShowTranslation !== false,
      lyricColorMode: parsed.lyricColorMode === 'custom' ? 'custom' : 'auto',
      lyricColor: normalizeHexColor(parsed.lyricColor || '', DEFAULT_ROOM_VISUAL_FX.lyricColor),
      lyricHighlightMode: parsed.lyricHighlightMode === 'custom' ? 'custom' : 'auto',
      lyricHighlightColor: normalizeHexColor(
        parsed.lyricHighlightColor || '',
        DEFAULT_ROOM_VISUAL_FX.lyricHighlightColor,
      ),
      lyricGlowLinked: parsed.lyricGlowLinked !== false,
      lyricGlowColor: normalizeHexColor(parsed.lyricGlowColor || '', DEFAULT_ROOM_VISUAL_FX.lyricGlowColor),
      lyricFont: (() => {
        const raw = String(parsed.lyricFont || DEFAULT_ROOM_VISUAL_FX.lyricFont);
        return /^(sans|hei|song|bold-song|stone-song|kai-song|serif-en|gothic|editorial|humanist|mono|display)$/.test(raw)
          ? raw as RoomVisualFxSettings['lyricFont']
          : DEFAULT_ROOM_VISUAL_FX.lyricFont;
      })(),
      lyricLetterSpacing: clamp(Number(parsed.lyricLetterSpacing) ?? DEFAULT_ROOM_VISUAL_FX.lyricLetterSpacing, -0.04, 0.18),
      lyricLineHeight: clamp(Number(parsed.lyricLineHeight) || DEFAULT_ROOM_VISUAL_FX.lyricLineHeight, 0.86, 1.35),
      lyricWeight: clamp(Number(parsed.lyricWeight) || DEFAULT_ROOM_VISUAL_FX.lyricWeight, 500, 900),
      shelfMode: parsed.shelfMode === 'side' || parsed.shelfMode === 'stage' ? parsed.shelfMode : 'off',
      shelfCameraMode: parsed.shelfCameraMode === 'dynamic' ? 'dynamic' : 'static',
      shelfPresence: parsed.shelfPresence === 'auto' ? 'auto' : 'always',
      shelfShowPodcasts: parsed.shelfShowPodcasts === true,
      shelfMergeCollections: parsed.shelfMergeCollections === true,
      shelfAccentColor: normalizeHexColor(parsed.shelfAccentColor || '', DEFAULT_ROOM_VISUAL_FX.shelfAccentColor),
      shelfSize: clamp(Number(parsed.shelfSize) || DEFAULT_ROOM_VISUAL_FX.shelfSize, 0.65, 1.45),
      shelfOffsetX: clamp(Number(parsed.shelfOffsetX) ?? 0, -1.6, 1.6),
      shelfOffsetY: clamp(Number(parsed.shelfOffsetY) ?? 0, -1.6, 1.6),
      shelfOffsetZ: clamp(Number(parsed.shelfOffsetZ) ?? 0, -1.6, 1.6),
      shelfAngleY: clamp(Number(parsed.shelfAngleY) ?? DEFAULT_ROOM_VISUAL_FX.shelfAngleY, -35, 15),
      shelfOpacity: clamp(Number(parsed.shelfOpacity) || DEFAULT_ROOM_VISUAL_FX.shelfOpacity, 0.2, 1),
      shelfBgOpacity: clamp(Number(parsed.shelfBgOpacity) || DEFAULT_ROOM_VISUAL_FX.shelfBgOpacity, 0.15, 1),
      cameraInteraction: parsed.cameraInteraction === 'gesture' ? 'gesture' : 'off',
    };
  } catch {
    return { ...DEFAULT_ROOM_VISUAL_FX };
  }
}

export function writeRoomVisualFx(fx: RoomVisualFxSettings): void {
  try {
    sessionStorage.setItem(FX_KEY, JSON.stringify(fx));
  } catch {
    // ignore
  }
}

export const ROOM_AMBIENT_GLASS_CLASS =
  'border-white/10 bg-black/20 backdrop-blur-xl [-webkit-backdrop-filter:blur(24px)]';

export const ROOM_AMBIENT_GLASS_TRANSPARENT_CLASS = 'border-transparent bg-transparent';

const SHADER_VISUAL_MODES = new Set<RoomVisualMode>([
  'emily',
  'tunnel',
  'vinyl',
  'galaxy',
  'topography',
]);

export function roomAmbientGlassClass(mode: RoomVisualMode): string {
  return SHADER_VISUAL_MODES.has(mode)
    ? ROOM_AMBIENT_GLASS_TRANSPARENT_CLASS
    : ROOM_AMBIENT_GLASS_CLASS;
}
