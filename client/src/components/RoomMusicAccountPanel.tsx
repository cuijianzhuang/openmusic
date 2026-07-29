import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, QrCode, Trash2 } from 'lucide-react';
import type { RoomMusicAccount, RoomMusicAccounts } from '../types';

type Platform = 'netease' | 'tencent';

interface QrSession {
  platform: Platform;
  key?: string;
  qrsig?: string;
  ptqrtoken?: string;
  qrurl?: string;
  qrimg?: string;
  message?: string;
}

interface Props {
  accounts: RoomMusicAccounts;
  onCreateQr: (platform: Platform) => Promise<{ success: boolean; error?: string; data?: Record<string, unknown> }>;
  onCheckQr: (payload: Record<string, unknown>) => Promise<{ success: boolean; error?: string; data?: Record<string, unknown> }>;
  onBind: (payload: {
    platform: Platform;
    cookie: string;
    shared?: boolean;
  }) => Promise<{ success: boolean; error?: string; message?: string }>;
  onRefresh: () => Promise<{ success: boolean; error?: string; data?: RoomMusicAccounts }>;
  onSetShared: (platform: Platform, shared: boolean) => Promise<{ success: boolean; error?: string }>;
  onUnbind: (platform: Platform) => Promise<{ success: boolean; error?: string }>;
}

function getShareBannerText(accounts: RoomMusicAccounts): string {
  const vipAccounts = [accounts.netease, accounts.tencent].filter((a) => a?.hasVip);
  const hasShared = vipAccounts.some((a) => a?.shared);

  if (hasShared) {
    return '感谢你的共享！大家都能用到～你是最棒的 ♪';
  }
  if (vipAccounts.length > 0) {
    return '如果方便的话，开一下共享好不好呀～拜托啦 >_<';
  }
  return '有会员的话，能不能帮大家开个共享呀～';
}

const SECURITY_NOTE = '账号加密保管，仅用于取歌，不会泄露给他人';

function ShareSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div>
        <p className="text-sm text-white">{checked ? '共享' : '不共享'}</p>
        <p className="mt-0.5 text-[11px] text-netease-muted">
          {checked ? '全站可用' : '仅房间可用'}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          checked ? 'bg-netease-red' : 'bg-white/20'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

function QrBlock({
  qrDisplay,
  statusText,
  onCancel,
}: {
  qrDisplay: string;
  statusText: string;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-4 text-center">
      {qrDisplay ? (
        <img
          src={qrDisplay}
          alt="登录二维码"
          className="mx-auto h-40 w-40 rounded-lg bg-white p-2"
        />
      ) : (
        <div className="mx-auto flex h-40 w-40 items-center justify-center rounded-lg bg-white/5">
          <Loader2 className="h-6 w-6 animate-spin text-white/50" />
        </div>
      )}
      <p className="mt-2.5 text-xs text-white/80">{statusText || '请扫码'}</p>
      <button
        type="button"
        className="mt-1.5 text-[11px] text-netease-muted underline"
        onClick={onCancel}
      >
        取消
      </button>
    </div>
  );
}

function PlatformCard({
  platform,
  label,
  account,
  busy,
  wantShared,
  onWantSharedChange,
  onStartQr,
  onToggleShared,
  onUnbind,
  scanning,
  qrDisplay,
  statusText,
  onCancelQr,
  error,
  hint,
}: {
  platform: Platform;
  label: string;
  account: RoomMusicAccount | null;
  busy: boolean;
  wantShared: boolean;
  onWantSharedChange: (v: boolean) => void;
  onStartQr: () => void;
  onToggleShared: (shared: boolean) => void;
  onUnbind: () => void;
  scanning: boolean;
  qrDisplay: string;
  statusText: string;
  onCancelQr: () => void;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-white">{label}</h4>
        {account ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] ${
              account.hasVip
                ? account.shared
                  ? 'bg-emerald-400/15 text-emerald-300'
                  : 'bg-sky-400/15 text-sky-300'
                : 'bg-amber-400/15 text-amber-300'
            }`}
          >
            {account.hasVip
              ? account.shared
                ? '全站可用'
                : '仅房间可用'
              : '仅漫游'}
          </span>
        ) : (
          <span className="text-[10px] text-netease-muted">未绑定</span>
        )}
      </div>

      {scanning ? (
        <QrBlock qrDisplay={qrDisplay} statusText={statusText} onCancel={onCancelQr} />
      ) : account ? (
        <>
          <div className="flex items-center gap-3">
            {account.avatarUrl ? (
              <img
                src={account.avatarUrl}
                alt=""
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xs text-white/50">
                {label.slice(0, 1)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-white">{account.nickname || '已登录'}</p>
              {account.isValid === false && (
                <p className="text-[11px] text-amber-300/90">可能已失效</p>
              )}
            </div>
          </div>

          {account.hasVip ? (
            <ShareSwitch
              checked={account.shared}
              disabled={busy}
              onChange={onToggleShared}
            />
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onStartQr}
              className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] py-2 text-xs text-white/80 hover:bg-white/[0.07] disabled:opacity-50"
            >
              重新扫码
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onUnbind}
              className="inline-flex items-center gap-1 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-300 hover:bg-red-400/15 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              解绑
            </button>
          </div>
        </>
      ) : (
        <>
          <ShareSwitch
            checked={wantShared}
            disabled={busy}
            onChange={onWantSharedChange}
          />
          <button
            type="button"
            disabled={busy}
            onClick={onStartQr}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-netease-red py-2.5 text-sm font-medium text-white hover:bg-netease-red/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
            扫码登录
          </button>
        </>
      )}

      {error && <p className="text-xs text-red-300">{error}</p>}
      {hint && !error && <p className="text-xs text-amber-300/90">{hint}</p>}
    </div>
  );
}

export default function RoomMusicAccountPanel({
  accounts,
  onCreateQr,
  onCheckQr,
  onBind,
  onRefresh,
  onSetShared,
  onUnbind,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorPlatform, setErrorPlatform] = useState<Platform | null>(null);
  const [hint, setHint] = useState('');
  const [hintPlatform, setHintPlatform] = useState<Platform | null>(null);
  const [statusText, setStatusText] = useState('');
  const [session, setSession] = useState<QrSession | null>(null);
  const [wantShared, setWantShared] = useState<{ netease: boolean; tencent: boolean }>({
    netease: false,
    tencent: false,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bindingRef = useRef(false);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const cancelQr = useCallback(() => {
    stopPoll();
    setSession(null);
    setStatusText('');
    setError('');
    setErrorPlatform(null);
    setHint('');
    setHintPlatform(null);
  }, [stopPoll]);

  useEffect(() => {
    void onRefresh();
    return () => stopPoll();
  }, [onRefresh, stopPoll]);

  const finishBind = useCallback(
    async (platform: Platform, cookie: string) => {
      if (bindingRef.current) return;
      bindingRef.current = true;
      setBusy(true);
      setStatusText('绑定中…');
      try {
        const res = await onBind({
          platform,
          cookie,
          shared: wantShared[platform],
        });
        if (!res.success) {
          setError(res.error || '绑定失败');
          setErrorPlatform(platform);
          setHint('');
          setHintPlatform(null);
          return;
        }
        setSession(null);
        setStatusText('');
        setError('');
        setErrorPlatform(null);
        if (res.message) {
          setHint(res.message);
          setHintPlatform(platform);
        } else {
          setHint('');
          setHintPlatform(null);
        }
        stopPoll();
      } finally {
        bindingRef.current = false;
        setBusy(false);
      }
    },
    [onBind, stopPoll, wantShared],
  );

  const startQr = useCallback(
    async (platform: Platform) => {
      stopPoll();
      setError('');
      setErrorPlatform(null);
      setStatusText('生成二维码…');
      setBusy(true);
      setSession({ platform });
      bindingRef.current = false;
      try {
        const res = await onCreateQr(platform);
        if (!res.success || !res.data) {
          setError(res.error || '生成失败');
          setErrorPlatform(platform);
          setStatusText('');
          setSession(null);
          return;
        }
        const next: QrSession = {
          platform,
          key: String(res.data.key || ''),
          qrsig: String(res.data.qrsig || res.data.key || ''),
          ptqrtoken: res.data.ptqrtoken != null ? String(res.data.ptqrtoken) : undefined,
          qrurl: res.data.qrurl ? String(res.data.qrurl) : undefined,
          qrimg: res.data.qrimg ? String(res.data.qrimg) : undefined,
          message: res.data.message ? String(res.data.message) : undefined,
        };
        setSession(next);
        setStatusText('请扫码');

        // 状态水位：waiting < scanned < confirmed，禁止回退到「等待扫码」
        let phase: 'waiting' | 'scanned' | 'done' = 'waiting';
        let checking = false;
        const checkPayload = platform === 'tencent'
          ? { platform, qrsig: next.qrsig, ptqrtoken: next.ptqrtoken }
          : { platform, key: next.key };

        const doCheck = async (): Promise<'retry' | 'done'> => {
          const check = await onCheckQr(checkPayload);
          if (!check.success || !check.data) return 'retry';
          const status = String(check.data.status || '');

          if (status === 'expired') {
            setStatusText('已过期，请重试');
            stopPoll();
            phase = 'done';
            return 'done';
          }

          if (status === 'confirmed') {
            const cookie = String(check.data.cookie || '');
            if (!cookie) {
              setError('登录成功但未拿到凭证');
              setErrorPlatform(platform);
              stopPoll();
              phase = 'done';
              return 'done';
            }
            phase = 'done';
            setStatusText('授权成功，绑定中…');
            stopPoll();
            await finishBind(platform, cookie);
            return 'done';
          }

          if (status === 'scanned') {
            phase = 'scanned';
            setStatusText('已扫码，请在手机上确认');
            return 'retry';
          }

          if (status === 'error') {
            const msg = String(check.data.message || check.error || '扫码异常');
            // 已扫过时保留提示，避免回退；否则显示错误
            if (phase === 'waiting') {
              setError(msg);
              setErrorPlatform(platform);
            } else {
              setStatusText('授权处理中，请稍候…');
            }
            return 'retry';
          }

          // waiting / 其它：已扫过就不要把文案打回「等待扫码」
          if (phase === 'waiting') {
            setStatusText('等待扫码…');
          } else if (phase === 'scanned') {
            setStatusText('已扫码，请在手机上确认');
          }
          return 'retry';
        };

        // 立刻查一次，不要干等首个 interval
        checking = true;
        void (async () => {
          try {
            await doCheck();
          } finally {
            checking = false;
          }
        })();

        pollRef.current = setInterval(() => {
          if (checking || phase === 'done') return;
          checking = true;
          void (async () => {
            try {
              await doCheck();
            } finally {
              checking = false;
            }
          })();
        }, 2000);
      } catch (e) {
        setError(e instanceof Error ? e.message : '生成失败');
        setErrorPlatform(platform);
        setStatusText('');
        setSession(null);
      } finally {
        setBusy(false);
      }
    },
    [finishBind, onCheckQr, onCreateQr, stopPoll],
  );

  const qrDisplay =
    session?.qrimg ||
    (session?.qrurl
      ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(session.qrurl)}`
      : '');

  const cardProps = (platform: Platform, label: string) => ({
    platform,
    label,
    account: platform === 'netease' ? accounts.netease : accounts.tencent,
    busy,
    wantShared: wantShared[platform],
    onWantSharedChange: (v: boolean) => setWantShared((s) => ({ ...s, [platform]: v })),
    onStartQr: () => void startQr(platform),
    onToggleShared: (shared: boolean) => {
      setBusy(true);
      void onSetShared(platform, shared)
        .then((res) => {
          if (!res.success) {
            setError(res.error || (shared ? '加入共享失败' : '移出共享失败'));
            setErrorPlatform(platform);
          } else {
            setError('');
            setErrorPlatform(null);
          }
        })
        .finally(() => setBusy(false));
    },
    onUnbind: () => {
      setBusy(true);
      void onUnbind(platform).finally(() => setBusy(false));
    },
    scanning: session?.platform === platform,
    qrDisplay: session?.platform === platform ? qrDisplay : '',
    statusText: session?.platform === platform ? statusText : '',
    onCancelQr: cancelQr,
    error: errorPlatform === platform ? error : undefined,
    hint: hintPlatform === platform ? hint : undefined,
  });

  const shareBannerText = useMemo(() => getShareBannerText(accounts), [accounts]);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="shrink-0 text-sm font-medium text-white">音源账号</h3>
        <p className="text-right text-[11px] leading-relaxed text-netease-muted">
          {shareBannerText}
        </p>
      </div>
      <PlatformCard {...cardProps('netease', '网易云')} />
      <PlatformCard {...cardProps('tencent', 'QQ 音乐')} />
      <p className="text-center text-[10px] leading-relaxed text-netease-muted/80">
        {SECURITY_NOTE}
      </p>
    </section>
  );
}
