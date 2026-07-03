import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(process.cwd(), '.tmp-sonic-shader-full.ts'), 'utf8');

function sliceBetween(startMarker, endMarker, from = 0) {
  const start = src.indexOf(startMarker, from) + startMarker.length;
  const end = src.indexOf(endMarker, start);
  return src.slice(start, end);
}

const terrainFrag = sliceBetween('const terrainFragmentShader = `', '`;\n\nexport const MapShaderMaterial');
const terrainVert = sliceBetween('// vertex shader\n  `', '`,\n  terrainFragmentShader');
const floatVert = sliceBetween('export const FloatingBlockShaderMaterial = shaderMaterial(', '// fragment shader\n  `');
const floatVertBody = sliceBetween('// vertex shader\n  `', '`,\n  // fragment shader', src.indexOf('FloatingBlockShaderMaterial'));
const floatFrag = sliceBetween('// fragment shader\n  `', '`\n);', src.indexOf('FloatingBlockShaderMaterial'));
const coverVertBody = sliceBetween('// vertex shader\n  `', '`,\n  // fragment shader', src.indexOf('CoverShaderMaterial'));
const coverFrag = sliceBetween('// fragment shader\n  `', '`\n);', src.indexOf('CoverShaderMaterial'));

const out = `import * as THREE from 'three';

/** Adapted from sonic-topography (yin-yizhen) — personal/non-commercial license */
export const TOPOGRAPHY_TERRAIN_FRAGMENT = \`${terrainFrag}\`;
export const TOPOGRAPHY_TERRAIN_VERTEX = \`${terrainVert}\`;
export const TOPOGRAPHY_FLOATING_FRAGMENT = \`${floatFrag}\`;
export const TOPOGRAPHY_FLOATING_VERTEX = \`${floatVertBody}\`;
export const TOPOGRAPHY_COVER_FRAGMENT = \`${coverFrag}\`;
export const TOPOGRAPHY_COVER_VERTEX = \`${coverVertBody}\`;

export type TopographyRippleSlot = {
  pos: THREE.Vector2;
  time: number;
  strength: number;
  isActive: number;
  rippleType: number;
};

export function createRippleUniformSlots(): TopographyRippleSlot[] {
  return Array.from({ length: 10 }, () => ({
    pos: new THREE.Vector2(),
    time: -100,
    strength: 0,
    isActive: 0,
    rippleType: 0,
  }));
}

function themeUniforms() {
  return {
    uBaseColor1: { value: new THREE.Color(0.01, 0.02, 0.04) },
    uBaseColor2: { value: new THREE.Color(0.03, 0.05, 0.09) },
    uFogColor: { value: new THREE.Color(0.01, 0.02, 0.04) },
    uCoolCore: { value: new THREE.Color(0.0, 0.3, 1.0) },
    uCoolEdge: { value: new THREE.Color(0.6, 0.2, 1.0) },
    uWarmCore: { value: new THREE.Color(1.0, 0.2, 0.1) },
    uWarmEdge: { value: new THREE.Color(1.0, 0.6, 0.0) },
    uRippleColor: { value: new THREE.Color(0.2, 0.9, 1.0) },
    uGlowIntensity: { value: 1.0 },
  };
}

export function createTopographyMapMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    uniforms: {
      uTime: { value: 0 },
      uSubBass: { value: 0 },
      uBass: { value: 0 },
      uLowMid: { value: 0 },
      uMid: { value: 0 },
      uHighMid: { value: 0 },
      uPresence: { value: 0 },
      uBrilliance: { value: 0 },
      uAir: { value: 0 },
      uWarmth: { value: 0 },
      uBrightness: { value: 0 },
      uSharpness: { value: 0 },
      uSmoothness: { value: 0 },
      uDensity: { value: 0 },
      uSpectralCentroid: { value: 0 },
      uEnergy: { value: 0 },
      uAmplitude: { value: 1.0 },
      uRipples: { value: createRippleUniformSlots() },
      ...themeUniforms(),
    },
    vertexShader: TOPOGRAPHY_TERRAIN_VERTEX,
    fragmentShader: TOPOGRAPHY_TERRAIN_FRAGMENT,
  });
}

export function createTopographyFloatingBlockMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uPresence: { value: 0 },
      uBrilliance: { value: 0 },
      uAir: { value: 0 },
      uWarmth: { value: 0 },
      uBrightness: { value: 0 },
      uSharpness: { value: 0 },
      ...themeUniforms(),
    },
    vertexShader: TOPOGRAPHY_FLOATING_VERTEX,
    fragmentShader: TOPOGRAPHY_FLOATING_FRAGMENT,
  });
}

export function createTopographyCoverMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTexture: { value: texture },
      uThemeColor: { value: new THREE.Color(0.5, 0.5, 0.5) },
      uFogColor: { value: new THREE.Color(0.01, 0.02, 0.04) },
      uTextureSize: { value: new THREE.Vector2(512, 512) },
      uTime: { value: 0 },
      uPulse: { value: 0 },
    },
    vertexShader: TOPOGRAPHY_COVER_VERTEX,
    fragmentShader: TOPOGRAPHY_COVER_FRAGMENT,
  });
}
`;

fs.writeFileSync(
  path.join(process.cwd(), 'client/src/components/topography/lib/topographyMapShader.ts'),
  out,
);
console.log('shader bytes', out.length, 'floatVert unused', floatVert.length);
