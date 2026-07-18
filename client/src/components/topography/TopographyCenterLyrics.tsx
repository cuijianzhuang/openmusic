import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSmoothPlaybackTime } from '../../hooks/useSmoothPlaybackTime';
import { useTrackLyrics } from '../../hooks/useTrackLyrics';
import { clampPlaybackTime, useTrackDuration } from '../../hooks/useTrackDuration';
import { ensureLyricFontLoaded, lyricFontDataAttr } from '../../lib/lyricFonts';
import { getCachedGalaxyAudioBands } from '../galaxy/lib/galaxyAudio';
import {
  lyricFontStackForKey,
  lyricFontWeightValue,
  lyricLineHeightFactor,
  lyricLetterSpacingPx,
  normalizeLyricFontKey,
} from '../../lib/lyricStyle';
import { roomVisualFxLive, subscribeRoomVisualFx } from '../../lib/roomVisualFxLive';
import {
  stageLyricPaletteLive,
  subscribeStageLyricPalette,
} from '../../lib/stageLyricPaletteLive';
import { useRoomStore } from '../../stores/roomStore';
import { getActiveLyricWithProgress } from './lib/topographyLyric';
import {
  buildTopographyLyricTransform,
  topographyLyricGlowBlurPx,
} from './lib/topographyLyricLayout';

export default function TopographyCenterLyrics() {
  const current = useRoomStore((s) => s.room?.current ?? null);
  const lyrics = useTrackLyrics(current);
  const currentTime = useSmoothPlaybackTime();
  const duration = useTrackDuration(current);
  const displayTime = clampPlaybackTime(currentTime, duration);
  const [fxRevision, setFxRevision] = useState(0);
  const [fontRevision, setFontRevision] = useState(0);
  const [fitScale, setFitScale] = useState(1);
  const lineRef = useRef<HTMLParagraphElement>(null);
  const beatGlowRef = useRef(0);

  useEffect(() => subscribeRoomVisualFx(() => setFxRevision((v) => v + 1)), []);
  useEffect(() => subscribeStageLyricPalette(() => setFxRevision((v) => v + 1)), []);

  const fx = roomVisualFxLive.current;
  const lyricFontKey = normalizeLyricFontKey(fx.lyricFont);
  const palette = stageLyricPaletteLive.palette;
  const enabled = fx.particleLyrics;
  const showTranslation = fx.lyricShowTranslation !== false;

  useEffect(() => {
    let cancelled = false;
    void ensureLyricFontLoaded(fx).then(() => {
      if (!cancelled) setFontRevision((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [lyricFontKey, fx.lyricWeight, fxRevision]);

  const active = getActiveLyricWithProgress(lyrics, displayTime, showTranslation);

  useLayoutEffect(() => {
    const line = lineRef.current;
    if (!line || !enabled || !active?.text) {
      setFitScale(1);
      return;
    }

    const measure = () => {
      const el = lineRef.current;
      if (!el) return;
      const liveFx = roomVisualFxLive.current;
      const userScale = Math.max(0.35, Math.min(1.65, Number(liveFx.lyricScale) || 1));
      const depthScale = 1 + Math.max(-1.6, Math.min(1.6, Number(liveFx.lyricOffsetZ) || 0)) * 0.14;
      const layoutScale = Math.max(0.2, userScale * depthScale);
      const safeW = Math.max(160, window.innerWidth * 0.9);
      const safeH = Math.max(80, window.innerHeight * 0.42);
      const width = Math.max(1, el.scrollWidth) * layoutScale;
      const height = Math.max(1, el.scrollHeight) * layoutScale;
      const next = Math.min(1, safeW / width, safeH / height);
      setFitScale(Number.isFinite(next) ? Math.max(0.35, next) : 1);
    };

    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(line);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [enabled, active?.text, fxRevision, fontRevision]);

  useEffect(() => {
    const line = lineRef.current;
    if (!line || !enabled || !active?.text) return;

    if (!fx.lyricGlow || !fx.lyricGlowBeat) {
      beatGlowRef.current = 0;
      line.style.setProperty('--lyric-glow-beat', '0');
      line.style.setProperty(
        '--lyric-glow-blur',
        String(topographyLyricGlowBlurPx(fx, 0)),
      );
      return;
    }

    let raf = 0;
    const tick = () => {
      const el = lineRef.current;
      if (!el) return;
      const liveFx = roomVisualFxLive.current;
      const beat = getCachedGalaxyAudioBands().beat;
      beatGlowRef.current += (beat * 1.15 - beatGlowRef.current) * 0.22;
      el.style.setProperty('--lyric-glow-beat', String(beatGlowRef.current));
      el.style.setProperty(
        '--lyric-glow-blur',
        String(topographyLyricGlowBlurPx(liveFx, beatGlowRef.current)),
      );
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, active?.text, fx.lyricGlow, fx.lyricGlowBeat, fxRevision]);

  if (!enabled || !active?.text) return null;

  const fontSize = typeof window !== 'undefined'
    ? Math.min(72, Math.max(30, window.innerWidth * 0.052))
    : 48;
  const letterSpacing = lyricLetterSpacingPx(fx, fontSize);
  const lineHeight = lyricLineHeightFactor(fx);
  const glowBlur = topographyLyricGlowBlurPx(fx, beatGlowRef.current);
  const layoutTransform = buildTopographyLyricTransform(fx, fitScale);
  const fontWeight = lyricFontWeightValue(fx);
  const fontFamily = lyricFontStackForKey(lyricFontKey);
  const stoneClass = lyricFontKey === 'stone-song' ? ' topography-center-lyric-stone' : '';

  return (
    <div className="topography-center-lyrics" aria-hidden>
      <div className="topography-center-lyric-transform" style={layoutTransform}>
        <p
          ref={lineRef}
          key={`${active.text}:${active.translation || ''}:${showTranslation}:${lyricFontKey}:${fontRevision}`}
          data-lyric-font={lyricFontDataAttr(lyricFontKey)}
          className={`topography-center-lyric-line topography-center-lyric-in${fx.lyricGlowParticles ? ' topography-center-lyric-particles' : ''}${stoneClass}`}
          style={{
            fontFamily,
            fontWeight,
            letterSpacing: letterSpacing ? `${letterSpacing}px` : undefined,
            lineHeight,
            ['--lyric-primary' as string]: palette.primary,
            ['--lyric-highlight' as string]: palette.highlight,
            ['--lyric-glow' as string]: palette.glowColor || palette.glow,
            ['--lyric-progress' as string]: String(active.progress),
            ['--lyric-glow-blur' as string]: String(glowBlur),
            ['--lyric-glow-beat' as string]: '0',
          }}
        >
          {active.lines.length > 1 ? (
            active.lines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))
          ) : (
            active.text
          )}
        </p>
      </div>
    </div>
  );
}
