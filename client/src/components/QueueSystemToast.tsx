import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useChatSystemToastStore } from '../stores/chatSystemToastStore';
import { useRoomStore } from '../stores/roomStore';

const VISIBLE_MS = 2800;
const FADE_MS = 320;

/** 切歌 / 点歌等系统提示，以及重连状态，居中覆盖在播放队列标题栏正中间 */
export default function QueueSystemToast() {
  const text = useChatSystemToastStore((s) => s.text);
  const seq = useChatSystemToastStore((s) => s.seq);
  const clear = useChatSystemToastStore((s) => s.clear);
  const isReconnecting = useRoomStore((s) => s.isReconnecting);
  const [phase, setPhase] = useState<'hidden' | 'visible' | 'exit'>('hidden');

  useEffect(() => {
    if (!text) {
      setPhase('hidden');
      return;
    }

    setPhase('visible');
    const exitTimer = window.setTimeout(() => setPhase('exit'), VISIBLE_MS);
    const clearTimer = window.setTimeout(() => clear(), VISIBLE_MS + FADE_MS);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(clearTimer);
    };
  }, [text, seq, clear]);

  if (isReconnecting) {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-2">
        <p
          className="flex max-w-full items-center gap-1.5 truncate rounded-full bg-black px-3 py-0.5 text-center text-xs leading-5 text-white"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin" />
          <span className="truncate">连接已断开，正在自动重新加入房间…</span>
        </p>
      </div>
    );
  }

  if (!text || phase === 'hidden') return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-2">
      <p
        className={`max-w-full truncate rounded-full border border-netease-border/50 bg-netease-card px-3 py-0.5 text-center text-xs leading-5 text-netease-muted transition-opacity duration-300 ${
          phase === 'exit' ? 'opacity-0' : 'opacity-100 animate-fade-in'
        }`}
        role="status"
        aria-live="polite"
      >
        {text}
      </p>
    </div>
  );
}
