import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  getQualityOptionsForSource,
  normalizeRoomAudioQuality,
  refreshQualityCapabilities,
  clampQualityToCapabilities,
} from '../api/music/quality';
import { useSiteFeaturesStore } from '../stores/siteFeaturesStore';
import type { RoomAudioQuality } from '../types';

interface Props {
  open: boolean;
  value: RoomAudioQuality;
  saving?: boolean;
  onClose: () => void;
  onSave: (quality: RoomAudioQuality) => void;
}

export default function RoomQualityModal({ open, value, saving = false, onClose, onSave }: Props) {
  const svipQualityEnabled = useSiteFeaturesStore((s) => s.svipQualityEnabled);
  const [draft, setDraft] = useState(() => normalizeRoomAudioQuality(value));

  useEffect(() => {
    if (!open) return;
    void refreshQualityCapabilities();
    const next = normalizeRoomAudioQuality(value);
    setDraft({
      netease: clampQualityToCapabilities('netease', next.netease),
      tencent: clampQualityToCapabilities('tencent', next.tencent),
    });
  }, [open, value, svipQualityEnabled]);

  const neteaseOptions = useMemo(() => getQualityOptionsForSource('netease'), [svipQualityEnabled]);
  const tencentOptions = useMemo(() => getQualityOptionsForSource('tencent'), [svipQualityEnabled]);

  if (!open) return null;

  const current = draft;
  const baseline = normalizeRoomAudioQuality(value);
  const dirty = current.netease !== clampQualityToCapabilities('netease', baseline.netease)
    || current.tencent !== clampQualityToCapabilities('tencent', baseline.tencent);

  const handleNeteaseChange = (netease: string) => {
    setDraft((prev) => ({ ...prev, netease }));
  };

  const handleTencentChange = (tencent: string) => {
    setDraft((prev) => ({ ...prev, tencent }));
  };

  const handleApply = () => {
    if (!dirty || saving) return;
    onSave(current);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div
        className="relative w-full max-w-md animate-fade-in rounded-2xl border border-white/10 bg-netease-dark p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">我的音质</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 text-xs leading-5 text-netease-muted">
          仅影响你本机的播放，网络较慢时可选择较低音质以减少卡顿
        </p>

        <div className="space-y-4">
          <section>
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-netease-red" aria-hidden />
              <span className="text-sm text-netease-muted">红点</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {neteaseOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={saving}
                  onClick={() => handleNeteaseChange(opt.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    current.netease === opt.value
                      ? 'border-netease-red/40 bg-netease-red/15 text-white'
                      : 'border-white/10 bg-netease-card text-netease-muted hover:border-white/20 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-[#31c27c]" aria-hidden />
              <span className="text-sm text-netease-muted">绿点</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {tencentOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={saving}
                  onClick={() => handleTencentChange(opt.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    current.tencent === opt.value
                      ? 'border-[#31c27c]/40 bg-[#31c27c]/15 text-white'
                      : 'border-white/10 bg-netease-card text-netease-muted hover:border-white/20 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-netease-muted transition-colors hover:border-white/20 hover:text-white"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={handleApply}
            className="rounded-lg bg-netease-red px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            {saving ? '保存中…' : '应用'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
