import * as THREE from 'three';
import type { RoomVisualPresetId } from '../../../lib/roomVisualPreset';
import type { BeatCameraKick } from './galaxyCinema';

const BASE_FOV = 45;

export const GALAXY_PRESET_CAMERA: Record<
  RoomVisualPresetId,
  { radius: number; phi: number; theta: number }
> = {
  0: { radius: 6.6, phi: 0.08, theta: 0 },
  1: { radius: 6.2, phi: 0.03, theta: 0 },
  2: { radius: 7.0, phi: 0.15, theta: 0 },
  3: { radius: 8.0, phi: 0.05, theta: 0 },
  4: { radius: 6.5, phi: 0.04, theta: 0 },
  5: { radius: 9.4, phi: 0.34, theta: -0.52 },
  6: { radius: 9.4, phi: 0.34, theta: -0.52 },
};

function clampRange(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export type GalaxyOrbitState = {
  userTheta: number;
  userPhi: number;
  userRadius: number;
  cineTheta: number;
  cinePhi: number;
  cineRadius: number;
  theta: number;
  phi: number;
  radius: number;
  baselineTheta: number;
  baselinePhi: number;
  baselineRadius: number;
  minPhi: number;
  maxPhi: number;
  minRadius: number;
  maxRadius: number;
  rotating: boolean;
  last: { x: number; y: number };
  recentering: boolean;
  centerLocked: boolean;
  lookAt: THREE.Vector3;
  focusZone: {
    type: 'none' | 'search' | 'queue' | 'chat' | 'cardHover';
    theta: number;
    phi: number;
    radius: number;
    lookAt: THREE.Vector3;
    ease: number;
  };
};

export function createGalaxyOrbitState(
  preset: RoomVisualPresetId = 0,
): GalaxyOrbitState {
  const base = GALAXY_PRESET_CAMERA[preset];
  return {
    userTheta: base.theta,
    userPhi: base.phi,
    userRadius: base.radius,
    cineTheta: 0,
    cinePhi: 0,
    cineRadius: 0,
    theta: base.theta,
    phi: base.phi,
    radius: base.radius,
    baselineTheta: base.theta,
    baselinePhi: base.phi,
    baselineRadius: base.radius,
    minPhi: -Math.PI * 0.45,
    maxPhi: Math.PI * 0.45,
    minRadius: 2.4,
    maxRadius: 14.0,
    rotating: false,
    last: { x: 0, y: 0 },
    recentering: false,
    centerLocked: false,
    lookAt: new THREE.Vector3(0, 0, 0),
    focusZone: {
      type: 'none',
      theta: base.theta,
      phi: base.phi,
      radius: base.radius,
      lookAt: new THREE.Vector3(0, 0, 0),
      ease: 0.1,
    },
  };
}

export function setGalaxyOrbitPreset(orbit: GalaxyOrbitState, preset: RoomVisualPresetId): void {
  const base = GALAXY_PRESET_CAMERA[preset];
  orbit.userTheta = base.theta;
  orbit.userPhi = base.phi;
  orbit.userRadius = base.radius;
  orbit.baselineTheta = base.theta;
  orbit.baselinePhi = base.phi;
  orbit.baselineRadius = base.radius;
}

export function unlockGalaxyOrbitCenter(orbit: GalaxyOrbitState): void {
  orbit.centerLocked = false;
}

export function recenterGalaxyOrbit(orbit: GalaxyOrbitState): void {
  orbit.centerLocked = true;
  orbit.recentering = true;
}

export function setGalaxyOrbitFocusZone(
  orbit: GalaxyOrbitState,
  type: GalaxyOrbitState['focusZone']['type'],
  config?: Partial<Omit<GalaxyOrbitState['focusZone'], 'type'>>,
): void {
  if (type === 'none') {
    orbit.focusZone.type = 'none';
    return;
  }
  orbit.focusZone.type = type;
  if (config?.theta !== undefined) orbit.focusZone.theta = config.theta;
  if (config?.phi !== undefined) orbit.focusZone.phi = config.phi;
  if (config?.radius !== undefined) orbit.focusZone.radius = config.radius;
  if (config?.lookAt) orbit.focusZone.lookAt.copy(config.lookAt);
  if (config?.ease !== undefined) orbit.focusZone.ease = config.ease;
}

/** Mineradio updateCinema → orbit.cine* */
export function applyGalaxyOrbitCinema(
  orbit: GalaxyOrbitState,
  cinemaT: number,
  kick: BeatCameraKick,
  cinemaShake: number,
): void {
  const shake = clampRange(cinemaShake, 0, 1.8);
  const beatDamp = shake;
  const idleDamp = shake;
  orbit.cineTheta = Math.sin(cinemaT * 0.08) * 0.012 * idleDamp + kick.thetaKick * beatDamp;
  orbit.cinePhi = Math.sin(cinemaT * 0.06 + 1.0) * 0.01 * idleDamp + kick.phiKick * beatDamp;
  orbit.cineRadius =
    Math.sin(cinemaT * 0.04 + 2.0) * 0.08 * idleDamp - kick.radiusKick * beatDamp * 1.18;
}

/** Mineradio updateCamera（不含 freeCamera / shelf focus） */
export function updateGalaxyOrbitCamera(
  camera: THREE.PerspectiveCamera,
  orbit: GalaxyOrbitState,
  kick: BeatCameraKick,
  cinemaShake: number,
  cameraDistanceMul = 1,
): void {
  if (orbit.recentering) {
    orbit.userTheta += (orbit.baselineTheta - orbit.userTheta) * 0.04;
    orbit.userPhi += (orbit.baselinePhi - orbit.userPhi) * 0.04;
    orbit.userRadius += (orbit.baselineRadius - orbit.userRadius) * 0.04;
    if (
      Math.abs(orbit.userTheta - orbit.baselineTheta) < 0.005 &&
      Math.abs(orbit.userPhi - orbit.baselinePhi) < 0.005 &&
      Math.abs(orbit.userRadius - orbit.baselineRadius) < 0.05
    ) {
      orbit.userTheta = orbit.baselineTheta;
      orbit.userPhi = orbit.baselinePhi;
      orbit.userRadius = orbit.baselineRadius;
      orbit.recentering = false;
    }
  }

  let targetTheta: number;
  let targetPhi: number;
  let targetRadius: number;
  let tLookAt = orbit.lookAt;

  if (orbit.focusZone.type !== 'none') {
    targetTheta = orbit.focusZone.theta;
    targetPhi = clampRange(orbit.focusZone.phi, orbit.minPhi, orbit.maxPhi);
    targetRadius = clampRange(orbit.focusZone.radius, orbit.minRadius, orbit.maxRadius);
    tLookAt = orbit.focusZone.lookAt;
  } else if (orbit.centerLocked) {
    targetTheta = orbit.baselineTheta + orbit.cineTheta;
    targetPhi = clampRange(orbit.baselinePhi + orbit.cinePhi, orbit.minPhi, orbit.maxPhi);
    targetRadius = clampRange(
      orbit.baselineRadius * cameraDistanceMul + orbit.cineRadius,
      orbit.minRadius,
      orbit.maxRadius,
    );
  } else {
    targetTheta = orbit.userTheta + orbit.cineTheta;
    targetPhi = clampRange(orbit.userPhi + orbit.cinePhi, orbit.minPhi, orbit.maxPhi);
    targetRadius = clampRange(
      orbit.userRadius * cameraDistanceMul + orbit.cineRadius,
      orbit.minRadius,
      orbit.maxRadius,
    );
  }

  let focusEase = orbit.focusZone.type !== 'none' ? orbit.focusZone.ease : 0.1;
  let radiusEase = 0.07;
  if (kick.punch > 0.01) {
    focusEase = Math.max(focusEase, 0.12 + kick.punch * 0.12);
    radiusEase = Math.max(radiusEase, 0.09 + kick.punch * 0.12);
  }

  orbit.theta += (targetTheta - orbit.theta) * focusEase;
  orbit.phi += (targetPhi - orbit.phi) * focusEase;
  orbit.radius += (targetRadius - orbit.radius) * radiusEase;
  orbit.lookAt.x += (tLookAt.x - orbit.lookAt.x) * focusEase;
  orbit.lookAt.y += (tLookAt.y - orbit.lookAt.y) * focusEase;
  orbit.lookAt.z += (tLookAt.z - orbit.lookAt.z) * focusEase;

  const cy = Math.cos(orbit.phi);
  const sy = Math.sin(orbit.phi);
  const ct = Math.cos(orbit.theta);
  const st = Math.sin(orbit.theta);
  camera.position.set(
    orbit.lookAt.x + orbit.radius * cy * st,
    orbit.lookAt.y + orbit.radius * sy,
    orbit.lookAt.z + orbit.radius * cy * ct,
  );
  camera.lookAt(orbit.lookAt);
  camera.rotation.z += kick.rollKick * clampRange(cinemaShake, 0, 1.8);

  const shake = clampRange(cinemaShake, 0, 1.8);
  const cameraPunch = (kick.punch * 0.54 + kick.radiusKick * 0.16) * shake;
  const targetFov = BASE_FOV - cameraPunch * 2.35;
  const fovEase = targetFov < camera.fov ? 0.24 : 0.12;
  camera.fov += (targetFov - camera.fov) * fovEase;
  camera.updateProjectionMatrix();
}

export function zoomGalaxyOrbit(orbit: GalaxyOrbitState, deltaY: number): void {
  orbit.userRadius = clampRange(
    orbit.userRadius + deltaY * 0.005,
    orbit.minRadius,
    orbit.maxRadius,
  );
  if (orbit.recentering) orbit.recentering = false;
}

export const galaxyOrbitRef: { current: GalaxyOrbitState } = {
  current: createGalaxyOrbitState(0),
};
