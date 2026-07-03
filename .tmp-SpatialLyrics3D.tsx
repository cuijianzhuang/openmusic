import { useFrame } from '@react-three/fiber';
import { useRef, useMemo, useState, useEffect } from 'react';
import * as THREE from 'three';
import { parseLRC } from '../../lib/lyrics';
import { engine } from '../../lib/AudioEngine';
import { type LyricStyleConfig } from '../../lib/lyricsSettings';
import { splitLineToMeasuredWidth, wrapLyricTextLines } from '../../lib/lyricLineWrapping';

export const COVER_SCREEN_POSITION = [110, 24, -110] as const;
export const COVER_SCREEN_ROTATION = [0, -Math.PI / 4, 0] as const;
export const SPATIAL_LYRICS_LEFT_OFFSET = 18;
export const SPATIAL_LYRICS_POSITION = [
  COVER_SCREEN_POSITION[0] - Math.cos(Math.PI / 4) * SPATIAL_LYRICS_LEFT_OFFSET,
  COVER_SCREEN_POSITION[1],
  COVER_SCREEN_POSITION[2] - Math.sin(Math.PI / 4) * SPATIAL_LYRICS_LEFT_OFFSET,
] as const;
const DEFAULT_SPATIAL_LYRICS_RADIUS = Math.hypot(SPATIAL_LYRICS_POSITION[0], SPATIAL_LYRICS_POSITION[2]);
const DEFAULT_SPATIAL_LYRICS_ANGLE = Math.atan2(SPATIAL_LYRICS_POSITION[2], SPATIAL_LYRICS_POSITION[0]);
const SPATIAL_LYRICS_ARC_HALF_ANGLE = 0.58;
const SPATIAL_LYRICS_THETA_START = Math.PI + SPATIAL_LYRICS_ARC_HALF_ANGLE;
const SPATIAL_LYRICS_THETA_LENGTH = -SPATIAL_LYRICS_ARC_HALF_ANGLE * 2;

const SPATIAL_LYRICS_FONT_SCALE = 4;
const SPATIAL_LYRICS_WORLD_SCALE = 5;
const ACTIVE_MIN_FONT_SIZE = 72;
const ACTIVE_MAX_FONT_SIZE = 260;
const CANVAS_SAFE_TEXT_WIDTH = 1880;
const CANVAS_MIN_TEXT_WIDTH = 560;
const LINE_WIDTH_FONT_FACTOR = 0.46;
const SPATIAL_LYRICS_MAX_LINES = 8;
const LINE_BOUNDS_HALF_STEP_RATIO = 0.48;

const estimateTargetLineWidth = (maxCharsPerLine: number, fontSize: number) => {
  const desiredWidth = Math.max(1, maxCharsPerLine) * fontSize * LINE_WIDTH_FONT_FACTOR;
  return THREE.MathUtils.clamp(desiredWidth, CANVAS_MIN_TEXT_WIDTH, CANVAS_SAFE_TEXT_WIDTH);
};

// --- Shader Definition ---
const LyricsVertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const LyricsFragmentShader = `
    uniform sampler2D uInactiveTexture;
    uniform sampler2D uActiveTexture;
    uniform vec4 uLineBounds[${SPATIAL_LYRICS_MAX_LINES}]; // x: startX, y: endX, z: startY, w: endY (all in UV space 0-1)
    uniform float uLineProgress[${SPATIAL_LYRICS_MAX_LINES}];
    uniform float uOpacity;
    
    varying vec2 vUv;

    void main() {
      vec4 inactiveColor = texture2D(uInactiveTexture, vUv);
      vec4 activeColor = texture2D(uActiveTexture, vUv);
      
      float mixValue = 0.0;
      
      for(int i = 0; i < ${SPATIAL_LYRICS_MAX_LINES}; i++) {
         // Check if pixel is within the line's Y bounds
         // Note: vUv.y is flipped in CanvasTexture by default, so 1.0 is top, 0.0 is bottom.
         // uLineBounds[i].z is top UV, uLineBounds[i].w is bottom UV (z > w)
         if (vUv.y <= uLineBounds[i].z && vUv.y >= uLineBounds[i].w) {
             float progress = uLineProgress[i];
             
             // Map current UV.x to the line's local X progress
             float lineUVX = (vUv.x - uLineBounds[i].x) / (uLineBounds[i].y - uLineBounds[i].x);
             
             // Soft gradient wipe
             mixValue = smoothstep(lineUVX - 0.05, lineUVX + 0.05, progress);
             break; // Pixel can only be in one line
         }
      }
      
      vec4 finalColor = mix(inactiveColor, activeColor, mixValue);
      
      gl_FragColor = vec4(finalColor.rgb, finalColor.a * uOpacity);
    }
`;


export function SpatialLyrics3D({ lrcText, lyricsSettings, accentHex, visible = true }: { 
  lrcText: string;
  lyricsSettings: LyricStyleConfig;
  accentHex: string;
  visible?: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef(1);
  const visualEnergyRef = useRef(0);
  const opacityRef = useRef(0);
  
  // Dual canvas setup
  const [textures, setTextures] = useState<{inactive: THREE.CanvasTexture, active: THREE.CanvasTexture} | null>(null);
  const canvasesRef = useRef<{ inactive: HTMLCanvasElement, active: HTMLCanvasElement } | null>(null);
  
  const shaderMaterialRef = useRef<THREE.ShaderMaterial>(null);
  
  // We need to keep track of the wrapped lines data for the wipe calculation
  const currentLinesDataRef = useRef<{
    totalChars: number,
    lines: Array<{
      text: string,
      charCount: number,
      uvStartX: number,
      uvEndX: number,
      uvStartY: number, // top
      uvEndY: number    // bottom
    }>
  } | null>(null);

  const lyricsData = useMemo(() => {
    if (!lrcText) return [];
    return parseLRC(lrcText);
  }, [lrcText]);
  const spatialOrbitOffsetRadians = THREE.MathUtils.degToRad(lyricsSettings.spatialOrbitOffset);
  const spatialLyricsPosition = useMemo(() => {
    const angle = DEFAULT_SPATIAL_LYRICS_ANGLE + spatialOrbitOffsetRadians;
    return [
      Math.cos(angle) * DEFAULT_SPATIAL_LYRICS_RADIUS,
      SPATIAL_LYRICS_POSITION[1],
      Math.sin(angle) * DEFAULT_SPATIAL_LYRICS_RADIUS,
    ] as const;
  }, [spatialOrbitOffsetRadians]);
  const spatialLyricsRotation = useMemo(() => {
    return [
      COVER_SCREEN_ROTATION[0],
      COVER_SCREEN_ROTATION[1] - spatialOrbitOffsetRadians,
      COVER_SCREEN_ROTATION[2],
    ] as const;
  }, [spatialOrbitOffsetRadians]);
  const spatialLyricsWidthScale = useMemo(() => {
    const previewFontSize = THREE.MathUtils.clamp(
      lyricsSettings.activeFontSize * SPATIAL_LYRICS_FONT_SCALE,
      ACTIVE_MIN_FONT_SIZE,
      ACTIVE_MAX_FONT_SIZE
    );
    const targetWidth = estimateTargetLineWidth(lyricsSettings.maxCharsPerLine, previewFontSize);
    return THREE.MathUtils.lerp(0.76, 1.16, targetWidth / CANVAS_SAFE_TEXT_WIDTH);
  }, [lyricsSettings.activeFontSize, lyricsSettings.maxCharsPerLine]);
  const spatialLyricsRadius = 52 * spatialLyricsWidthScale;

  const [activeIndex, setActiveIndex] = useState(-1);
  const [fontsLoaded, setFontsLoaded] = useState(false);

  // Initialize uniforms once
  const uniforms = useMemo(() => {
     return {
       uInactiveTexture: { value: null },
       uActiveTexture: { value: null },
       uLineBounds: { value: Array.from({ length: SPATIAL_LYRICS_MAX_LINES }, () => new THREE.Vector4()) },
       uLineProgress: { value: new Array(SPATIAL_LYRICS_MAX_LINES).fill(0.0) },
       uOpacity: { value: 0.94 },
       uBaseColor: { value: new THREE.Color(1.0, 1.0, 1.0) }
     };
  }, []);

  useEffect(() => {
    document.fonts.ready.then(() => setFontsLoaded(true));
  }, []);

  useEffect(() => {
    setActiveIndex(-1);
  }, [lyricsData]);

  function renderCurrentLyricTextures() {
    if (!canvasesRef.current || !textures || !fontsLoaded || !shaderMaterialRef.current) return;
    const { inactive, active } = canvasesRef.current;
    const ctxInactive = inactive.getContext('2d');
    const ctxActive = active.getContext('2d');
    if (!ctxInactive || !ctxActive) return;

    const activeLine = lyricsData[activeIndex];
    if (!activeLine) {
        ctxInactive.clearRect(0, 0, 2048, 2048);
        ctxActive.clearRect(0, 0, 2048, 2048);
        currentLinesDataRef.current = null;
        if (shaderMaterialRef.current?.uniforms?.uLineProgress) {
          shaderMaterialRef.current.uniforms.uLineProgress.value = new Array(SPATIAL_LYRICS_MAX_LINES).fill(0.0);
        }
        textures.inactive.needsUpdate = true;
        textures.active.needsUpdate = true;
        return;
    }

    ctxInactive.clearRect(0, 0, 2048, 2048);
    ctxActive.clearRect(0, 0, 2048, 2048);

    const centerY = 1024;
    const baseHex = lyricsSettings.fontColor;
    const karaokeHex = lyricsSettings.followThemeKaraoke ? accentHex : lyricsSettings.karaokeColor;
    const glowHex = lyricsSettings.followThemeGlow ? accentHex : lyricsSettings.glowColor;

    const setupCtx = (ctx: CanvasRenderingContext2D) => {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
    };
    setupCtx(ctxInactive);
    setupCtx(ctxActive);

    const sansFont = '"SourceHanSansCN", "Inter", ui-sans-serif, system-ui, sans-serif';
    const serifFont = 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';
    const fontFamily = lyricsSettings.fontFamily === 'serif' ? serifFont : sansFont;

    const fitWrappedLinesToCanvasWidth = (lines: string[], ctx: CanvasRenderingContext2D, maxWidth: number) => (
      lines.flatMap((line) => splitLineToMeasuredWidth(line, maxWidth, (value) => ctx.measureText(value).width))
    );

    const scaledSettingFontSize = lyricsSettings.activeFontSize * SPATIAL_LYRICS_FONT_SCALE;
    let fontSize = THREE.MathUtils.clamp(scaledSettingFontSize, ACTIVE_MIN_FONT_SIZE, ACTIVE_MAX_FONT_SIZE);
    const targetLineWidth = estimateTargetLineWidth(lyricsSettings.maxCharsPerLine, fontSize);
    let wrappedLines = wrapLyricTextLines(activeLine.text, lyricsSettings.maxCharsPerLine);
    ctxInactive.font = `900 ${fontSize}px ${fontFamily}`;
    wrappedLines = fitWrappedLinesToCanvasWidth(wrappedLines, ctxInactive, targetLineWidth);
    while (
      wrappedLines.length > SPATIAL_LYRICS_MAX_LINES
      && fontSize > ACTIVE_MIN_FONT_SIZE
    ) {
      fontSize -= 10;
      ctxInactive.font = `900 ${fontSize}px ${fontFamily}`;
      wrappedLines = fitWrappedLinesToCanvasWidth(wrapLyricTextLines(activeLine.text, lyricsSettings.maxCharsPerLine), ctxInactive, targetLineWidth);
    }
    
    if (wrappedLines.length > SPATIAL_LYRICS_MAX_LINES) {
      wrappedLines = wrappedLines.slice(0, SPATIAL_LYRICS_MAX_LINES);
    }

    const lineStep = Math.min(fontSize * 1.36, 1720 / Math.max(1, wrappedLines.length));
    const lineBoundsHalfHeight = Math.min(fontSize * 0.66, lineStep * LINE_BOUNDS_HALF_STEP_RATIO);
    const startY = centerY - ((wrappedLines.length - 1) * lineStep * 0.5);
    
    // Store metadata for the shader
    const linesData: typeof currentLinesDataRef.current = {
        totalChars: wrappedLines.join('').length,
        lines: []
    };
    const boundsArray = Array.from({ length: SPATIAL_LYRICS_MAX_LINES }, () => new THREE.Vector4());

    const hexToRgba = (hex: string, alpha: number) => {
      if (!hex || !hex.startsWith('#')) return hex;
      const cleanHex = hex.length === 4 
          ? '#' + hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3] 
          : hex;
      const r = parseInt(cleanHex.slice(1, 3), 16);
      const g = parseInt(cleanHex.slice(3, 5), 16);
      const b = parseInt(cleanHex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const drawLyricLine = (ctx: CanvasRenderingContext2D, text: string, y: number, fontSize: number, fillColor: string, gColor: string) => {
      ctx.save();
      ctx.font = `900 ${fontSize}px ${fontFamily}`;
      
      // Pass 1: Drop shadow
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4;
      ctx.fillText(text, 1024, y);
      
      // Pass 2: Theme glow and base text
      ctx.shadowColor = hexToRgba(gColor, 0.6); // 60% alpha to match '99' in CSS
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = fillColor;
      ctx.fillText(text, 1024, y);
      
      ctx.restore();
    };

    wrappedLines.forEach((wrappedLine, lineIndex) => {
      if (lineIndex >= SPATIAL_LYRICS_MAX_LINES) return; // double check boundary

      const y = startY + lineIndex * lineStep;
      
      // Inactive: Base color with glow & shadow
      drawLyricLine(ctxInactive, wrappedLine, y, fontSize, baseHex, glowHex);
      
      // Active: Karaoke color with glow & shadow
      drawLyricLine(ctxActive, wrappedLine, y, fontSize, karaokeHex, glowHex);
      
      // Calculate bounds
      const textWidth = ctxInactive.measureText(wrappedLine).width;
      const startX = 1024 - textWidth / 2;
      const endX = 1024 + textWidth / 2;
      
      const uvStartX = startX / 2048;
      const uvEndX = endX / 2048;
      
      // Canvas Y goes down. WebGL UV Y goes up (if flipY is true, which it is for CanvasTexture)
      // So y=0 -> vUv.y=1.0. y=2048 -> vUv.y=0.0
      // We need the TOP and BOTTOM uv coords for the line
      const topY = y - lineBoundsHalfHeight;
      const bottomY = y + lineBoundsHalfHeight;
      const uvStartY = 1.0 - (topY / 2048); // will be > uvEndY
      const uvEndY = 1.0 - (bottomY / 2048);
      
      linesData.lines.push({
          text: wrappedLine,
          charCount: wrappedLine.length,
          uvStartX, uvEndX, uvStartY, uvEndY
      });
      
      boundsArray[lineIndex].set(uvStartX, uvEndX, uvStartY, uvEndY);
    });

    currentLinesDataRef.current = linesData;
    
    if (shaderMaterialRef.current?.uniforms?.uLineBounds) {
        shaderMaterialRef.current.uniforms.uLineBounds.value = boundsArray;
        shaderMaterialRef.current.uniforms.uInactiveTexture.value = textures.inactive;
        shaderMaterialRef.current.uniforms.uActiveTexture.value = textures.active;
    }

    textures.inactive.needsUpdate = true;
    textures.active.needsUpdate = true;
  }

  useFrame((state, delta) => {
    if (meshRef.current) {
      if (visible && !meshRef.current.visible) {
        meshRef.current.visible = true;
      }
    }

    const currentAudioTime = engine.audioElement.currentTime;
    let newIndex = -1;
    for (let i = 0; i < lyricsData.length; i++) {
      if (currentAudioTime >= lyricsData[i].time - 0.2) { // Add a slight anticipation to match UI
        newIndex = i;
      } else {
        break;
      }
    }
    if (newIndex !== activeIndex) {
      setActiveIndex(newIndex);
    }

    // --- Audio reactive pulse ---
    const eq = engine.getAudioData();
    const sub = eq[lyricsSettings.triggerBand || 'subBass'] || 0;
    const reactiveEnergy = Math.max(sub, eq.energy, eq.bass * 0.8);
    const targetScale = SPATIAL_LYRICS_WORLD_SCALE * (1.0 + reactiveEnergy * 0.28);
    pulseRef.current = THREE.MathUtils.lerp(pulseRef.current, targetScale, delta * 10);
    visualEnergyRef.current = THREE.MathUtils.lerp(visualEnergyRef.current, reactiveEnergy, delta * 8);
    
    if (meshRef.current) {
      meshRef.current.scale.set(pulseRef.current, pulseRef.current, pulseRef.current);
      meshRef.current.position.x = spatialLyricsPosition[0];
      meshRef.current.position.z = spatialLyricsPosition[2];
      // Smooth floating up/down
      const targetY = spatialLyricsPosition[1] + Math.sin(state.clock.elapsedTime * 0.5) * 1.5;
      meshRef.current.position.y = THREE.MathUtils.lerp(meshRef.current.position.y, targetY, delta * 2);
    }

    const energy = Math.max(0, Math.min(1, visualEnergyRef.current));
    const targetOpacity = visible ? THREE.MathUtils.lerp(0.88, 1.0, energy) : 0;
    opacityRef.current = THREE.MathUtils.lerp(opacityRef.current, targetOpacity, delta * 8);

    if (shaderMaterialRef.current) {
      shaderMaterialRef.current.uniforms.uOpacity.value = opacityRef.current;
      shaderMaterialRef.current.uniforms.uBaseColor.value.setRGB(1.0, 1.0, 1.0);
    }

    if (meshRef.current) {
      if (!visible && opacityRef.current <= 0.01) {
        meshRef.current.visible = false;
      }
    }

    // --- Shader karaoke progress updates ---
    if (shaderMaterialRef.current && currentLinesDataRef.current) {
      // Karaoke Fill Progress
      const activeLine = lyricsData[newIndex];
      const nextLine = lyricsData[newIndex + 1];
      let progress = 0;
      if (activeLine) {
         const duration = nextLine ? nextLine.time - activeLine.time : 4;
         if (currentAudioTime >= activeLine.time) {
             progress = Math.max(0, Math.min(1, (currentAudioTime - activeLine.time) / duration));
         }
      }

      // Distribute global progress across lines based on char count
      const { totalChars, lines } = currentLinesDataRef.current;
      const progressArray = new Array(SPATIAL_LYRICS_MAX_LINES).fill(0.0);
      let charsDrawn = 0;
      
      if (totalChars > 0) {
          lines.forEach((line, i) => {
              if (i >= SPATIAL_LYRICS_MAX_LINES) return; // Safety check
              const lineStartProgress = charsDrawn / totalChars;
              const lineEndProgress = (charsDrawn + line.charCount) / totalChars;
              
              if (progress >= lineEndProgress) {
                  progressArray[i] = 1.0;
              } else if (progress <= lineStartProgress) {
                  progressArray[i] = 0.0;
              } else {
                  // The line is partially filled
                  progressArray[i] = (progress - lineStartProgress) / (lineEndProgress - lineStartProgress);
              }
              charsDrawn += line.charCount;
          });
      }
      if (shaderMaterialRef.current?.uniforms?.uLineProgress) {
          shaderMaterialRef.current.uniforms.uLineProgress.value = progressArray;
      }
    }
  });

  useEffect(() => {
    if (!fontsLoaded) return;

    const canvasInactive = document.createElement('canvas');
    canvasInactive.width = 2048;
    canvasInactive.height = 2048;
    
    const canvasActive = document.createElement('canvas');
    canvasActive.width = 2048;
    canvasActive.height = 2048;

    const textureInactive = new THREE.CanvasTexture(canvasInactive);
    textureInactive.anisotropy = 16;
    textureInactive.minFilter = THREE.LinearFilter;
    
    const textureActive = new THREE.CanvasTexture(canvasActive);
    textureActive.anisotropy = 16;
    textureActive.minFilter = THREE.LinearFilter;

    canvasesRef.current = { inactive: canvasInactive, active: canvasActive };
    setTextures({ inactive: textureInactive, active: textureActive });

    return () => {
      canvasesRef.current = null;
      textureInactive.dispose();
      textureActive.dispose();
    };
  }, [fontsLoaded]);

  useEffect(() => {
    renderCurrentLyricTextures();
  }, [activeIndex, lyricsData, lyricsSettings, accentHex, fontsLoaded]);

  if (lyricsData.length === 0) return null;

  return (
    <mesh ref={meshRef} position={spatialLyricsPosition} rotation={spatialLyricsRotation}>
      <cylinderGeometry args={[spatialLyricsRadius, spatialLyricsRadius, 46, 64, 1, true, SPATIAL_LYRICS_THETA_START, SPATIAL_LYRICS_THETA_LENGTH]} />
      {textures && (
        <shaderMaterial 
          ref={shaderMaterialRef}
          vertexShader={LyricsVertexShader}
          fragmentShader={LyricsFragmentShader}
          uniforms={uniforms}
          transparent={true}
          depthTest={false}
          depthWrite={false}
          fog={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      )}
    </mesh>
  );
}
