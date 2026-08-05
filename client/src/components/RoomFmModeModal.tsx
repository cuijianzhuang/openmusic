import { createPortal } from 'react-dom';
import { Lock, X } from 'lucide-react';
import { NETEASE_FM_MODE_OPTIONS, QISHUI_FM_MODE_OPTIONS, normalizeFmMode } from '../api/music/fmMode';

interface Props {
  open: boolean;
  value: string;
  source?: 'netease' | 'qishui';
  saving?: boolean;
  qishuiLocked?: boolean;
  onClose: () => void;
  onSave: (mode: string, source: 'netease' | 'qishui') => void;
}

export default function RoomFmModeModal({ open, value, source = 'netease', saving = false, qishuiLocked = false, onClose, onSave }: Props) {
  if (!open) return null;

  const current = normalizeFmMode(value);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div
        className="relative w-full max-w-md animate-fade-in rounded-2xl border border-white/10 bg-netease-dark p-5 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">私人漫游模式</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 text-xs text-netease-muted">
          队列为空时通过私人漫游自动推荐下一首
        </p>

        <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
          {([['netease', '网易'], ['qishui', '汽水']] as const).map(([item, label]) => {
            const locked = item === 'qishui' && qishuiLocked;
            return (
            <button key={item} type="button" disabled={saving || locked} onClick={() => onSave(item === 'qishui' ? 'DEFAULT' : current, item)}
              title={locked ? '没有可用汽水会员账号' : undefined}
              className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium ${source === item ? 'bg-white/10 text-white' : 'text-netease-muted hover:bg-white/5 hover:text-white'} disabled:cursor-not-allowed disabled:opacity-45`}>
              {locked ? <Lock className="h-3 w-3" aria-hidden /> : null}
              {label}
            </button>
          )})}
        </div>

        {qishuiLocked ? (
          <p className="mb-4 rounded-lg bg-white/[0.035] px-3 py-2 text-xs leading-5 text-white/45">
            没有可用汽水会员账号。
          </p>
        ) : null}

        <div className="max-h-[min(52vh,420px)] space-y-2 overflow-y-auto pr-1">
          {(source === 'qishui' ? QISHUI_FM_MODE_OPTIONS : NETEASE_FM_MODE_OPTIONS).map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={saving}
              onClick={() => onSave(opt.value, source)}
              className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                current === opt.value
                  ? 'border-netease-red/25 bg-netease-red/[0.08]'
                  : 'border-transparent bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              <p className={`text-sm font-medium ${current === opt.value ? 'text-white' : 'text-white/90'}`}>
                {opt.label}
              </p>
              {opt.description && (
                <p className="mt-0.5 text-xs text-netease-muted">{opt.description}</p>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
