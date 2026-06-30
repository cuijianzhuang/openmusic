import { isMobileDevice } from './audioUnlock';

const MODE_KEY = 'openmusic:room-visual-mode';
const FX_KEY = 'openmusic:room-visual-fx';

/** Mineradio 着色器预设：0=emily … 5=galaxy */
export type RoomVisualPresetId = 0 | 1 | 2 | 3 | 4 | 5;

/** 房间背景模式（对齐 Mineradio presetMeta，不含安魂） */
export type RoomVisualMode =
  | 'emily'
  | 'tunnel'
  | 'orbit'
  | 'void'
  | 'vinyl'
  | 'galaxy'
  | 'cover-bg'
  | 'off';

export const ROOM_VISUAL_DISPLAY_ORDER: RoomVisualMode[] = [
  'emily',
  'galaxy',
  'vinyl',
  'orbit',
  'tunnel',
  'void',
  'cover-bg',
  'off',
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
  orbit: { name: '星球', hasSettings: true, shaderPreset: 2 },
  void: { name: '虚空', hasSettings: true, shaderPreset: 3 },
  vinyl: { name: '唱片', hasSettings: true, shaderPreset: 4 },
  galaxy: { name: '星河', hasSettings: true, shaderPreset: 5 },
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
};

const LEGACY_NUMERIC_MODE: Record<number, RoomVisualMode> = {
  0: 'emily',
  1: 'tunnel',
  2: 'orbit',
  3: 'void',
  4: 'vinyl',
  5: 'galaxy',
  6: 'galaxy',
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
  cameraDistance: number;
  visualTintColor: string;
  visualTintMode: 'auto' | 'custom';
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
  cameraDistance: 1.0,
  visualTintColor: '#9db8cf',
  visualTintMode: 'auto',
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function normalizeHexColor(input: string, fallback: string): string {
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
        return raw as RoomVisualMode;
      }
      const legacy = LEGACY_NUMERIC_MODE[Number(raw)];
      if (legacy) return legacy;
    }
  } catch {
    // ignore
  }
  return isMobileDevice() ? 'galaxy' : 'cover-bg';
}

/** 与 Room 页实际渲染的背景一致（移动端固定星河） */
export function readEffectiveRoomVisualMode(): RoomVisualMode {
  if (isMobileDevice()) return 'galaxy';
  return readRoomVisualMode();
}

/** 封面背景层需 Canvas 采样时走 media-proxy（cover-bg / void 底图） */
export function visualModeUsesProxiedCover(mode: RoomVisualMode): boolean {
  return mode === 'cover-bg' || mode === 'void';
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
  'orbit',
  'void',
  'vinyl',
  'galaxy',
]);

export function roomAmbientGlassClass(mode: RoomVisualMode): string {
  return SHADER_VISUAL_MODES.has(mode)
    ? ROOM_AMBIENT_GLASS_TRANSPARENT_CLASS
    : ROOM_AMBIENT_GLASS_CLASS;
}
