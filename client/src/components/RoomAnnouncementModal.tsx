import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const MAX_LENGTH = 2000;

interface Props {
  open: boolean;
  enabled: boolean;
  text: string;
  saving?: boolean;
  onClose: () => void;
  onSave: (options: { enabled: boolean; text: string }) => void;
}

export default function RoomAnnouncementModal({
  open,
  enabled,
  text,
  saving = false,
  onClose,
  onSave,
}: Props) {
  const [draftEnabled, setDraftEnabled] = useState(enabled);
  const [draftText, setDraftText] = useState(text);

  useEffect(() => {
    if (!open) return;
    setDraftEnabled(enabled);
    setDraftText(text);
  }, [open, enabled, text]);

  if (!open) return null;

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
          <h2 className="text-base font-semibold text-white">房间公告</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="mb-4 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-white">开启公告</p>
            <p className="mt-0.5 text-xs text-netease-muted">开启后，新进房间的用户将弹窗展示公告</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draftEnabled}
            disabled={saving}
            onClick={() => setDraftEnabled((v) => !v)}
            className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              draftEnabled ? 'bg-netease-red' : 'bg-white/20'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                draftEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </label>

        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="announcement-text" className="text-xs text-netease-muted">公告内容</label>
            <span className="text-[10px] text-netease-muted">{draftText.length}/{MAX_LENGTH}</span>
          </div>
          <textarea
            id="announcement-text"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value.slice(0, MAX_LENGTH))}
            disabled={saving}
            rows={6}
            placeholder="输入房间公告…"
            className="w-full resize-none rounded-xl border border-netease-border/60 bg-netease-dark px-3 py-2 text-sm text-white outline-none focus:border-netease-red/50 disabled:opacity-50"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl px-4 py-2 text-sm text-netease-muted transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave({ enabled: draftEnabled, text: draftText.trim() })}
            className="rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-netease-red/90 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
