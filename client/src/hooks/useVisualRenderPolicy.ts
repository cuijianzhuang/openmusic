import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

export type VisualBackgroundPolicy = 'keep' | 'pause' | 'release';
export type VisualForegroundFpsMode = 'vsync' | 'adaptive' | '45' | '60' | '75' | '90' | '120';

/**
 * 网页版不做省电和限帧：画布常驻、always 帧循环。
 * 之前的 demand + 唤醒补帧会在暂停/拖拽/切档时出现停帧和上下文重建，
 * 后台由浏览器自己节流 rAF 就够了。
 */
const ALWAYS_ON_POLICY = {
  mounted: true,
  frameloop: 'always' as const,
  targetFps: 0,
};

export function useVisualRenderPolicy(_isPlaying: boolean) {
  return ALWAYS_ON_POLICY;
}

export function VisualFrameScheduler({ fps }: { fps: number }) {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    if (fps <= 0) return;
    let frame = 0;
    let last = 0;
    const interval = 1000 / fps;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < interval) return;
      last = now - ((now - last) % interval);
      invalidate();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [fps, invalidate]);

  return null;
}
