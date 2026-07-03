import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(process.cwd(), '.tmp-sonic-shader.ts'),
  'utf8',
);
const fragStart = src.indexOf('const terrainFragmentShader = `') + 'const terrainFragmentShader = `'.length;
const fragEnd = src.indexOf('`;\n\nexport const MapShaderMaterial');
const frag = src.slice(fragStart, fragEnd);
const vertMarker = '// vertex shader\n  `';
const vertStart = src.indexOf(vertMarker) + vertMarker.length;
const vertEnd = src.indexOf('`,\n  terrainFragmentShader');
const vert = src.slice(vertStart, vertEnd);

const out = `import * as THREE from 'three';

/** Adapted from sonic-topography (yin-yizhen) — personal/non-commercial license */
export const TOPOGRAPHY_TERRAIN_FRAGMENT = \`${frag}\`;

export const TOPOGRAPHY_TERRAIN_VERTEX = \`${vert}\`;

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
      uBaseColor1: { value: new THREE.Color(0.01, 0.02, 0.04) },
      uBaseColor2: { value: new THREE.Color(0.03, 0.05, 0.09) },
      uFogColor: { value: new THREE.Color(0.01, 0.02, 0.04) },
      uCoolCore: { value: new THREE.Color(0.0, 0.3, 1.0) },
      uCoolEdge: { value: new THREE.Color(0.6, 0.2, 1.0) },
      uWarmCore: { value: new THREE.Color(1.0, 0.2, 0.1) },
      uWarmEdge: { value: new THREE.Color(1.0, 0.6, 0.0) },
      uRippleColor: { value: new THREE.Color(0.2, 0.9, 1.0) },
      uGlowIntensity: { value: 1.0 },
    },
    vertexShader: TOPOGRAPHY_TERRAIN_VERTEX,
    fragmentShader: TOPOGRAPHY_TERRAIN_FRAGMENT,
  });
}
`;

const dest = path.join(
  process.cwd(),
  'client/src/components/topography/lib/topographyMapShader.ts',
);
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log('written', dest, out.length);
