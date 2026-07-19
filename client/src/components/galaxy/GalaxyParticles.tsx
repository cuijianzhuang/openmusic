import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { RoomVisualPresetId } from '../../lib/roomVisualPreset';
import { makeDotTexture } from './lib/dotTexture';
import { getCachedGalaxyAudioBands, resumeGalaxyAudioContext } from './lib/galaxyAudio';
import {
  buildGalaxyParticleGeometry,
  coverParticleGridForResolution as gridForResolution,
  PLANE_SIZE,
} from './lib/particleGeometry';
import {
  PARTICLE_BLOOM_FRAGMENT_SHADER,
  PARTICLE_BLOOM_VERTEX_SHADER,
  PARTICLE_FRAGMENT_SHADER,
} from './lib/shaders';
import { roomVisualFxLive } from '../../lib/roomVisualFxLive';
import { toProxiedMediaUrl } from '../../lib/mediaProxyUrl';
import { useSignedApiUrl } from '../../lib/signedApiUrl';
import { effectiveBloomStrength, syncGalaxyFxUniforms } from './lib/syncVisualUniforms';
import { buildCoverEdgeTexture } from './lib/buildCoverEdgeTexture';
import {
  cloneCoverCanvas,
  cloneEdgeCanvas,
  coverTextureSizeForResolution,
  makeSquareCoverCanvas,
  sampleCoverAccentColor,
} from './lib/coverCanvas';
import { updateLyricPaletteFromCover } from '../../lib/stageLyricPaletteLive';
import { startCoverColorMixTween } from './lib/coverColorMix';
import { tweenCoverDepthUniforms } from './lib/coverDepthTween';
import { createGalaxyRippleSystem } from './lib/galaxyRipples';
import {
  createPresetTransitionState,
  startPresetParticleTransition,
  tickPresetParticleTransition,
} from './lib/galaxyPresetTransition';
import { PARTICLE_VERTEX_SHADER } from './lib/visualVertexShader';
import {
  galaxyPointerField,
  getParticleRootGroup,
  registerParticleRootGroup,
  syncParticleGroupRotation,
} from './lib/galaxyGestureRotation';
import { updateGalaxyParticlePointerFrame } from './lib/galaxyParticlePointer';
import {
  galaxyHandGestureLive,
  registerGalaxyGestureBurst,
  tickGalaxyHandGesture,
} from './lib/galaxyHandGesture';
import { galaxyOrbitRef } from './lib/galaxyOrbit';
import GalaxyStageLyrics from './GalaxyStageLyrics';
import GalaxyFloatingSongCard from './GalaxyFloatingSongCard';

const DEFAULT_COVER = '#1c1c28';
const FLOAT_COUNT = 1300;
const BACK_COVER_COUNT = 3000;

type SharedUniforms = {
  uTime: { value: number };
  uBass: { value: number };
  uMid: { value: number };
  uTreble: { value: number };
  uBeat: { value: number };
  uEnergy: { value: number };
  uBurstAmt: { value: number };
  uPreset: { value: number };
  uIntensity: { value: number };
  uDepth: { value: number };
  uPointScale: { value: number };
  uSpeed: { value: number };
  uTwist: { value: number };
  uVinylSpin: { value: number };
  uColorBoost: { value: number };
  uScatter: { value: number };
  uCoverRes: { value: number };
  uBgFade: { value: number };
  uBloomStrength: { value: number };
  uBloomSize: { value: number };
  uHasCover: { value: number };
  uHasDepth: { value: number };
  uEdgeEnabled: { value: number };
  uAiBoost: { value: number };
  uMouseActive: { value: number };
  uMouseXY: { value: THREE.Vector2 };
  uHandXY: { value: THREE.Vector2 };
  uHandActive: { value: number };
  uGestureGrip: { value: number };
  uTintColor: { value: THREE.Color };
  uTintStrength: { value: number };
  uPixel: { value: number };
  uColorMixT: { value: number };
  uLoading: { value: number };
  uCoverTex: { value: THREE.Texture };
  uPrevCoverTex: { value: THREE.Texture };
  uEdgeTex: { value: THREE.Texture };
  uPrevEdgeTex: { value: THREE.Texture };
  uRippleTex: { value: THREE.Texture };
  uRippleCount: { value: number };
  uDotTex: { value: THREE.Texture };
  uAlpha: { value: number };
  uParticleDim: { value: number };
  uFloatAlpha: { value: number };
};

function makePlaceholderTexture(color = DEFAULT_COVER): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 4, 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function makeEdgePlaceholderTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(128,0,0,255)';
    ctx.fillRect(0, 0, 4, 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function applyCoverTextureSettings(tex: THREE.Texture): void {
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
}

/** 尺寸变化时必须新建纹理，禁止改 image 后 needsUpdate（会触发 copySubTexture 溢出） */
function replacePrevCanvasTexture(
  ref: { current: THREE.Texture },
  canvas: HTMLCanvasElement,
  kind: 'cover' | 'edge',
): THREE.CanvasTexture {
  const next = new THREE.CanvasTexture(canvas);
  if (kind === 'cover') {
    applyCoverTextureSettings(next);
  } else {
    next.minFilter = THREE.LinearFilter;
    next.magFilter = THREE.LinearFilter;
  }
  next.needsUpdate = true;
  const prev = ref.current;
  ref.current = next;
  if (prev && prev !== next) prev.dispose();
  return next;
}

function createFloatLayer(uniforms: SharedUniforms) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(FLOAT_COUNT * 3);
  const phases = new Float32Array(FLOAT_COUNT * 3);
  const colors = new Float32Array(FLOAT_COUNT * 3);
  const rand = new Float32Array(FLOAT_COUNT);
  const amps = new Float32Array(FLOAT_COUNT);
  const sampleU = new Float32Array(FLOAT_COUNT);
  const sampleV = new Float32Array(FLOAT_COUNT);

  for (let i = 0; i < FLOAT_COUNT; i++) {
    const halo = i < FLOAT_COUNT * 0.76;
    let bx: number;
    let by: number;
    let bz: number;
    if (halo) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.62 + Math.pow(Math.random(), 0.72) * 2.75;
      const lane = (Math.random() - 0.5) * 0.62;
      bx = Math.cos(angle) * radius;
      by = Math.sin(angle) * radius * 0.54 + lane;
      bz = (Math.random() - 0.5) * 2.4 - 0.25;
    } else {
      bx = (Math.random() - 0.5) * 8.4;
      by = (Math.random() - 0.5) * 5.8;
      bz = (Math.random() - 0.5) * 5.6;
    }
    positions[i * 3] = bx;
    positions[i * 3 + 1] = by;
    positions[i * 3 + 2] = bz;
    phases[i * 3] = Math.random() * Math.PI * 2;
    phases[i * 3 + 1] = Math.random() * Math.PI * 2;
    phases[i * 3 + 2] = Math.random() * Math.PI * 2;
    amps[i] = 0.15 + Math.random() * 0.35;
    const white = 0.88 + Math.random() * 0.12;
    colors[i * 3] = white;
    colors[i * 3 + 1] = white;
    colors[i * 3 + 2] = white;
    rand[i] = Math.random();
    sampleU[i] = Math.random();
    sampleV[i] = Math.random();
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  geometry.setAttribute('aAmp', new THREE.BufferAttribute(amps, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 3));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uBass: uniforms.uBass,
      uPixel: uniforms.uPixel,
      uDotTex: uniforms.uDotTex,
      uFloatAlpha: uniforms.uFloatAlpha,
    },
    vertexShader: `
precision highp float;
uniform float uTime, uBass, uPixel, uFloatAlpha;
attribute vec3 aColor;
attribute vec3 aPhase;
attribute float aRand, aAmp;
varying vec3 vC;
varying float vA;
void main(){
  vec3 pos = position;
  float orbit = uTime * (0.030 + aRand * 0.034);
  float cs = cos(orbit), sn = sin(orbit);
  pos.xy = mat2(cs, -sn, sn, cs) * pos.xy;
  float breathe = 1.0 + sin(uTime * 0.34 + aPhase.x) * 0.045;
  pos.xy *= breathe;
  pos.x += sin(uTime * (0.18 + aRand * 0.05) + aPhase.x) * aAmp * 0.34;
  pos.y += cos(uTime * (0.15 + aRand * 0.06) + aPhase.y) * aAmp * 0.30;
  pos.z += sin(uTime * (0.11 + aRand * 0.04) + aPhase.z) * aAmp * 0.68 + uBass * 0.10 * sin(aRand * 12.0);
  vC = aColor;
  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  float dist = -mvPos.z;
  float twinkle = 0.62 + 0.38 * sin(uTime * (0.42 + aRand * 0.34) + aPhase.z);
  vA = clamp(0.22 + (5.0 - dist) * 0.10, 0.055, 0.58) * twinkle;
  float sz = clamp(40.0 / max(0.5, dist), 1.3, 4.1);
  gl_PointSize = sz * uPixel;
  gl_Position = projectionMatrix * mvPos;
}`,
    fragmentShader: `
precision highp float;
uniform sampler2D uDotTex;
uniform float uFloatAlpha;
varying vec3 vC;
varying float vA;
void main(){
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.02) discard;
  gl_FragColor = vec4(vC, tex.a * vA * uFloatAlpha);
}`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 1;

  const refreshColorsFromCover = (coverCanvas: HTMLCanvasElement) => {
    const ctx = coverCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const img = ctx.getImageData(0, 0, coverCanvas.width, coverCanvas.height).data;
    const w = coverCanvas.width;
    const h = coverCanvas.height;
    for (let i = 0; i < FLOAT_COUNT; i++) {
      const sx = Math.min(w - 1, Math.max(0, Math.floor(sampleU[i] * w)));
      const sy = Math.min(h - 1, Math.max(0, Math.floor(sampleV[i] * h)));
      const di = (sy * w + sx) * 4;
      colors[i * 3] = (img[di] / 255) * 0.95;
      colors[i * 3 + 1] = (img[di + 1] / 255) * 0.95;
      colors[i * 3 + 2] = (img[di + 2] / 255) * 0.95;
    }
    geometry.attributes.aColor.needsUpdate = true;
  };

  return {
    points,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
    refreshColorsFromCover,
  };
}

function createBackCoverLayer(uniforms: SharedUniforms) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(BACK_COVER_COUNT * 3);
  const colors = new Float32Array(BACK_COVER_COUNT * 3);
  const rand = new Float32Array(BACK_COVER_COUNT);
  const uvs = new Float32Array(BACK_COVER_COUNT * 2);

  for (let i = 0; i < BACK_COVER_COUNT; i++) {
    const u = Math.random();
    const v = Math.random();
    positions[i * 3] = (u - 0.5) * PLANE_SIZE;
    positions[i * 3 + 1] = (v - 0.5) * PLANE_SIZE;
    positions[i * 3 + 2] = -1.5 - Math.random() * 0.4;
    uvs[i * 2] = 1 - u;
    uvs[i * 2 + 1] = v;
    rand[i] = Math.random();
    colors[i * 3] = 0.7;
    colors[i * 3 + 1] = 0.6;
    colors[i * 3 + 2] = 0.8;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  geometry.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uBass: uniforms.uBass,
      uPixel: uniforms.uPixel,
      uDotTex: uniforms.uDotTex,
      uAlpha: uniforms.uAlpha,
    },
    vertexShader: `
precision highp float;
uniform float uTime, uBass, uPixel, uAlpha;
attribute vec3 aColor;
attribute vec2 aUv;
attribute float aRand;
varying vec3 vC;
varying float vA;
void main(){
  vec3 pos = position;
  pos.x += sin(uTime * 0.20 + aRand * 8.0) * 0.20;
  pos.y += cos(uTime * 0.18 + aRand * 6.0) * 0.22;
  pos.z += sin(uTime * 0.12 + aRand * 5.0) * 0.18 + uBass * 0.12 * sin(aRand * 11.0);
  vC = aColor;
  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  float dist = -mvPos.z;
  vA = clamp(0.30 + 0.4 * sin(uTime * 0.6 + aRand * 5.0), 0.10, 0.65);
  float sz = clamp(46.0 / max(0.5, dist), 1.4, 4.5);
  gl_PointSize = sz * uPixel;
  gl_Position = projectionMatrix * mvPos;
}`,
    fragmentShader: `
precision highp float;
uniform sampler2D uDotTex;
uniform float uAlpha;
varying vec3 vC;
varying float vA;
void main(){
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.02) discard;
  gl_FragColor = vec4(vC, tex.a * vA * uAlpha);
}`,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 0;

  const refreshColorsFromCover = (coverCanvas: HTMLCanvasElement) => {
    const ctx = coverCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const img = ctx.getImageData(0, 0, coverCanvas.width, coverCanvas.height).data;
    const w = coverCanvas.width;
    const h = coverCanvas.height;
    for (let i = 0; i < BACK_COVER_COUNT; i++) {
      const u = uvs[i * 2];
      const v = uvs[i * 2 + 1];
      const sx = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
      const sy = Math.min(h - 1, Math.max(0, Math.floor(v * h)));
      const di = (sy * w + sx) * 4;
      colors[i * 3] = (img[di] / 255) * 0.85;
      colors[i * 3 + 1] = (img[di + 1] / 255) * 0.85;
      colors[i * 3 + 2] = (img[di + 2] / 255) * 0.85;
    }
    geometry.attributes.aColor.needsUpdate = true;
  };

  return {
    points,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
    refreshColorsFromCover,
  };
}

interface Props {
  coverUrl?: string | null;
  preset: RoomVisualPresetId;
  isPlaying: boolean;
}

export default function GalaxyParticles({ coverUrl, preset, isPlaying }: Props) {
  const proxiedCover = useMemo(
    () => (coverUrl ? toProxiedMediaUrl(coverUrl) : null),
    [coverUrl],
  );
  const signedCover = useSignedApiUrl(proxiedCover);
  const invalidate = useThree((state) => state.invalidate);
  const [particleGrid, setParticleGrid] = useState(() =>
    gridForResolution(roomVisualFxLive.current.coverResolution),
  );
  const geometry = useMemo(() => buildGalaxyParticleGeometry(particleGrid), [particleGrid]);
  const bloomGeometry = useMemo(() => geometry.clone(), [geometry]);
  const dotTex = useMemo(() => makeDotTexture(), []);
  const rippleSystem = useMemo(() => createGalaxyRippleSystem(), []);
  const edgeTexRef = useRef<THREE.Texture>(makeEdgePlaceholderTexture());
  const coverTex = useRef<THREE.Texture>(makePlaceholderTexture());
  const prevCoverTex = useRef<THREE.Texture>(makePlaceholderTexture());
  const prevEdgeTex = useRef<THREE.Texture>(makeEdgePlaceholderTexture());
  const presetRef = useRef(preset);
  const bloomRef = useRef<THREE.Points>(null);
  const floatRef = useRef<THREE.Points | null>(null);
  const backCoverRef = useRef<THREE.Points | null>(null);
  const depthTweenCancelRef = useRef<(() => void) | null>(null);
  const colorMixCancelRef = useRef<(() => void) | null>(null);
  const coverImageCacheRef = useRef<HTMLImageElement | null>(null);
  const gridRef = useRef(particleGrid);
  const vinylSpinRef = useRef(0);
  const presetTransitionRef = useRef(createPresetTransitionState());

  const uniforms = useRef<SharedUniforms>({
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uTreble: { value: 0 },
    uBeat: { value: 0 },
    uEnergy: { value: 0 },
    uBurstAmt: { value: 0 },
    uPreset: { value: preset },
    uIntensity: { value: roomVisualFxLive.current.intensity },
    uDepth: { value: roomVisualFxLive.current.depth },
    uPointScale: { value: roomVisualFxLive.current.point },
    uSpeed: { value: roomVisualFxLive.current.speed },
    uTwist: { value: roomVisualFxLive.current.twist },
    uVinylSpin: { value: 0 },
    uColorBoost: { value: roomVisualFxLive.current.colorBoost },
    uScatter: { value: roomVisualFxLive.current.scatter },
    uCoverRes: { value: roomVisualFxLive.current.coverResolution },
    uBgFade: { value: roomVisualFxLive.current.bgFade },
    uBloomStrength: { value: effectiveBloomStrength(roomVisualFxLive.current) },
    uBloomSize: { value: 2.65 },
    uHasCover: { value: 0 },
    uHasDepth: { value: 0 },
    uEdgeEnabled: { value: roomVisualFxLive.current.edge ? 1 : 0 },
    uAiBoost: { value: 0 },
    uMouseActive: { value: 0 },
    uMouseXY: { value: new THREE.Vector2(-999, -999) },
    uHandXY: { value: new THREE.Vector2(-999, -999) },
    uHandActive: { value: 0 },
    uGestureGrip: { value: 0 },
    uTintColor: { value: new THREE.Color(roomVisualFxLive.current.visualTintColor) },
    uTintStrength: { value: roomVisualFxLive.current.visualTintMode === 'custom' ? 0.42 : 0.38 },
    uPixel: { value: Math.min(window.devicePixelRatio || 1, 1.75) },
    uColorMixT: { value: 1 },
    uLoading: { value: 0 },
    uCoverTex: { value: coverTex.current },
    uPrevCoverTex: { value: prevCoverTex.current },
    uEdgeTex: { value: edgeTexRef.current },
    uPrevEdgeTex: { value: prevEdgeTex.current },
    uRippleTex: { value: rippleSystem.texture },
    uRippleCount: { value: 0 },
    uDotTex: { value: dotTex },
    uAlpha: { value: 0 },
    uParticleDim: { value: 1 },
    uFloatAlpha: { value: 0 },
  }).current;

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: PARTICLE_VERTEX_SHADER,
        fragmentShader: PARTICLE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
      }),
    [uniforms],
  );

  const bloomMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: PARTICLE_BLOOM_VERTEX_SHADER,
        fragmentShader: PARTICLE_BLOOM_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  );

  const floatLayer = useMemo(() => createFloatLayer(uniforms), [uniforms]);
  const backCoverLayer = useMemo(() => createBackCoverLayer(uniforms), [uniforms]);

  useEffect(() => {
    floatRef.current = floatLayer.points;
    backCoverRef.current = backCoverLayer.points;
    return () => {
      floatRef.current = null;
      backCoverRef.current = null;
    };
  }, [backCoverLayer.points, floatLayer.points]);

  useEffect(() => {
    registerGalaxyGestureBurst((amount) => {
      uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value as number, amount);
    });
    return () => registerGalaxyGestureBurst(null);
  }, [uniforms]);

  useEffect(() => {
    if (presetRef.current !== preset) {
      const fromPreset = presetRef.current;
      presetRef.current = preset;
      startPresetParticleTransition(
        presetTransitionRef.current,
        fromPreset,
        preset,
        uniforms.uTime.value,
        uniforms,
        roomVisualFxLive.current,
      );
      if (preset === 0) {
        rippleSystem.burst(3);
      } else {
        rippleSystem.reset();
      }
    }
    uniforms.uPreset.value = preset;
  }, [preset, rippleSystem, uniforms]);

  useEffect(() => {
    depthTweenCancelRef.current?.();
    depthTweenCancelRef.current = null;
    colorMixCancelRef.current?.();
    colorMixCancelRef.current = null;

    const applyLoadedCover = (img: HTMLImageElement) => {
      const fx = roomVisualFxLive.current;
      const texSize = coverTextureSizeForResolution(fx.coverResolution);
      const hasPrevCover = uniforms.uHasCover.value > 0.5 && coverTex.current?.image;

      if (hasPrevCover) {
        const prevCoverCv = cloneCoverCanvas(coverTex.current.image as CanvasImageSource);
        if (prevCoverCv) {
          uniforms.uPrevCoverTex.value = replacePrevCanvasTexture(
            prevCoverTex,
            prevCoverCv,
            'cover',
          );
        }
        const prevEdgeImg = edgeTexRef.current?.image;
        if (prevEdgeImg instanceof HTMLCanvasElement && prevEdgeImg.width > 4) {
          const prevEdgeCv = cloneEdgeCanvas(prevEdgeImg);
          if (prevEdgeCv) {
            uniforms.uPrevEdgeTex.value = replacePrevCanvasTexture(
              prevEdgeTex,
              prevEdgeCv,
              'edge',
            );
          }
        }
      }

      const cv = makeSquareCoverCanvas(img, texSize);
      const prevMain = coverTex.current;
      const tex = new THREE.CanvasTexture(cv);
      applyCoverTextureSettings(tex);
      tex.needsUpdate = true;
      coverTex.current = tex;
      uniforms.uCoverTex.value = tex;
      uniforms.uHasCover.value = 1;

      if (fx.visualTintMode === 'auto') {
        (uniforms.uTintColor.value as THREE.Color).set(sampleCoverAccentColor(cv));
      }

      updateLyricPaletteFromCover(cv);

      floatLayer.refreshColorsFromCover(cv);
      backCoverLayer.refreshColorsFromCover(cv);

      const edgeCanvas = buildCoverEdgeTexture(cv);
      const prevEdge = edgeTexRef.current;
      const nextEdge = new THREE.CanvasTexture(edgeCanvas);
      nextEdge.minFilter = THREE.LinearFilter;
      nextEdge.magFilter = THREE.LinearFilter;
      nextEdge.needsUpdate = true;
      edgeTexRef.current = nextEdge;
      uniforms.uEdgeTex.value = nextEdge;

      const mixMs = preset === 0 ? 520 : 1400;
      depthTweenCancelRef.current?.();
      if (hasPrevCover) {
        uniforms.uHasDepth.value = 1;
        uniforms.uAiBoost.value = 0.55;
      } else {
        depthTweenCancelRef.current = tweenCoverDepthUniforms(uniforms, 1, 0.55, 180);
      }

      colorMixCancelRef.current?.();
      if (hasPrevCover) {
        colorMixCancelRef.current = startCoverColorMixTween(uniforms, mixMs);
      } else {
        uniforms.uColorMixT.value = 1;
      }

      if (prevMain && prevMain !== prevCoverTex.current) prevMain.dispose();
      if (prevEdge && prevEdge !== nextEdge && prevEdge !== prevEdgeTex.current) prevEdge.dispose();
    };

    if (!signedCover) {
      coverImageCacheRef.current = null;
      uniforms.uHasDepth.value = 0;
      uniforms.uAiBoost.value = 0;
      const placeholder = makePlaceholderTexture();
      applyCoverTextureSettings(placeholder);
      coverTex.current = placeholder;
      uniforms.uCoverTex.value = placeholder;
      uniforms.uHasCover.value = 0;
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      if (cancelled) return;
      coverImageCacheRef.current = img;
      applyLoadedCover(img);
      // 暂停时为 demand 帧循环，封面纹理就绪后需请求一帧才能显示。
      invalidate();
    };
    img.onerror = () => {
      if (cancelled) return;
      coverImageCacheRef.current = null;
      const placeholder = makePlaceholderTexture();
      applyCoverTextureSettings(placeholder);
      coverTex.current = placeholder;
      uniforms.uCoverTex.value = placeholder;
      uniforms.uHasCover.value = 0;
      uniforms.uHasDepth.value = 0;
      invalidate();
    };
    img.src = signedCover;

    return () => {
      cancelled = true;
      depthTweenCancelRef.current?.();
      depthTweenCancelRef.current = null;
      colorMixCancelRef.current?.();
      colorMixCancelRef.current = null;
      img.onload = null;
      img.onerror = null;
    };
  }, [backCoverLayer, signedCover, floatLayer, preset, uniforms, invalidate]);

  useFrame((state, delta) => {
    updateGalaxyParticlePointerFrame(state.camera);
    const currentFx = roomVisualFxLive.current;
    syncGalaxyFxUniforms(uniforms, currentFx);
    (uniforms.uMouseXY.value as THREE.Vector2).set(galaxyPointerField.x, galaxyPointerField.y);
    uniforms.uMouseActive.value = galaxyPointerField.active ? 1 : 0;

    tickGalaxyHandGesture(delta);
    const hand = galaxyHandGestureLive;
    (uniforms.uHandXY.value as THREE.Vector2).lerp(
      new THREE.Vector2(hand.handX, hand.handY),
      Math.min(1, delta * 9),
    );
    uniforms.uHandActive.value += (hand.handActive - (uniforms.uHandActive.value as number)) * Math.min(1, delta * 7.5);
    uniforms.uGestureGrip.value += (hand.gestureGrip - (uniforms.uGestureGrip.value as number)) * Math.min(1, delta * 8);

    const nextGrid = gridForResolution(currentFx.coverResolution);
    if (nextGrid !== gridRef.current) {
      gridRef.current = nextGrid;
      setParticleGrid(nextGrid);
      const cached = coverImageCacheRef.current;
      if (cached && uniforms.uHasCover.value > 0.5) {
        const prevCoverCv = cloneCoverCanvas(coverTex.current.image as CanvasImageSource);
        if (prevCoverCv) {
          uniforms.uPrevCoverTex.value = replacePrevCanvasTexture(
            prevCoverTex,
            prevCoverCv,
            'cover',
          );
        }
        const prevEdgeImg = edgeTexRef.current?.image;
        if (prevEdgeImg instanceof HTMLCanvasElement && prevEdgeImg.width > 4) {
          const prevEdgeCv = cloneEdgeCanvas(prevEdgeImg);
          if (prevEdgeCv) {
            uniforms.uPrevEdgeTex.value = replacePrevCanvasTexture(
              prevEdgeTex,
              prevEdgeCv,
              'edge',
            );
          }
        }

        const texSize = coverTextureSizeForResolution(currentFx.coverResolution);
        const cv = makeSquareCoverCanvas(cached, texSize);
        if (currentFx.visualTintMode === 'auto') {
          (uniforms.uTintColor.value as THREE.Color).set(sampleCoverAccentColor(cv));
        }
        const prevMain = coverTex.current;
        const tex = new THREE.CanvasTexture(cv);
        applyCoverTextureSettings(tex);
        tex.needsUpdate = true;
        coverTex.current = tex;
        uniforms.uCoverTex.value = tex;
        floatLayer.refreshColorsFromCover(cv);
        backCoverLayer.refreshColorsFromCover(cv);
        const edgeCanvas = buildCoverEdgeTexture(cv);
        const prevEdge = edgeTexRef.current;
        const nextEdge = new THREE.CanvasTexture(edgeCanvas);
        nextEdge.minFilter = THREE.LinearFilter;
        nextEdge.magFilter = THREE.LinearFilter;
        nextEdge.needsUpdate = true;
        edgeTexRef.current = nextEdge;
        uniforms.uEdgeTex.value = nextEdge;
        colorMixCancelRef.current?.();
        colorMixCancelRef.current = startCoverColorMixTween(
          uniforms,
          preset === 0 ? 520 : 1400,
        );
        if (prevMain && prevMain !== prevCoverTex.current) prevMain.dispose();
        if (prevEdge && prevEdge !== nextEdge && prevEdge !== prevEdgeTex.current) prevEdge.dispose();
      }
    }

    resumeGalaxyAudioContext();
    const bands = getCachedGalaxyAudioBands();
    const elapsed = state.clock.elapsedTime;
    uniforms.uTime.value = elapsed;
    uniforms.uBass.value = bands.bass;
    uniforms.uMid.value = bands.mid;
    uniforms.uTreble.value = bands.treble;
    uniforms.uBeat.value = bands.beat;
    uniforms.uEnergy.value = bands.energy;
    uniforms.uPixel.value = state.gl.getPixelRatio();

    const vinylSpeedMul = Math.max(0.05, currentFx.speed);
    const vinylSpinSpeed = (0.4 + bands.smoothBass * 0.09) * vinylSpeedMul;
    if (isPlaying) {
      vinylSpinRef.current =
        (vinylSpinRef.current + delta * vinylSpinSpeed) % (Math.PI * 2);
    } else {
      vinylSpinRef.current =
        (vinylSpinRef.current + delta * 0.05 * vinylSpeedMul) % (Math.PI * 2);
    }
    uniforms.uVinylSpin.value = vinylSpinRef.current;

    if (preset === 0) {
      rippleSystem.update(delta, bands.rippleBass, elapsed, uniforms);
    } else {
      uniforms.uRippleCount.value = 0;
    }

    tickPresetParticleTransition(
      presetTransitionRef.current,
      elapsed,
      uniforms,
      currentFx,
    );

    const emilyLayers = preset === 0;
    const floatAlphaTarget = preset === 0 ? 0.92 : preset >= 4 ? 0.72 : 0.82;
    uniforms.uFloatAlpha.value +=
      (floatAlphaTarget - uniforms.uFloatAlpha.value) * Math.min(1, delta * 3.2);

    if (bloomRef.current) {
      bloomRef.current.visible = effectiveBloomStrength(currentFx) > 0;
    }
    if (floatRef.current) {
      floatRef.current.visible = emilyLayers && currentFx.floatLayer;
    }
    if (backCoverRef.current) {
      backCoverRef.current.visible = emilyLayers;
    }

    uniforms.uBurstAmt.value *= 0.9;

    // 淡入不能依赖播放状态：暂停时进入沉浸也必须让粒子可见，否则 uAlpha 停在 0 会黑屏。
    if (uniforms.uAlpha.value < 1) {
      uniforms.uAlpha.value = Math.min(1, uniforms.uAlpha.value + delta / 0.26);
      // demand 帧循环（暂停时）不会自动持续出帧，需主动请求下一帧完成淡入。
      invalidate();
    }

    syncParticleGroupRotation(delta, galaxyOrbitRef.current.centerLocked);

    const particleRoot = getParticleRootGroup();
    if (particleRoot && floatRef.current) {
      floatRef.current.rotation.copy(particleRoot.rotation);
    }
  });

  useEffect(
    () => () => {
      depthTweenCancelRef.current?.();
      colorMixCancelRef.current?.();
      rippleSystem.texture.dispose();
      geometry.dispose();
      bloomGeometry.dispose();
      material.dispose();
      bloomMaterial.dispose();
      floatLayer.dispose();
      backCoverLayer.dispose();
      dotTex.dispose();
      edgeTexRef.current.dispose();
      coverTex.current.dispose();
      prevCoverTex.current.dispose();
      prevEdgeTex.current.dispose();
    },
    [backCoverLayer, bloomGeometry, bloomMaterial, dotTex, floatLayer, geometry, material, rippleSystem],
  );

  return (
    <group ref={(node) => registerParticleRootGroup(node)}>
      <GalaxyFloatingSongCard />
      <GalaxyStageLyrics isPlaying={isPlaying} />
      <primitive object={backCoverLayer.points} />
      <points
        ref={bloomRef}
        geometry={bloomGeometry}
        material={bloomMaterial}
        frustumCulled={false}
        renderOrder={0}
      />
      <points geometry={geometry} material={material} frustumCulled={false} renderOrder={1} />
      <primitive object={floatLayer.points} />
    </group>
  );
}
