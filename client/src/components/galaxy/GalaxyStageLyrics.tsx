import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getActiveLyricLine } from '../../api/music';
import { useSmoothPlaybackTime } from '../../hooks/useSmoothPlaybackTime';
import { useTrackLyrics } from '../../hooks/useTrackLyrics';
import { roomVisualFxLive, subscribeRoomVisualFx } from '../../lib/roomVisualFxLive';
import { subscribeStageLyricPalette } from '../../lib/stageLyricPaletteLive';
import { useRoomStore } from '../../stores/roomStore';
import { ensureLyricFontLoaded } from '../../lib/lyricFonts';
import { getGalaxyBeatCameraKick } from './lib/galaxyCinema';
import { getCachedGalaxyAudioBands, resumeGalaxyAudioContext } from './lib/galaxyAudio';
import {
  buildLyricMaskAsset,
  buildLyricMesh,
  createStageLyricRoot,
  applyLyricPaletteToMesh,
  disposeLyricMesh,
  disposeStageLyricRoot,
  type LyricMeshGroup,
} from './lib/galaxyStageLyricMaterial';
import {
  createStageLyricsRuntime,
  snapStageLyricCameraLock,
  updateStageLyrics3D,
  type StageLyricStageRoot,
} from './lib/galaxyStageLyrics3D';

interface Props {
  isPlaying: boolean;
  spatialAnchor?: 'galaxy' | 'topography';
}

/** Mineradio stageLyrics + updateStageLyrics3D — 所有着色器预设共用 */
export default function GalaxyStageLyrics({ isPlaying, spatialAnchor = 'galaxy' }: Props) {
  const current = useRoomStore((s) => s.room?.current ?? null);
  const currentTime = useSmoothPlaybackTime();
  const lyrics = useTrackLyrics(current);
  const activeLine = getActiveLyricLine(lyrics, currentTime);
  const currentLine = activeLine?.text ?? null;
  const currentTranslation = activeLine?.translation ?? null;
  const lyricKey = activeLine
    ? `${activeLine.time}:${activeLine.text}:${activeLine.translation || ''}:${roomVisualFxLive.current.lyricShowTranslation !== false}`
    : null;
  const { camera } = useThree();

  const stageRootRef = useRef<StageLyricStageRoot | null>(null);
  const currentMeshRef = useRef<LyricMeshGroup | null>(null);
  const runtimeRef = useRef(createStageLyricsRuntime());
  const prevLineRef = useRef<string | null>(null);
  const worldPosRef = useRef(new THREE.Vector3());
  const [fxRevision, setFxRevision] = useState(0);
  const [fontRevision, setFontRevision] = useState(0);

  useEffect(() => subscribeRoomVisualFx(() => setFxRevision((v) => v + 1)), []);
  useEffect(() => subscribeStageLyricPalette(() => setFxRevision((v) => v + 1)), []);

  const fx = roomVisualFxLive.current;
  const showTranslation = fx.lyricShowTranslation !== false;

  useEffect(() => {
    let cancelled = false;
    void ensureLyricFontLoaded(fx).then(() => {
      if (!cancelled) setFontRevision((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [fx.lyricFont, fx.lyricWeight, fxRevision]);

  const stageRoot = useMemo(() => {
    const root = createStageLyricRoot();
    stageRootRef.current = root;
    return root;
  }, []);

  const lyricMesh = useMemo(() => {
    if (!currentLine) return null;
    const mask = buildLyricMaskAsset(
      currentLine,
      showTranslation ? currentTranslation : null,
      showTranslation,
    );
    return buildLyricMesh(mask);
  }, [lyricKey, currentLine, currentTranslation, showTranslation, fxRevision, fontRevision]);

  useEffect(() => {
    if (spatialAnchor !== 'topography') return;
    const root = stageRootRef.current;
    if (!root) return;
    root.renderOrder = 160;
    root.frustumCulled = false;
    root.traverse((obj) => {
      obj.frustumCulled = false;
      if ('renderOrder' in obj && typeof obj.renderOrder === 'number' && obj.renderOrder < 160) {
        obj.renderOrder += 120;
      }
    });
  }, [spatialAnchor, stageRoot, lyricMesh]);

  useEffect(() => {
    const mesh = currentMeshRef.current;
    if (mesh) applyLyricPaletteToMesh(mesh);
  }, [fxRevision, lyricMesh]);

  useEffect(() => {
    const root = stageRootRef.current;
    const prev = currentMeshRef.current;
    if (prev && root) {
      root.remove(prev);
      disposeLyricMesh(prev);
    }
    currentMeshRef.current = lyricMesh;
    if (lyricMesh && root && spatialAnchor === 'topography') {
      root.add(lyricMesh);
      if (lyricKey !== prevLineRef.current) {
        lyricMesh.userData.age = 0;
        snapStageLyricCameraLock(runtimeRef.current);
      }
      const textMat = lyricMesh.userData.lyric?.textMat;
      if (textMat) textMat.uniforms.uOpacity.value = 0.94;
      if (root.userData.starRiverMat) root.userData.starRiverMat.uniforms.uOpacity.value = 0.42;
    } else if (lyricMesh && root) {
      root.add(lyricMesh);
      if (lyricKey !== prevLineRef.current) {
        lyricMesh.userData.age = 0;
        snapStageLyricCameraLock(runtimeRef.current);
      }
    }
    prevLineRef.current = lyricKey;
  }, [lyricKey, currentLine, lyricMesh, spatialAnchor]);

  useEffect(
    () => () => {
      const root = stageRootRef.current;
      const mesh = currentMeshRef.current;
      if (mesh && root) root.remove(mesh);
      disposeLyricMesh(mesh);
      disposeStageLyricRoot(root);
      stageRootRef.current = null;
      currentMeshRef.current = null;
    },
    [],
  );

  useFrame((state, delta) => {
    const mesh = currentMeshRef.current;
    const root = stageRootRef.current;
    if (!root) return;

    const fx = roomVisualFxLive.current;
    const lyricsEnabled = fx.particleLyrics;
    if (!lyricsEnabled || !mesh || !currentLine) {
      if (mesh?.userData.lyric?.textMat) {
        mesh.userData.lyric.textMat.uniforms.uOpacity.value = 0;
      }
      if (root.userData.starRiverMat) {
        root.userData.starRiverMat.uniforms.uOpacity.value = 0;
      }
      return;
    }

    if (isPlaying) {
      resumeGalaxyAudioContext();
    }
    const bands = isPlaying
      ? getCachedGalaxyAudioBands()
      : { bass: 0, mid: 0, beat: 0, energy: 0 };
    const kick = isPlaying
      ? getGalaxyBeatCameraKick()
      : { thetaKick: 0, phiKick: 0, radiusKick: 0, rollKick: 0, punch: 0 };

    if (root.userData.starRiverMat) {
      root.userData.starRiverMat.uniforms.uBass.value = bands.bass;
      root.userData.starRiverMat.uniforms.uBeat.value = bands.beat;
    }

    root.getWorldPosition(worldPosRef.current);
    const cameraLockDistance =
      spatialAnchor === 'topography' ? camera.position.distanceTo(worldPosRef.current) : undefined;

    updateStageLyrics3D({
      stageRoot: root,
      currentMesh: mesh,
      camera,
      dt: delta,
      time: state.clock.elapsedTime,
      bands,
      kick,
      fx,
      runtime: runtimeRef.current,
      spatialAnchor,
      cameraLockDistance,
    });
  });

  return <primitive object={stageRoot} />;
}
