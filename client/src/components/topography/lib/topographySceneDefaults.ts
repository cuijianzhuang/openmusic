export const TOPOGRAPHY_CAMERA_STATE_STORAGE_KEY = 'openmusic-topography-camera-state';

export interface CameraPoint {
  x: number;
  y: number;
  z: number;
}

export interface CameraState {
  position: CameraPoint;
  target: CameraPoint;
}

/** sonic-topography 默认视角 */
export const DEFAULT_TOPOGRAPHY_CAMERA_STATE: CameraState = {
  position: {
    x: -37.5836298835141,
    y: 25.718921008284557,
    z: 92.25687558089541,
  },
  target: { x: 0, y: 0, z: 0 },
};

export function normalizeCameraState(value: Partial<CameraState> | null | undefined): CameraState {
  const fb = DEFAULT_TOPOGRAPHY_CAMERA_STATE;
  const pos = value?.position;
  const tgt = value?.target;
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    position: { x: num(pos?.x, fb.position.x), y: num(pos?.y, fb.position.y), z: num(pos?.z, fb.position.z) },
    target: { x: num(tgt?.x, fb.target.x), y: num(tgt?.y, fb.target.y), z: num(tgt?.z, fb.target.z) },
  };
}
