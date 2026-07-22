import { useEffect } from 'react';
import { Radio, X } from 'lucide-react';
import type { DjRadioItem } from '../api/music/djRadio';
import DjRadioPanel from './DjRadioPanel';
import { immersiveGlassDrawer, immersiveGlassScrim, immersiveGlassSheetHeader } from '../lib/immersiveGlass';

const PANEL_WIDTH = 360;

interface Props {
  open: boolean;
  immersive?: boolean;
  onClose: () => void;
  onSelectRadio: (radio: DjRadioItem) => Promise<void>;
}

export default function DjRadioDrawer({ open, immersive = false, onClose, onSelectRadio }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSelect = async (radio: DjRadioItem) => {
    await onSelectRadio(radio);
    onClose();
  };

  return (
    <div className={`fixed inset-0 z-[90] ${immersive ? '' : 'hidden lg:block'}`}>
      <button
        type="button"
        className={`absolute inset-0 ${immersive ? immersiveGlassScrim : 'bg-black/50 backdrop-blur-[1px]'}`}
        onClick={onClose}
        aria-label="关闭音乐电台"
      />
      <aside
        className={`absolute left-3 flex flex-col overflow-hidden shadow-2xl animate-fade-in ${
          immersive
            ? `${immersiveGlassDrawer} top-3 bottom-3 rounded-[22px]`
            : 'top-[calc(3.5rem+env(safe-area-inset-top,0px))] bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] rounded-3xl border border-netease-border/50 bg-[#101012]/95 backdrop-blur-xl'
        }`}
        style={{ width: PANEL_WIDTH, maxWidth: 'min(calc(100vw - 1.5rem), 360px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex flex-shrink-0 items-center justify-between gap-2 px-4 py-3 ${immersive ? immersiveGlassSheetHeader : 'border-b border-netease-border/40'}`}>
          <div className="flex min-w-0 items-center gap-2">
            <Radio className="h-4 w-4 flex-shrink-0 text-rose-400" />
            <h2 className="text-sm font-medium text-white">音乐电台</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <DjRadioPanel hideHeader immersive={immersive} onSelectRadio={handleSelect} />
        </div>
      </aside>
    </div>
  );
}
