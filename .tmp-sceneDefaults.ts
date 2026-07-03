export const GLOBAL_SCENE_SETTINGS_STORAGE_KEY = 'sonic_topo_global_scene_settings';
export const CAMERA_STATE_STORAGE_KEY = 'sonic_camera_state';

export interface GlobalSceneSettings {
  rotationSpeed: number;
}

export interface CameraPoint {
  x: number;
  y: number;
  z: number;
}

export interface CameraState {
  position: CameraPoint;
  target: CameraPoint;
}

export const DEFAULT_GLOBAL_SCENE_SETTINGS: GlobalSceneSettings = {
  rotationSpeed: 0.15,
};

export const DEFAULT_CAMERA_STATE: CameraState = {
  position: {
    x: -37.5836298835141,
    y: 25.718921008284557,
    z: 92.25687558089541,
  },
  target: { x: 0, y: 0, z: 0 },
};

export const DEFAULT_CAMERA_POSITION: [number, number, number] = [
  DEFAULT_CAMERA_STATE.position.x,
  DEFAULT_CAMERA_STATE.position.y,
  DEFAULT_CAMERA_STATE.position.z,
];

export function normalizeGlobalSceneSettings(value: Partial<GlobalSceneSettings> | null | undefined): GlobalSceneSettings {
  const rotationSpeed = Number(value?.rotationSpeed);
  return {
    rotationSpeed: Number.isFinite(rotationSpeed) ? rotationSpeed : DEFAULT_GLOBAL_SCENE_SETTINGS.rotationSpeed,
  };
}

function normalizeCameraPoint(value: Partial<CameraPoint> | null | undefined, fallback: CameraPoint): CameraPoint {
  const x = Number(value?.x);
  const y = Number(value?.y);
  const z = Number(value?.z);
  return {
    x: Number.isFinite(x) ? x : fallback.x,
    y: Number.isFinite(y) ? y : fallback.y,
    z: Number.isFinite(z) ? z : fallback.z,
  };
}

export function normalizeCameraState(value: Partial<CameraState> | null | undefined): CameraState {
  return {
    position: normalizeCameraPoint(value?.position, DEFAULT_CAMERA_STATE.position),
    target: normalizeCameraPoint(value?.target, DEFAULT_CAMERA_STATE.target),
  };
}

export function readGlobalSceneSettingsStorage(): GlobalSceneSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_GLOBAL_SCENE_SETTINGS;

  try {
    const saved = localStorage.getItem(GLOBAL_SCENE_SETTINGS_STORAGE_KEY);
    return normalizeGlobalSceneSettings(saved ? JSON.parse(saved) : undefined);
  } catch (error) {
    console.error('Failed to read global scene settings from storage', error);
    return DEFAULT_GLOBAL_SCENE_SETTINGS;
  }
}
