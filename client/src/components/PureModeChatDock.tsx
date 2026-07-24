import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, MessageCircle } from 'lucide-react';
import ChatPanel from './ChatPanel';
import { useMediaQuery } from '../hooks/useMediaQuery';

const CLOSE_DELAY_MS = 280;
const PANEL_WIDTH = 360;

export default function PureModeChatDock() {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const isLgUp = useMediaQuery('(min-width: 1024px)');

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, CLOSE_DELAY_MS);
  }, [cancelClose]);

  const handleOpen = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);

  const handleClose = useCallback(() => {
    cancelClose();
    setOpen(false);
  }, [cancelClose]);

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  useEffect(() => () => cancelClose(), [cancelClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, handleClose]);

  return (
    <>
      {isLgUp && (
        <div
          className="fixed right-0 top-14 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-40 w-3"
          onMouseEnter={handleOpen}
          aria-hidden
        />
      )}

      <button
        type="button"
        data-guide="room-chat"
        onMouseEnter={isLgUp ? handleOpen : undefined}
        onClick={!isLgUp ? handleToggle : undefined}
        className={`fixed right-0 top-1/2 z-50 flex -translate-y-1/2 items-center gap-1 rounded-l-xl border border-r-0 border-white/10 bg-netease-card/90 py-3 pl-2 pr-1.5 text-netease-muted shadow-lg backdrop-blur-md transition-all duration-200 hover:bg-netease-card hover:text-white ${
          open ? 'pointer-events-none translate-x-full opacity-0' : 'translate-x-0 opacity-100'
        }`}
        aria-label={open ? '聊天室已展开' : '展开聊天室'}
        aria-expanded={open}
      >
        <MessageCircle className="h-4 w-4 flex-shrink-0" />
        <span
          className="text-[10px] font-medium tracking-widest [writing-mode:vertical-rl]"
        >
          聊天
        </span>
      </button>

      <aside
        className={`fixed right-0 top-14 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-50 flex flex-col border-l border-white/10 room-glass-bar shadow-2xl transition-[transform,opacity] duration-200 ease-out ${
          open ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none'
        }`}
        style={{ width: PANEL_WIDTH, maxWidth: 'min(92vw, 360px)' }}
        onMouseEnter={isLgUp ? handleOpen : undefined}
        onMouseLeave={isLgUp ? scheduleClose : undefined}
        aria-hidden={!open}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ChatPanel className="rounded-none border-0 bg-transparent" />
        </div>

        {!isLgUp && (
          <button
            type="button"
            onClick={handleClose}
            className="absolute left-0 top-1/2 z-10 flex h-10 w-5 -translate-x-full -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-white/10 bg-netease-card/90 text-netease-muted backdrop-blur-md"
            aria-label="收起聊天室"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </aside>
    </>
  );
}
