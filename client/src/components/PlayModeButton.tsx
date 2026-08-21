import { useCallback, useState } from 'react';
import { useRoomStore } from '../stores/roomStore';
import { useSocket } from '../hooks/useSocket';
import {
  normalizePlayMode,
  nextPlayMode,
  PLAY_MODE_META,
} from '../lib/playMode';
import Tooltip from './Tooltip';

interface Props {
  className?: string;
  iconClassName?: string;
}

export default function PlayModeButton({
  className = '',
  iconClassName = 'h-4 w-4',
}: Props) {
  const playMode = useRoomStore((s) => normalizePlayMode(s.room?.playMode));
  const canControl = useRoomStore((s) => s.canControlPlayback);
  const { setRoomPlayMode } = useSocket();
  const [busy, setBusy] = useState(false);
  const meta = PLAY_MODE_META[playMode];
  const nextMode = nextPlayMode(playMode);
  const nextMeta = PLAY_MODE_META[nextMode];
  const Icon = meta.Icon;

  const handleClick = useCallback(async () => {
    if (!canControl || busy) return;
    setBusy(true);
    try {
      const res = await setRoomPlayMode(nextMode);
      if (!res.success) {
        window.dispatchEvent(new CustomEvent('openmusic:visual-toast', {
          detail: { message: res.error || '切换失败', type: 'error' },
        }));
      } else {
        window.dispatchEvent(new CustomEvent('openmusic:visual-toast', {
          detail: { message: nextMeta.label, type: 'success' },
        }));
      }
    } catch {
      window.dispatchEvent(new CustomEvent('openmusic:visual-toast', {
        detail: { message: '切换失败，请稍后重试', type: 'error' },
      }));
    } finally {
      setBusy(false);
    }
  }, [busy, canControl, nextMeta.label, nextMode, setRoomPlayMode]);

  const tip = canControl
    ? `当前：${meta.label}，点击切换为${nextMeta.label}`
    : `当前：${meta.label}（仅房主或管理员可切换）`;

  return (
    <Tooltip content={tip} tapToShow={!canControl}>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy}
        className={`inline-flex min-h-[40px] min-w-[40px] flex-shrink-0 items-center justify-center rounded-full transition-[color,background-color,opacity,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-netease-red/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-wait disabled:opacity-50 ${
          !canControl ? 'cursor-not-allowed opacity-50' : 'active:scale-95'
        } ${
          playMode === 'order'
            ? 'text-netease-muted hover:bg-white/10 hover:text-white'
            : 'text-netease-red hover:bg-netease-red/15'
        } ${className}`}
        aria-label={tip}
        aria-disabled={!canControl || busy}
        aria-busy={busy}
        data-play-mode={playMode}
      >
        <Icon className={iconClassName} />
      </button>
    </Tooltip>
  );
}
