import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'client/src/components/topography/TopographyMapScene.tsx');
let s = fs.readFileSync(file, 'utf8');

s = s.replace(
  /if \(!materialRef\.current\) return;\s*const mat = materialRef\.current;/,
  `const mat = mapMaterial;
    const u = mat.uniforms;
    const liveFx = roomVisualFxLive.current;
    const liveGround = groundEqFromMineradioFx(liveFx);
    const t = resolveTopographyTheme(liveFx);
    const eqBands = liveGround.bands;
    const enabledBands = liveGround.enabledBands ?? new Array(8).fill(true);
    const motionSpeed = Math.max(0, Math.min(100, liveGround.motionSpeed ?? DEFAULT_GROUND_MOTION_SPEED));
    const amplitude = Math.max(0, Math.min(100, liveGround.amplitude ?? 50));`,
);

s = s.replace(
  /const t = themeColors;\s*const eqBands = groundEqSettings\.bands;[\s\S]*?const amplitude = Math\.max\(0, Math\.min\(100, groundEqSettings\.amplitude \?\? 50\)\);/,
  '',
);

const matProps = [
  'uBaseColor1',
  'uBaseColor2',
  'uFogColor',
  'uCoolCore',
  'uCoolEdge',
  'uWarmCore',
  'uWarmEdge',
  'uRippleColor',
];
for (const p of matProps) {
  s = s.replaceAll(`mat.${p}.lerp`, `(u.${p}.value as THREE.Color).lerp`);
}
s = s.replace(
  'mat.uGlowIntensity = THREE.MathUtils.lerp(mat.uGlowIntensity, t.uGlowIntensity, lerpSpeed);',
  'u.uGlowIntensity.value = THREE.MathUtils.lerp(u.uGlowIntensity.value as number, t.uGlowIntensity, lerpSpeed);',
);
s = s.replace('mat.uTime =', 'u.uTime.value =');
const scalars = [
  'uMid',
  'uEnergy',
  'uAmplitude',
  'uSubBass',
  'uBass',
  'uLowMid',
  'uHighMid',
  'uPresence',
  'uBrilliance',
  'uAir',
  'uWarmth',
  'uBrightness',
  'uSharpness',
  'uSmoothness',
  'uDensity',
  'uSpectralCentroid',
];
for (const p of scalars) {
  s = s.replaceAll(`mat.${p} =`, `u.${p}.value =`);
}
s = s.replace(/mat\.uTreble = data\.treble;\n/, '');
s = s.replace('mat.uRipples = ripplesRef.current;', 'u.uRipples.value = ripplesRef.current;');

s = s.replaceAll('floatingBlockMatRef.current', 'floatingBlockMaterial');
s = s.replaceAll('blockMat.uTime =', 'blockMat.uniforms.uTime.value =');
s = s.replaceAll('blockMat.uPulse =', 'blockMat.uniforms.uPulse.value =');
for (const p of matProps) {
  s = s.replaceAll(`blockMat.${p}.lerp`, `(blockMat.uniforms.${p}.value as THREE.Color).lerp`);
}
s = s.replace(
  'blockMat.uGlowIntensity = THREE.MathUtils.lerp(blockMat.uGlowIntensity, t.uGlowIntensity, lerpSpeed);',
  'blockMat.uniforms.uGlowIntensity.value = THREE.MathUtils.lerp(blockMat.uniforms.uGlowIntensity.value as number, t.uGlowIntensity, lerpSpeed);',
);
const bscalars = ['uWarmth', 'uBrightness', 'uSharpness', 'uPresence', 'uBrilliance', 'uAir'];
for (const p of bscalars) {
  s = s.replaceAll(`blockMat.${p} = mat.${p};`, `blockMat.uniforms.${p}.value = u.${p}.value;`);
}

s = s.replace(
  /if \(coverMatRef\.current && coverTexture\) \{[\s\S]*?\n        \}/,
  `if (coverMaterialRef.current && coverTexture) {
          coverMaterialRef.current.uniforms.uPulse.value = data.bass * 0.4 + data.subBass * 0.2;
          coverMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
        }`,
);

s = s.replace(
  /  \/\/ Save camera when exiting edit mode[\s\S]*?  \}, \[resetCameraTrigger, camera\]\);\n\n/,
  '',
);

s = s.replace(
  /<OrbitControls[\s\S]*?\/>\n\n/,
  '<TopographyOrbitControls ref={controlsRef} cameraDistance={roomVisualFxLive.current.cameraDistance} />\n\n',
);

s = s.replace(
  /<mapShaderMaterial[\s\S]*?\/>\n/,
  '<primitive object={mapMaterial} attach="material" />\n',
);

s = s.replace(
  /<floatingBlockShaderMaterial[\s\S]*?\/>\n/,
  '<primitive object={floatingBlockMaterial} attach="material" />\n',
);

s = s.replace(
  /\{coverTexture && \([\s\S]*?\)\}\n\n      \{lyricsSettings[\s\S]*?\)\}\n/,
  `{coverTexture && coverMaterialRef.current ? (
        <group>
          <mesh position={TOPOGRAPHY_COVER_SCREEN_POSITION} rotation={TOPOGRAPHY_COVER_SCREEN_ROTATION}>
            <planeGeometry args={[140, 140]} />
            <primitive object={coverMaterialRef.current} attach="material" />
          </mesh>
        </group>
      ) : null}
`,
);

fs.writeFileSync(file, s);
console.log('patched TopographyMapScene');
