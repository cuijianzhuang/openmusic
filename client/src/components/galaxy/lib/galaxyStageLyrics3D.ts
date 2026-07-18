import * as THREE from 'three';

import type { RoomVisualFxSettings } from '../../../lib/roomVisualPreset';
import type { BeatCameraKick } from './galaxyCinema';
import type { LyricMeshGroup } from './galaxyStageLyricMaterial';

const LYRIC_GLOW_COLOR = new THREE.Color('#9cffdf');
const LYRIC_SUN_HOT = new THREE.Color('#fff4cc');

const LYRIC_CAMERA_LOCK_MAX_SCALE = 0.8;
/** 呼吸/节拍缩放余量，避免瞬时放大后边缘被裁切 */
const LYRIC_MESH_PULSE_PAD = 1.08;
const LYRIC_VIEWPORT_FIT_MIN = 0.16;

const lyricTiltEuler = new THREE.Euler();

function clampRange(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lyricViewportFit(
  camera: THREE.PerspectiveCamera,
  currentMesh: LyricMeshGroup | null,
  layoutScale: number,
  layoutX: number,
  layoutY: number,
  layoutTiltX: number,
  layoutTiltY: number,
  distance: number,
  cameraLocked: boolean,
): number {
  layoutScale = Math.max(0.1, layoutScale || 1);
  const fov = (camera.fov || 45) * (Math.PI / 180);
  const dist = Math.max(1.4, distance || 4.85);
  const visibleH = 2 * Math.tan(fov * 0.5) * dist;
  const visibleW = visibleH * (camera.aspect || window.innerWidth / Math.max(1, window.innerHeight) || 1.78);

  let maxW = 0;
  let maxH = 0;
  if (currentMesh?.userData?.lyric) {
    const d = currentMesh.userData.lyric;
    const meshScale = Math.max(
      currentMesh.scale?.x && Number.isFinite(currentMesh.scale.x) ? currentMesh.scale.x : 1,
      currentMesh.scale?.y && Number.isFinite(currentMesh.scale.y) ? currentMesh.scale.y : 1,
      LYRIC_MESH_PULSE_PAD,
    );
    maxW = (d.textWorldW || d.worldW || 6.1) * meshScale;
    maxH = (d.textWorldH || d.worldH || 1.0) * meshScale;
  }
  maxW = maxW || 5.4;
  maxH = maxH || 0.78;

  // 轻微会增加投影占用宽度，留一点斜向余量
  const tiltPad =
    1 +
    Math.abs(layoutTiltX || 0) * 0.004 +
    Math.abs(layoutTiltY || 0) * 0.006;
  maxW *= tiltPad;
  maxH *= tiltPad;

  const widthBudget = cameraLocked ? 0.84 : 0.9;
  const heightBudget = cameraLocked ? 0.44 : 0.52;
  const safeW = Math.max(visibleW * 0.36, visibleW * widthBudget - Math.abs(layoutX || 0) * 1.22);
  const safeH = Math.max(visibleH * 0.16, visibleH * heightBudget - Math.abs(layoutY || 0) * 0.82);
  const scaledW = Math.max(0.01, maxW * layoutScale);
  const scaledH = Math.max(0.01, maxH * layoutScale);
  const viewportFit = Math.min(1, safeW / scaledW, safeH / scaledH);
  const lockScaleCap = cameraLocked ? Math.min(1, LYRIC_CAMERA_LOCK_MAX_SCALE / layoutScale) : 1;
  return clampRange(Math.min(viewportFit, lockScaleCap), LYRIC_VIEWPORT_FIT_MIN, 1);
}

export type StageLyricsRuntime = {
  highBloom: number;
  beatGlow: number;
  glowFollowX: number;
  glowFollowY: number;
  glowFollowRoll: number;
  lockFitScale: number;
  starRiverWidth: number;
  starRiverHeight: number;
  snapCameraLockFrames: number;
};

export function createStageLyricsRuntime(): StageLyricsRuntime {
  return {
    highBloom: 0,
    beatGlow: 0,
    glowFollowX: 0,
    glowFollowY: 0,
    glowFollowRoll: 0,
    lockFitScale: 1,
    starRiverWidth: 3.4,
    starRiverHeight: 0.58,
    snapCameraLockFrames: 0,
  };
}

export type StageLyricStageRoot = THREE.Group & {
  userData: {
    starRiver?: THREE.Points;
    starRiverMat?: THREE.ShaderMaterial;
  };
};

function tickLyricMesh(
  mesh: LyricMeshGroup,
  dt: number,
  time: number,
  bands: { bass: number; mid: number; beat: number; energy: number },
  runtime: StageLyricsRuntime,
  fx: RoomVisualFxSettings,
  lyricGlowStrength: number,
  glowDrive: number,
  spatialAnchor: 'galaxy' | 'topography' = 'galaxy',
): void {
  mesh.userData.age += dt;
  const a = Math.min(1, mesh.userData.age / 0.52);
  const ease = a * a * (3 - 2 * a);
  const data = mesh.userData.lyric;
  const seed = mesh.userData.floatSeed || 0;

  const glowX = runtime.glowFollowX;
  const glowY = runtime.glowFollowY;
  const glowRoll = runtime.glowFollowRoll;

  if (data.glow) {
    data.glow.position.set(glowX * 0.14, glowY * 0.12, -0.006);
    data.glow.rotation.z = glowRoll * 0.3;
  }
  if (data.sun) {
    data.sun.position.set(glowX * 0.42, 0.02 + glowY * 0.34, -0.035);
    data.sun.rotation.z = glowRoll * 0.36;
  }
  if (data.sparks) {
    data.sparks.position.set(glowX * 0.24, glowY * 0.22, 0.01);
    data.sparks.rotation.z = glowRoll * 0.22;
  }

  const solar = runtime.highBloom;
  const opacityTarget = 0.96;
  const currentOpacity = data.textMat.uniforms.uOpacity.value as number;
  const opacityEase = spatialAnchor === 'topography' ? 0.28 : 0.16;
  const opacity =
    currentOpacity + (opacityTarget - currentOpacity) * opacityEase;
  data.textMat.uniforms.uOpacity.value = opacity;

  const readabilityTarget = opacity * 0.86;
  data.readabilityMat.opacity += (readabilityTarget - data.readabilityMat.opacity) * 0.16;

  const solarTarget = runtime.highBloom;
  const curSolar = data.textMat.uniforms.uSolar.value as number;
  data.textMat.uniforms.uSolar.value = curSolar + (solarTarget - curSolar) * 0.12;

  const glowTarget =
    lyricGlowStrength > 0
      ? Math.min(
          0.88,
          (0.075 + solar * 0.34 + runtime.beatGlow * 0.16) * Math.min(3, glowDrive),
        )
      : 0;
  data.glowMat.opacity +=
    (glowTarget - data.glowMat.opacity) *
    (glowTarget > data.glowMat.opacity ? 0.095 : 0.055);
  const warmth = Math.max(0, Math.min(1, solar * 1.1));
  data.glowMat.color.copy(LYRIC_GLOW_COLOR).lerp(LYRIC_SUN_HOT, warmth);

  if (data.sparkMat) {
    const sparkTarget =
      lyricGlowStrength > 0 && fx.lyricGlowParticles
        ? Math.min(0.42, (0.1 + solar * 0.14 + runtime.beatGlow * 0.1) * Math.min(1.6, glowDrive))
        : 0;
    const sparkOpacity = data.sparkMat.uniforms.uOpacity.value as number;
    data.sparkMat.uniforms.uOpacity.value +=
      (sparkTarget - sparkOpacity) * (sparkTarget > sparkOpacity ? 0.13 : 0.075);
    const sparkSizeTarget = fx.lyricGlowParticles
      ? 0.05 + solar * 0.016 + runtime.beatGlow * 0.026 + bands.bass * 0.008
      : 0.035;
    const curSize = data.sparkMat.uniforms.uSize.value as number;
    data.sparkMat.uniforms.uSize.value = curSize + (sparkSizeTarget - curSize) * 0.12;
  }

  const sunTarget =
    lyricGlowStrength > 0
      ? Math.min(
          0.88,
          (Math.pow(Math.min(1.35, solar), 1.08) * 0.28 + runtime.beatGlow * 0.2) *
            Math.min(2.4, glowDrive),
        )
      : 0;
  data.sunMat.opacity += (sunTarget - data.sunMat.opacity) * 0.055;

  if (data.sun) {
    const sunPulse = solar;
    const beatScale = fx.lyricGlowBeat ? runtime.beatGlow * 0.24 : 0;
    data.sun.scale.set(
      0.82 + sunPulse * 0.36 + beatScale + Math.sin(time * 1.6) * sunPulse * 0.018,
      0.6 + sunPulse * 0.34 + beatScale * 0.72 + Math.cos(time * 1.25) * sunPulse * 0.02,
      1,
    );
    data.sun.rotation.z += Math.sin(time * 0.32 + seed) * 0.01 * sunPulse;
  }

  const breathe = Math.sin(time * 0.92 + seed) * 0.05 + Math.sin(time * 0.41 + seed * 0.7) * 0.028;
  const beatPulse = bands.beat;
  mesh.scale.setScalar(0.96 + ease * 0.055 + breathe + bands.bass * 0.038 + beatPulse * 0.014);
  mesh.position.y += (0.18 + Math.sin(time * 0.55 + seed) * 0.055 - mesh.position.y) * 0.075;
  mesh.position.z += (1.48 + Math.cos(time * 0.48 + seed) * 0.08 - mesh.position.z) * 0.08;
  mesh.rotation.z = Math.sin(time * 0.34 + seed) * 0.018;

  if (data.sparks && data.sparkMat) {
    data.sparks.visible =
      fx.lyricGlowParticles || (data.sparkMat.uniforms.uOpacity.value as number) > 0.015;
  }
  if (data.sparks && data.basePositions) {
    const pos = data.sparks.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const base = data.basePositions;
    data.sparks.rotation.z +=
      ((fx.lyricGlowParticles ? 0.0009 : 0.00025) + runtime.beatGlow * 0.0007) * (dt * 60);
    data.sparks.rotation.x = Math.sin(time * 0.12 + seed) * 0.012;
    for (let si = 0; si < arr.length / 3; si++) {
      const s = si * 12.989 + seed;
      const particleBeat = fx.lyricGlowParticles ? runtime.beatGlow : 0;
      const dustBreath = fx.lyricGlowParticles
        ? 0.62 + 0.38 * Math.sin(time * (0.32 + (si % 7) * 0.025) + s)
        : 0.18;
      const drift = fx.lyricGlowParticles ? 1 : 0.3;
      arr[si * 3] =
        base[si * 3] +
        Math.sin(time * (0.18 + (si % 5) * 0.025) + s) *
          (0.045 + bands.bass * 0.03 + particleBeat * 0.052) *
          drift +
        Math.cos(time * 0.11 + s) * 0.018 * dustBreath;
      arr[si * 3 + 1] =
        base[si * 3 + 1] +
        Math.cos(time * (0.16 + (si % 6) * 0.024) + s) *
          (0.042 + bands.mid * 0.026 + particleBeat * 0.046) *
          drift +
        Math.sin(time * 0.13 + s) * 0.016 * dustBreath;
      arr[si * 3 + 2] =
        base[si * 3 + 2] +
        Math.sin(time * (0.24 + (si % 4) * 0.035) + s) * (0.036 + particleBeat * 0.028) * drift;
    }
    pos.needsUpdate = true;
  }
}

function updateLyricStarRiver(
  stageRoot: StageLyricStageRoot,
  currentMesh: LyricMeshGroup | null,
  dt: number,
  time: number,
  runtime: StageLyricsRuntime,
  fx: RoomVisualFxSettings,
): void {
  const river = stageRoot.userData.starRiver;
  const u = stageRoot.userData.starRiverMat?.uniforms;
  if (!river || !u) return;

  const data = currentMesh?.userData?.lyric;
  const targetW = data
    ? clampRange((data.textWorldW || data.worldW || 4.2) * 1.12 + 0.8, 2.25, 7.2)
    : 3.4;
  const targetH = data
    ? clampRange((data.textWorldH || data.worldH || 0.58) * 1.85 + 0.18, 0.52, 1.35)
    : 0.58;
  runtime.starRiverWidth += (targetW - runtime.starRiverWidth) * Math.min(1, dt * 5.2);
  runtime.starRiverHeight += (targetH - runtime.starRiverHeight) * Math.min(1, dt * 4.6);
  u.uWidth.value = runtime.starRiverWidth;
  u.uHeight.value = runtime.starRiverHeight;

  const lyricGlowStrength = fx.lyricGlow
    ? Math.min(0.85, Math.max(0, fx.lyricGlowStrength))
    : 0;
  const targetOpacity =
    currentMesh && fx.lyricGlowParticles
      ? clampRange(
          0.22 + lyricGlowStrength * 0.58 + runtime.highBloom * 0.16 + runtime.beatGlow * 0.12,
          0.16,
          0.86,
        )
      : 0;
  u.uOpacity.value +=
    (targetOpacity - u.uOpacity.value) * (targetOpacity > u.uOpacity.value ? 0.1 : 0.055);
  u.uTime.value = time;
  river.visible = (u.uOpacity.value as number) > 0.01 || !!currentMesh;
  river.position.y +=
    (0.18 + Math.sin(time * 0.44) * 0.035 + Math.sin(time * 0.91 + 1.7) * 0.018 - river.position.y) *
    0.08;
  river.position.z += (1.54 + Math.cos(time * 0.31) * 0.06 - river.position.z) * 0.08;
  river.rotation.z = Math.sin(time * 0.22) * 0.012;
}

/** Mineradio updateStageLyrics3D */
export function updateStageLyrics3D(params: {
  stageRoot: StageLyricStageRoot;
  currentMesh: LyricMeshGroup | null;
  camera: THREE.Camera;
  dt: number;
  time: number;
  bands: { bass: number; mid: number; beat: number; energy: number };
  kick: BeatCameraKick;
  fx: RoomVisualFxSettings;
  runtime: StageLyricsRuntime;
  spatialAnchor?: 'galaxy' | 'topography';
  cameraLockDistance?: number;
}): void {
  const {
    stageRoot,
    currentMesh,
    camera,
    dt,
    time,
    bands,
    kick,
    fx,
    runtime,
    spatialAnchor = 'galaxy',
    cameraLockDistance,
  } = params;
  if (!stageRoot) return;

  const lyricGlowStrength = fx.lyricGlow
    ? Math.min(0.85, Math.max(0, fx.lyricGlowStrength))
    : 0;
  const glowDrive = Math.min(1.7, Math.max(0, lyricGlowStrength / 0.5));
  const glowBreath = lyricGlowStrength > 0 ? 0.5 + 0.5 * Math.sin(time * 1.05) : 0;
  const musicBloom = Math.max(bands.beat * 0.1, bands.energy * 0.22);
  const beatGlowRaw =
    fx.lyricGlowBeat && lyricGlowStrength > 0
      ? Math.max(bands.beat * 1.22, kick.punch * 0.86 + kick.radiusKick * 1.85)
      : 0;
  runtime.beatGlow += (beatGlowRaw - runtime.beatGlow) * (beatGlowRaw > runtime.beatGlow ? 0.32 : 0.1);

  const solarBloom = lyricGlowStrength > 0
    ? (0.18 + glowBreath * 0.16 + musicBloom * 0.9 + runtime.beatGlow * 1.18 + Math.sin(time * 0.37 + 1.2) * 0.035) *
      glowDrive
    : 0;
  runtime.highBloom +=
    (Math.min(1.45, solarBloom) - runtime.highBloom) *
    (solarBloom > runtime.highBloom ? 0.075 : 0.05);

  updateLyricStarRiver(stageRoot, currentMesh, dt, time, runtime, fx);

  const followDrive = fx.lyricGlowBeat && lyricGlowStrength > 0 ? Math.min(1.35, runtime.beatGlow) : 0;
  const followXTarget = followDrive * (kick.thetaKick * 34 + kick.rollKick * 8);
  const followYTarget = followDrive * (kick.phiKick * 42 - kick.radiusKick * 0.48);
  const followRollTarget = followDrive * (kick.rollKick * 22 + kick.thetaKick * 10);
  runtime.glowFollowX += (followXTarget - runtime.glowFollowX) * 0.26;
  runtime.glowFollowY += (followYTarget - runtime.glowFollowY) * 0.24;
  runtime.glowFollowRoll += (followRollTarget - runtime.glowFollowRoll) * 0.22;
  runtime.glowFollowX *= 0.92;
  runtime.glowFollowY *= 0.92;
  runtime.glowFollowRoll *= 0.9;

  const layoutScale = clampRange(fx.lyricScale || 1, 0.35, 1.65);
  const layoutX = clampRange(fx.lyricOffsetX || 0, -2, 2);
  const layoutY = clampRange(fx.lyricOffsetY || 0, -1.2, 1.35);
  const layoutZ = clampRange(fx.lyricOffsetZ || 0, -1.6, 1.6);
  const layoutTiltX = clampRange(fx.lyricTiltX || 0, -42, 42);
  const layoutTiltY = clampRange(fx.lyricTiltY || 0, -42, 42);

  const persp = camera as THREE.PerspectiveCamera;
  const lockDistance = cameraLockDistance ?? 4.85 + layoutZ;
  const useCameraLock = spatialAnchor === 'galaxy' && fx.lyricCameraLock;
  // 无论是否开启镜头锁定，都做视口安全缩放，避免长歌词（含翻译）横向裁切
  const lockFit = persp.isPerspectiveCamera
    ? lyricViewportFit(
        persp,
        currentMesh,
        layoutScale,
        layoutX,
        layoutY,
        layoutTiltX,
        layoutTiltY,
        lockDistance,
        useCameraLock,
      )
    : 1;
  const fitEase = lockFit < runtime.lockFitScale ? 0.28 : 0.14;
  runtime.lockFitScale += (lockFit - runtime.lockFitScale) * fitEase;
  if (runtime.snapCameraLockFrames > 0) {
    runtime.lockFitScale = lockFit;
    runtime.snapCameraLockFrames -= 1;
  }
  stageRoot.scale.setScalar(layoutScale * runtime.lockFitScale);

  // stageRoot 在星河为粒子组子节点；地形模式挂 platter 子节点，随地形旋转。
  stageRoot.position.set(layoutX, layoutY, layoutZ);
  lyricTiltEuler.set(
    (layoutTiltX || 0) * (Math.PI / 180),
    (layoutTiltY || 0) * (Math.PI / 180),
    0,
    'YXZ',
  );
  stageRoot.quaternion.setFromEuler(lyricTiltEuler);

  if (currentMesh) {
    tickLyricMesh(currentMesh, dt, time, bands, runtime, fx, lyricGlowStrength, glowDrive, spatialAnchor);
  } else if (stageRoot.userData.starRiverMat) {
    stageRoot.userData.starRiverMat.uniforms.uOpacity.value = 0;
  }
}

export function snapStageLyricCameraLock(runtime: StageLyricsRuntime): void {
  runtime.snapCameraLockFrames = 3;
}
