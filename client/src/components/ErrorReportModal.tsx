import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from './Modal';
import { fetchWithTimeout } from '../api/http';
import { collectErrorReportBundle } from '../lib/debugTools';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ErrorReportModal({ open, onClose }: Props) {
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [okHint, setOkHint] = useState('');

  const close = () => {
    if (busy) return;
    setError('');
    setOkHint('');
    onClose();
  };

  const submit = async () => {
    const text = description.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    setOkHint('');
    try {
      const bundle = collectErrorReportBundle(text);
      const res = await fetchWithTimeout('/api/error-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle),
      }, 20_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || `提交失败（${res.status}）`);
      }
      setOkHint('已提交，感谢反馈');
      setDescription('');
      window.dispatchEvent(
        new CustomEvent('openmusic:visual-toast', {
          detail: { message: '错误上报已提交', type: 'success' },
        }),
      );
      window.setTimeout(() => {
        setOkHint('');
        onClose();
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} panelClassName="relative w-full max-w-md animate-fade-in rounded-2xl border border-white/10 bg-netease-dark p-5 shadow-2xl">
      <h3 className="text-base font-semibold text-white">上报错误/提交意见</h3>
      <p className="mt-1 text-xs text-white/50">
        描述你遇到的问题或想提的意见；提交时会附带当前播放状态与近期调试日志，便于管理员排查。
      </p>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={500}
        rows={5}
        placeholder="例如：切歌后没声音 / 歌词不同步 / 希望增加某某功能…"
        className="mt-3 w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30"
        disabled={busy}
      />
      <div className="mt-1 flex justify-between text-[11px] text-white/40">
        <span>最多 500 字</span>
        <span>{description.trim().length}/500</span>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {okHint && <p className="mt-2 text-xs text-emerald-400">{okHint}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={close}
          disabled={busy}
          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white disabled:opacity-40"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !description.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          提交
        </button>
      </div>
    </Modal>
  );
}
