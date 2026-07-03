import * as THREE from 'three';

import { roomVisualFxLive } from '../../../lib/roomVisualFxLive';
import { stageLyricPaletteLive } from '../../../lib/stageLyricPaletteLive';
import {
  drawTextWithLetterSpacing,
  lyricFontCss,
  lyricLetterSpacingPx,
  normalizeLyricFontKey,
} from '../../../lib/lyricStyle';
import { normalizeHexColor } from '../../../lib/roomVisualPreset';
import { makeDotTexture } from './dotTexture';
import type { StageLyricStageRoot } from './galaxyStageLyrics3D';

export type LyricMaskAsset = {
  texture: THREE.CanvasTexture;
  textMin: number;
  textMax: number;
  planeWidth: number;
  planeHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  fontSize: number;
  text: string;
};

const LYRIC_PALETTE_FALLBACK = {
  primary: new THREE.Color('#d6f8ff'),
  highlight: new THREE.Color('#eef7ff'),
  glow: new THREE.Color('#9cffdf'),
  solar: new THREE.Color('#fff0b8'),
  sunWarm: new THREE.Color('#ffe7a6'),
  sunHot: new THREE.Color('#fff4cc'),
};

function cssColorToThreeColor(css: string, fallback: string): THREE.Color {
  const c = new THREE.Color(fallback || '#d6f8ff');
  const value = String(css || fallback || '#d6f8ff').trim();
  try {
    if (/^#[0-9a-f]{3}$/i.test(value) || /^#[0-9a-f]{6}$/i.test(value)) {
      c.set(normalizeHexColor(value, '#d6f8ff'));
      return c;
    }
    const m = value.match(/^rgba?\(\s*([.\d]+)\s*,\s*([.\d]+)\s*,\s*([.\d]+)/i);
    if (m) {
      c.setRGB(
        Math.max(0, Math.min(255, parseFloat(m[1]))) / 255,
        Math.max(0, Math.min(255, parseFloat(m[2]))) / 255,
        Math.max(0, Math.min(255, parseFloat(m[3]))) / 255,
      );
      return c;
    }
    c.setStyle(value);
  } catch {
    try {
      c.set(normalizeHexColor(fallback || '#d6f8ff', '#d6f8ff'));
    } catch {
      // ignore
    }
  }
  return c;
}

/** Mineradio lyricThreeColor */
function lyricThreeColor(css: string, fallback: string, minLum?: number): THREE.Color {
  const c = cssColorToThreeColor(css, fallback || '#d6f8ff');
  const lum = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
  const floor = minLum == null ? 0.34 : minLum;
  if (lum < floor) {
    const lift = floor - lum;
    c.r = Math.min(1, c.r + lift);
    c.g = Math.min(1, c.g + lift);
    c.b = Math.min(1, c.b + lift);
  }
  return c;
}

/** Mineradio applyLyricPaletteToMesh */
export function applyLyricPaletteToMesh(mesh: LyricMeshGroup | null | undefined): void {
  if (!mesh?.userData?.lyric) return;
  const pal = stageLyricPaletteLive.palette;
  const data = mesh.userData.lyric;
  if (data.textMat?.uniforms) {
    const u = data.textMat.uniforms;
    if (u.uBaseColor) u.uBaseColor.value.copy(lyricThreeColor(pal.primary, '#d6f8ff', 0.38));
    if (u.uHiColor) u.uHiColor.value.copy(lyricThreeColor(pal.highlight || pal.primary, '#fff0b8', 0.48));
    if (u.uGlowColor) {
      u.uGlowColor.value.copy(
        lyricThreeColor(pal.glowColor || pal.secondary || pal.primary, '#9cffdf', 0.36),
      );
    }
    if (u.uSolarColor) {
      u.uSolarColor.value.copy(
        lyricThreeColor(pal.highlight || pal.secondary || pal.primary, '#fff0b8', 0.5),
      );
    }
    data.textMat.needsUpdate = true;
  }
  if (data.glowMat) {
    data.glowMat.color.copy(
      lyricThreeColor(pal.glowColor || pal.secondary || pal.primary, '#9cffdf', 0.36),
    );
  }
  if (data.sparkMat?.uniforms?.uColor) {
    data.sparkMat.uniforms.uColor.value.copy(
      lyricThreeColor(pal.highlight || pal.secondary || pal.primary, '#fff0b8', 0.46),
    );
  }
  if (data.sunMat) {
    data.sunMat.color.copy(
      lyricThreeColor(pal.highlight || pal.secondary || pal.primary, '#fff0b8', 0.5),
    );
  }
}

function applyStonePrintTexture(ctx: CanvasRenderingContext2D, W: number, H: number, _fontSize: number): void {
  if (normalizeLyricFontKey(roomVisualFxLive.current.lyricFont) !== 'stone-song') return;
  const bandTop = H * 0.1;
  const bandH = H * 0.8;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const noiseW = 300;
  const noiseH = 110;
  const noise = document.createElement('canvas');
  noise.width = noiseW;
  noise.height = noiseH;
  const nctx = noise.getContext('2d');
  if (!nctx) {
    ctx.restore();
    return;
  }
  const img = nctx.createImageData(noiseW, noiseH);
  for (let p = 0; p < noiseW * noiseH; p++) {
    const x0 = p % noiseW;
    const y0 = Math.floor(p / noiseW);
    const vein = Math.sin(x0 * 0.19 + y0 * 0.043) * 0.1 + Math.sin(y0 * 0.31) * 0.06;
    const r = Math.random() + vein;
    let a = 0;
    if (r > 0.82) a = 78 + Math.random() * 92;
    else if (r > 0.62) a = 22 + Math.random() * 54;
    else if (r > 0.48) a = 4 + Math.random() * 24;
    img.data[p * 4] = 255;
    img.data[p * 4 + 1] = 255;
    img.data[p * 4 + 2] = 255;
    img.data[p * 4 + 3] = a;
  }
  nctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 0.34;
  ctx.drawImage(noise, 0, bandTop, W, bandH);
  ctx.restore();
}

let sunBloomTexture: THREE.CanvasTexture | null = null;
let sharedDotTexture: THREE.CanvasTexture | null = null;

function lyricFont(fontSize: number): string {
  return lyricFontCss(roomVisualFxLive.current, fontSize);
}

function measuredTextWidth(mask: LyricMaskAsset): number {
  return (mask.textMax - mask.textMin) * mask.canvasWidth;
}

export function buildLyricMaskAsset(text: string): LyricMaskAsset {
  const fontSize = 76;
  const font = lyricFont(fontSize);
  const canvas = document.createElement('canvas');
  const measureCtx = canvas.getContext('2d');
  if (!measureCtx) throw new Error('canvas 2d unavailable');
  measureCtx.font = font;
  const measured = measureCtx.measureText(text).width;
  const W = Math.min(2048, Math.max(480, Math.ceil(measured + 96)));
  const H = 144;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  const spacing = lyricLetterSpacingPx(roomVisualFxLive.current, fontSize);
  drawTextWithLetterSpacing(ctx, text, W / 2, H / 2, spacing);
  applyStonePrintTexture(ctx, W, H, fontSize);

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  const xMask = ctx.createLinearGradient(0, 0, W, 0);
  xMask.addColorStop(0, 'rgba(255,255,255,0)');
  xMask.addColorStop(0.1, 'rgba(255,255,255,1)');
  xMask.addColorStop(0.9, 'rgba(255,255,255,1)');
  xMask.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = xMask;
  ctx.fillRect(0, 0, W, H);
  const yMask = ctx.createLinearGradient(0, 0, 0, H);
  yMask.addColorStop(0, 'rgba(255,255,255,0)');
  yMask.addColorStop(0.16, 'rgba(255,255,255,1)');
  yMask.addColorStop(0.84, 'rgba(255,255,255,1)');
  yMask.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = yMask;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  const textMin = (W / 2 - measured / 2) / W;
  const textMax = (W / 2 + measured / 2) / W;
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const worldW = 6.1;
  const worldH = worldW * (H / W);

  return {
    texture,
    textMin,
    textMax,
    planeWidth: worldW,
    planeHeight: worldH,
    canvasWidth: W,
    canvasHeight: H,
    fontSize,
    text,
  };
}

function getSunBloomTexture(): THREE.CanvasTexture {
  if (sunBloomTexture) return sunBloomTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.5;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(2.05, 1);
  const radial = ctx.createRadialGradient(0, 0, 0, 0, 0, canvas.height * 0.43);
  radial.addColorStop(0, 'rgba(255,246,186,0.92)');
  radial.addColorStop(0.18, 'rgba(255,219,126,0.44)');
  radial.addColorStop(0.46, 'rgba(255,186,82,0.15)');
  radial.addColorStop(1, 'rgba(255,186,82,0)');
  ctx.fillStyle = radial;
  ctx.fillRect(-canvas.width, -canvas.height, canvas.width * 2, canvas.height * 2);
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = 'blur(34px)';
  ctx.fillStyle = 'rgba(255,235,168,0.18)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, canvas.width * 0.33, canvas.height * 0.14, -0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  sunBloomTexture = new THREE.CanvasTexture(canvas);
  sunBloomTexture.minFilter = THREE.LinearFilter;
  sunBloomTexture.magFilter = THREE.LinearFilter;
  sunBloomTexture.generateMipmaps = false;
  return sunBloomTexture;
}

function buildGlowTexture(mask: LyricMaskAsset): THREE.CanvasTexture {
  const { text, fontSize } = mask;
  const font = lyricFont(fontSize);
  const measuredWidth = Math.max(1, measuredTextWidth(mask));
  const padX = Math.max(160, fontSize * 1.45);
  const padY = Math.max(86, fontSize * 0.78);
  const blockH = fontSize;
  const W = Math.ceil(measuredWidth + padX * 2);
  const H = Math.ceil(blockH + padY * 2);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const drawGlowText = (dx: number, dy: number, lineWidth: number) => {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    const x = W / 2 + dx;
    const y = H / 2 + dy;
    if (lineWidth > 0) ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  };

  ctx.save();
  ctx.filter = 'blur(14px)';
  ctx.globalAlpha = 0.46;
  drawGlowText(0, 0, Math.max(10, fontSize * 0.1));
  ctx.restore();

  ctx.save();
  ctx.filter = 'blur(34px)';
  ctx.globalAlpha = 0.34;
  drawGlowText(0, 0, Math.max(18, fontSize * 0.18));
  ctx.restore();

  ctx.save();
  ctx.filter = 'blur(78px)';
  ctx.globalAlpha = 0.22;
  drawGlowText(0, 0, Math.max(28, fontSize * 0.26));
  ctx.restore();

  ctx.save();
  ctx.filter = 'blur(116px)';
  ctx.globalAlpha = 0.13;
  drawGlowText(0, 0, Math.max(42, fontSize * 0.4));
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = 'blur(8px)';
  ctx.globalAlpha = 0.26;
  for (let ri = 0; ri < 8; ri++) {
    const ang = (ri / 8) * Math.PI * 2;
    drawGlowText(Math.cos(ang) * 7, Math.sin(ang) * 4, Math.max(10, fontSize * 0.1));
  }
  ctx.restore();

  // 羽化画布边缘，避免平面方框硬边（Mineradio destination-in）
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  const xMask = ctx.createLinearGradient(0, 0, W, 0);
  xMask.addColorStop(0, 'rgba(255,255,255,0)');
  xMask.addColorStop(0.1, 'rgba(255,255,255,1)');
  xMask.addColorStop(0.9, 'rgba(255,255,255,1)');
  xMask.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = xMask;
  ctx.fillRect(0, 0, W, H);
  const yMask = ctx.createLinearGradient(0, 0, 0, H);
  yMask.addColorStop(0, 'rgba(255,255,255,0)');
  yMask.addColorStop(0.16, 'rgba(255,255,255,1)');
  yMask.addColorStop(0.84, 'rgba(255,255,255,1)');
  yMask.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = yMask;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  (tex as THREE.CanvasTexture & { userData: { width: number; height: number; textWidth: number } }).userData = {
    width: W,
    height: H,
    textWidth: measuredWidth,
  };
  return tex;
}

function buildReadabilityTexture(text: string, fontSize: number, W: number, H: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.font = lyricFont(fontSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const stroke = (blur: number, alpha: number, width: number, color: string, dy = 0) => {
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.strokeText(text, W / 2, H / 2 + dy);
    ctx.restore();
  };
  stroke(14, 0.18, Math.max(18, fontSize * 0.16), 'rgba(0,0,0,1)', fontSize * 0.018);
  stroke(5, 0.32, Math.max(9, fontSize * 0.075), 'rgba(0,0,0,1)', fontSize * 0.012);
  stroke(4, 0.15, Math.max(9, fontSize * 0.07), 'rgba(255,255,255,1)');
  stroke(1.2, 0.26, Math.max(3.2, fontSize * 0.03), 'rgba(255,255,255,1)');
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

export function createStageLyricShaderMaterial(mask: LyricMaskAsset): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: mask.texture },
      uProgress: { value: 1 },
      uTextMin: { value: mask.textMin },
      uTextMax: { value: mask.textMax },
      uOpacity: { value: 0 },
      uBaseColor: { value: LYRIC_PALETTE_FALLBACK.primary.clone() },
      uHiColor: { value: LYRIC_PALETTE_FALLBACK.highlight.clone() },
      uGlowColor: { value: LYRIC_PALETTE_FALLBACK.glow.clone() },
      uSolarColor: { value: LYRIC_PALETTE_FALLBACK.solar.clone() },
      uFeather: { value: 0.045 },
      uSolar: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uMap;
      uniform float uProgress, uTextMin, uTextMax, uOpacity, uFeather, uSolar;
      uniform vec3 uBaseColor, uHiColor, uGlowColor, uSolarColor;
      varying vec2 vUv;
      void main() {
        float mask = texture2D(uMap, vUv).a;
        if (mask < 0.01) discard;
        float denom = max(0.001, uTextMax - uTextMin);
        float p = clamp((vUv.x - uTextMin) / denom, 0.0, 1.0);
        float filled = 1.0 - smoothstep(uProgress, uProgress + uFeather, p);
        float edge = 1.0 - smoothstep(0.0, uFeather * 2.8, abs(p - uProgress));
        vec3 color = mix(uBaseColor, uHiColor, filled * 0.88);
        color += uGlowColor * edge * 0.14;
        vec3 solar = uSolarColor;
        color = mix(color, color + solar * 0.34, uSolar * (0.25 + filled * 0.45));
        color += solar * edge * uSolar * 0.22;
        float lum = dot(color, vec3(0.299, 0.587, 0.114));
        color += vec3(max(0.0, 0.30 - lum));
        gl_FragColor = vec4(color, mask * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
    side: THREE.DoubleSide,
  });
}

export type LyricMeshGroup = THREE.Group & {
  userData: {
    lyric: {
      textMat: THREE.ShaderMaterial;
      readabilityMat: THREE.MeshBasicMaterial;
      glowMat: THREE.MeshBasicMaterial;
      sparkMat: THREE.ShaderMaterial;
      sunMat: THREE.MeshBasicMaterial;
      sun: THREE.Mesh;
      glow: THREE.Mesh;
      sparks: THREE.Points;
      basePositions: Float32Array;
      textWorldW: number;
      textWorldH: number;
      worldW: number;
      worldH: number;
    };
    age: number;
    floatSeed: number;
  };
};

function createStarRiver(dotTex: THREE.CanvasTexture): THREE.Points {
  const count = 300;
  const geo = new THREE.BufferGeometry();
  const seeds = new Float32Array(count);
  const lanes = new Float32Array(count);
  const depths = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    seeds[i] = Math.random() * 1000;
    lanes[i] = Math.random();
    depths[i] = Math.random();
  }
  geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute('lane', new THREE.BufferAttribute(lanes, 1));
  geo.setAttribute('depthSeed', new THREE.BufferAttribute(depths, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: dotTex },
      uTime: { value: 0 },
      uPixel: { value: Math.min(window.devicePixelRatio || 1, 1.75) },
      uBass: { value: 0 },
      uBeat: { value: 0 },
      uWidth: { value: 3.4 },
      uHeight: { value: 0.58 },
      uOpacity: { value: 0 },
      uColorA: { value: LYRIC_PALETTE_FALLBACK.glow.clone() },
      uColorB: { value: LYRIC_PALETTE_FALLBACK.highlight.clone() },
    },
    vertexShader: `
      precision highp float;
      attribute float seed, lane, depthSeed;
      uniform float uTime, uPixel, uBass, uBeat, uWidth, uHeight;
      varying float vSeed, vLane, vGlow;
      float hash(float n) { return fract(sin(n) * 43758.5453123); }
      void main() {
        float laneBand = floor(lane * 5.0);
        float laneLocal = fract(lane * 5.0);
        float speed = 0.030 + hash(seed * 1.71) * 0.055 + laneBand * 0.005;
        float flow = fract(hash(seed * 2.13) + uTime * speed);
        float x = (flow - 0.5) * uWidth * (1.08 + hash(seed * 5.1) * 0.18);
        float curve = sin(flow * 6.2831853 * (0.92 + hash(seed * 4.0) * 0.46) + seed * 0.071 + uTime * 0.34);
        float breath = sin(uTime * (0.42 + hash(seed * 6.9) * 0.42) + seed * 0.093);
        float y = (laneBand - 2.0) * uHeight * 0.135 + curve * uHeight * (0.20 + hash(seed * 9.0) * 0.18)
          + (laneLocal - 0.5) * uHeight * 0.16 + breath * uHeight * 0.10;
        float z = -0.08 + (depthSeed - 0.5) * 0.44 + sin(uTime * (0.18 + hash(seed) * 0.24) + seed) * 0.08;
        float edge = smoothstep(0.0, 0.18, flow) * (1.0 - smoothstep(0.82, 1.0, flow));
        vSeed = seed;
        vLane = lane;
        vGlow = edge * (0.62 + 0.38 * sin(uTime * (0.9 + hash(seed * 8.0) * 0.7) + seed));
        vec4 mv = modelViewMatrix * vec4(vec3(x, y, z), 1.0);
        float dist = max(0.45, -mv.z);
        float size = (0.030 + hash(seed * 12.0) * 0.040 + vGlow * 0.024 + uBeat * 0.010) * (1.0 + uBass * 0.18);
        gl_PointSize = clamp(size * uPixel * 120.0 / dist, 1.0, 7.2);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uMap;
      uniform vec3 uColorA, uColorB;
      uniform float uOpacity, uTime, uBeat;
      varying float vSeed, vLane, vGlow;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        if (tex.a < 0.02) discard;
        float tw = pow(0.5 + 0.5 * sin(uTime * (0.55 + fract(vSeed) * 0.35) + vSeed), 4.0);
        vec3 col = mix(uColorA, uColorB, smoothstep(0.12, 0.92, vLane) * 0.45 + tw * 0.42 + vGlow * 0.26);
        float alpha = tex.a * uOpacity * (0.20 + vGlow * 0.78 + tw * 0.32 + uBeat * 0.10);
        gl_FragColor = vec4(col * (0.82 + vGlow * 0.72 + tw * 0.32), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.renderOrder = 45;
  points.position.set(0, 0.2, 1.53);
  points.frustumCulled = false;
  return points;
}

/** Mineradio createLyricsParticles / ensureLyricStarRiver — 舞台根组 + 星河流 */
export function createStageLyricRoot(): StageLyricStageRoot {
  if (!sharedDotTexture) sharedDotTexture = makeDotTexture();
  const group = new THREE.Group() as StageLyricStageRoot;
  group.renderOrder = 38;
  const starRiver = createStarRiver(sharedDotTexture);
  group.add(starRiver);
  group.userData.starRiver = starRiver;
  group.userData.starRiverMat = starRiver.material as THREE.ShaderMaterial;
  return group;
}

/** Mineradio buildLyricMesh — 单句歌词 mesh（呼吸动画在 mesh 层） */
export function buildLyricMesh(mask: LyricMaskAsset): LyricMeshGroup {
  if (!sharedDotTexture) sharedDotTexture = makeDotTexture();

  const { planeWidth: worldW, planeHeight: worldH, canvasWidth: W, canvasHeight: H, fontSize, text } =
    mask;
  const textWorldW = worldW * (mask.textMax - mask.textMin);
  const textWorldH = worldH * (fontSize / H);
  const geo = new THREE.PlaneGeometry(worldW, worldH, 1, 1);

  const group = new THREE.Group() as LyricMeshGroup;
  group.renderOrder = 42;
  group.position.set((Math.random() - 0.5) * 0.08, 0.2, 1.46);
  group.scale.setScalar(0.96);
  group.userData.age = 0;
  group.userData.floatSeed = Math.random() * 100;

  const sunWorldW = Math.min(worldW * 1.16, Math.max(textWorldW + worldH * 1.1, textWorldW * 1.18));
  const sunWorldH = Math.max(worldH * 1.02, Math.min(worldH * 1.54, worldH + textWorldW * 0.07));
  const sunMat = new THREE.MeshBasicMaterial({
    map: getSunBloomTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    fog: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    color: LYRIC_PALETTE_FALLBACK.sunWarm.clone(),
  });
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(sunWorldW, sunWorldH), sunMat);
  sun.renderOrder = 40;
  sun.position.set(0, 0.02, -0.03);
  sun.scale.set(0.78, 0.58, 1);
  group.add(sun);

  const glowTex = buildGlowTexture(mask);
  const glowMeta = (glowTex as THREE.CanvasTexture & { userData?: { width?: number; height?: number; textWidth?: number } }).userData || {};
  const glowWorldW =
    textWorldW * ((glowMeta.width || mask.canvasWidth) / Math.max(1, glowMeta.textWidth || measuredTextWidth(mask)));
  const glowWorldWClamped = Math.min(worldW * 1.1, Math.max(textWorldW + worldH * 0.38, glowWorldW));
  const glowWorldH =
    worldH * ((glowMeta.height || mask.canvasHeight) / mask.canvasHeight);
  const glowWorldHClamped = Math.min(worldH * 1.42, Math.max(worldH * 0.92, glowWorldH));
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    fog: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    color: LYRIC_PALETTE_FALLBACK.glow.clone(),
    alphaTest: 0.02,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(glowWorldWClamped, glowWorldHClamped, 1, 1), glowMat);
  glow.renderOrder = 41;
  glow.scale.set(1, 1.06, 1);
  group.add(glow);

  const readabilityTex = buildReadabilityTexture(text, fontSize, W, H);
  const readabilityMat = new THREE.MeshBasicMaterial({
    map: readabilityTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  const readability = new THREE.Mesh(geo.clone(), readabilityMat);
  readability.renderOrder = 42;
  readability.position.set(0, 0, -0.012);
  group.add(readability);

  const textMat = createStageLyricShaderMaterial(mask);
  const textMesh = new THREE.Mesh(geo, textMat);
  textMesh.renderOrder = 43;
  group.add(textMesh);

  const sparkCount = 132;
  const pgeo = new THREE.BufferGeometry();
  const ppos = new Float32Array(sparkCount * 3);
  const pseed = new Float32Array(sparkCount);
  for (let i = 0; i < sparkCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const ring = 0.78 + Math.pow(Math.random(), 1.45) * 0.58;
    const rx = textWorldW * (0.5 + Math.random() * 0.22) + 0.1;
    const ry = worldH * (0.42 + Math.random() * 0.22) + 0.08;
    ppos[i * 3] = Math.cos(angle) * rx * ring + (Math.random() - 0.5) * textWorldW * 0.12;
    ppos[i * 3 + 1] = Math.sin(angle) * ry * ring + (Math.random() - 0.5) * worldH * 0.14;
    ppos[i * 3 + 2] = (Math.random() - 0.5) * 0.24;
    pseed[i] = Math.random() * 1000;
  }
  pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
  pgeo.setAttribute('seed', new THREE.BufferAttribute(pseed, 1));
  const sparkMat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: sharedDotTexture },
      uSize: { value: 0.052 },
      uOpacity: { value: 0 },
      uColor: { value: LYRIC_PALETTE_FALLBACK.highlight.clone() },
      uPixel: { value: Math.min(window.devicePixelRatio || 1, 1.75) },
    },
    vertexShader: `
      attribute float seed;
      uniform float uSize;
      uniform float uPixel;
      varying float vSeed;
      void main(){
        vSeed = seed;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float jitter = 0.58 + fract(sin(seed * 19.17) * 43758.5453) * 1.18;
        float depth = clamp(2.2 / max(0.35, -mv.z), 0.54, 1.55);
        gl_PointSize = uSize * jitter * depth * uPixel * 120.0;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uMap;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vSeed;
      void main(){
        vec4 tex = texture2D(uMap, gl_PointCoord);
        float twinkle = 0.72 + fract(sin(vSeed * 7.31) * 91.7) * 0.28;
        gl_FragColor = vec4(uColor * twinkle, tex.a * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  });
  const sparks = new THREE.Points(pgeo, sparkMat);
  sparks.renderOrder = 44;
  sparks.visible = false;
  group.add(sparks);

  group.userData.lyric = {
    textMat,
    readabilityMat,
    glowMat,
    sparkMat,
    sunMat,
    sun,
    glow,
    sparks,
    basePositions: ppos.slice(),
    textWorldW,
    textWorldH,
    worldW,
    worldH,
  };

  applyLyricPaletteToMesh(group);
  return group;
}

export function disposeLyricMesh(group: THREE.Group | null): void {
  if (!group) return;
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        if ('map' in m && m.map && m.map !== sunBloomTexture && m.map !== sharedDotTexture) {
          (m.map as THREE.Texture).dispose();
        }
        if ('uniforms' in m && m.uniforms) {
          const uniforms = m.uniforms as { uMap?: { value?: THREE.Texture } };
          const tex = uniforms.uMap?.value;
          if (tex && tex !== sharedDotTexture && tex !== sunBloomTexture) tex.dispose();
        }
        m.dispose();
      });
    }
    mesh.geometry?.dispose();
  });
}

export function disposeStageLyricRoot(root: THREE.Group | null): void {
  if (!root) return;
  disposeLyricMesh(root);
}
