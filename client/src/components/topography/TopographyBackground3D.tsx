import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import type { QueueItem } from '../../types';
import GalaxyBeatMapDriver from '../galaxy/GalaxyBeatMapDriver';
import GalaxyGestureSceneBridge from '../galaxy/GalaxyGestureSceneBridge';
import GestureHudOverlay from '../galaxy/GestureHudOverlay';
import TopographyAudioDriver from './TopographyAudioDriver';
import TopographyMapScene from './TopographyMapScene';
import { DEFAULT_TOPOGRAPHY_CAMERA_STATE } from './lib/topographySceneDefaults';

interface Props {
  className?: string;
  isPlaying: boolean;
  song?: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'> | null;
}

export default function TopographyBackground3D({
  className = 'absolute inset-0',
  isPlaying,
  song,
}: Props) {
  const cam = DEFAULT_TOPOGRAPHY_CAMERA_STATE.position;
  return (
    <div className={`${className} overflow-hidden bg-[#08090b]`} aria-hidden>
      <GestureHudOverlay />
      <Canvas
        className="!absolute inset-0 h-full w-full"
        style={{ width: '100%', height: '100%', display: 'block' }}
        dpr={[1, 1.5]}
        frameloop="always"
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
        }}
        camera={{ fov: 45, near: 0.1, far: 200, position: [cam.x, cam.y, cam.z] }}
        onCreated={({ gl, scene, camera }) => {
          gl.setClearColor('#08090b', 1);
          gl.compile(scene, camera);
        }}
      >
        <color attach="background" args={['#08090b']} />
        <Suspense fallback={null}>
          <GalaxyBeatMapDriver song={song} isPlaying={isPlaying} />
          <GalaxyGestureSceneBridge />
          <TopographyAudioDriver />
          <TopographyMapScene />
        </Suspense>
      </Canvas>
    </div>
  );
}
