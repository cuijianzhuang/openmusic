import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  NETEASE_QUALITY_OPTIONS,
  TENCENT_QUALITY_OPTIONS,
  normalizeRoomAudioQuality,
} from '../api/music/quality';
import type { RoomAudioQuality } from '../types';

interface Props {
  open: boolean;
  value: RoomAudioQuality;
  saving?: boolean;
  onClose: () => void;
  onSave: (quality: RoomAudioQuality) => void;
}

export default function RoomQualityModal({ open, value, saving = false, onClose, onSave }: Props) {
  if (!open) return null;

  const current = normalizeRoomAudioQuality(value);

  const handleNeteaseChange = (netease: string) => {
    onSave({ ...current, netease });
  };

  const handleTencentChange = (tencent: string) => {
    onSave({ ...current, tencent });
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-netease-border/60 bg-netease-panel p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">房间音质</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-xs text-netease-muted">
          由低到高排列；实际可获取音质取决于会员权限及歌曲版权。
        </p>

        <div className="space-y-4">
          <section>
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: '#ec4141' }}>
                网易
              </span>
              <span className="text-sm text-netease-muted">网易云音乐</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {NETEASE_QUALITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={saving}
                  onClick={() => handleNeteaseChange(opt.value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    current.netease === opt.value
                      ? 'bg-netease-red text-white'
                      : 'bg-white/6 text-netease-muted hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: '#31c27c' }}>
                QQ
              </span>
              <span className="text-sm text-netease-muted">QQ音乐</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {TENCENT_QUALITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={saving}
                  onClick={() => handleTencentChange(opt.value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    current.tencent === opt.value
                      ? 'bg-[#31c27c] text-white'
                      : 'bg-white/6 text-netease-muted hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
