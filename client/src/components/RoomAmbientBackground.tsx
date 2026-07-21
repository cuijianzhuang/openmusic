import { Suspense, useEffect, useState } from 'react';
import { getCoverUrl } from '../api/music';
import type { QueueItem } from '../types';
import { ROOM_VISUAL_MODE_META, type RoomVisualMode } from '../lib/roomVisualPreset';
import { roomVisualFxLive, subscribeRoomVisualFx } from '../lib/roomVisualFxLive';
import { effectiveBackgroundColor } from '../lib/roomVisualAppearance';
import { syncGalaxyHandGestureMode } from './galaxy/lib/galaxyHandGesture';
import AmbientCoverLayers from './AmbientCoverLayers';
import { lazyWithRetry } from '../lib/lazyWithRetry';

const GalaxyBackground = lazyWithRetry(() => import('./galaxy/GalaxyBackground3D'), 'GalaxyBackground3D');
const TopographyBackground = lazyWithRetry(() => import('./topography/TopographyBackground3D'), 'TopographyBackground3D');

interface Props {
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'pic' | 'url'> | null | undefined;
  visualMode: RoomVisualMode;
  isPlaying: boolean;
  immersivePanelFocus?: 'search' | 'queue' | 'chat' | null;
}

export default function RoomAmbientBackground({
  song,
  visualMode,
  isPlaying,
  immersivePanelFocus = null,
}: Props) {
  const coverUrl = song ? getCoverUrl(song, 'medium') : null;
  const meta = ROOM_VISUAL_MODE_META[visualMode];
  const shaderPreset = meta.shaderPreset;
  const showShaderBackground = shaderPreset !== undefined;
  const isTopography = shaderPreset === 6;
  const showCoverUnderlay = visualMode === 'cover-bg' && Boolean(coverUrl);

  const [bgStyle, setBgStyle] = useState(() => {
    const fx = roomVisualFxLive.current;
    return {
      color: effectiveBackgroundColor(fx),
      opacity: fx.backgroundOpacity,
      media: fx.backgroundMedia,
    };
  });

  useEffect(() => {
    const sync = () => {
      const fx = roomVisualFxLive.current;
      setBgStyle({
        color: effectiveBackgroundColor(fx),
        opacity: fx.backgroundOpacity,
        media: fx.backgroundMedia,
      });
    };
    sync();
    return subscribeRoomVisualFx(sync);
  }, []);

  const showGalaxyShader = shaderPreset !== undefined;

  useEffect(() => {
    if (!showGalaxyShader) {
      void syncGalaxyHandGestureMode('off');
      return;
    }
    void syncGalaxyHandGestureMode(roomVisualFxLive.current.cameraInteraction);
    return () => {
      void syncGalaxyHandGestureMode('off');
    };
  }, [showGalaxyShader]);

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
      {bgStyle.media ? (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url("${bgStyle.media}")`,
            opacity: bgStyle.opacity,
          }}
        />
      ) : null}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: bgStyle.color,
          opacity: bgStyle.media ? Math.min(0.65, bgStyle.opacity) : bgStyle.opacity,
        }}
      />
      {visualMode === 'off' ? <div className="absolute inset-0 bg-[#08090b]" /> : null}
      {showCoverUnderlay ? (
        <div className="absolute inset-0">
          <AmbientCoverLayers coverUrl={coverUrl!} />
        </div>
      ) : null}
      {showShaderBackground ? (
        <Suspense fallback={null}>
          {isTopography ? (
            <TopographyBackground isPlaying={isPlaying} song={song} />
          ) : (
            <GalaxyBackground
              coverUrl={coverUrl}
              preset={shaderPreset!}
              isPlaying={isPlaying}
              song={song}
              immersivePanelFocus={immersivePanelFocus}
            />
          )}
        </Suspense>
      ) : null}
      {visualMode === 'cover-bg' && !coverUrl ? (
        <div className="absolute inset-0 bg-[#08090b]" />
      ) : null}
    </div>
  );
}
