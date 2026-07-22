import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, ArrowRight, Lock, ListMusic,
  Loader2, RefreshCw, Plus, X, Disc3, Sparkles, Github, History, Download, Smartphone,
  Play, Activity, Search, ShieldCheck
} from 'lucide-react';
import { createRoom, checkRoom, listRooms } from '../api/meting';
import { useRoomStore } from '../stores/roomStore';
import { useSocket } from '../hooks/useSocket';
import type { RoomSummary } from '../types';
import { usePageSeo } from '../lib/seo';
import { partitionRoomsByRecent } from '../lib/recentRooms';
import { getStoredRoomPassword } from '../lib/roomPassword';
import { areRoomListsEqual, isLobbyHardLocked, sortLobbyRooms } from '../lib/roomListCompare';
import { isMobileDevice } from '../lib/audioUnlock';
import { ANDROID_APK_URL } from '../lib/androidDownload';
import { IOS_IPA_URL } from '../lib/iosDownload';
import { resizeCoverUrl } from '../lib/coverUrl';
import {
  fetchSiteAnnouncement,
  markSiteAnnouncementSeen,
  shouldAutoShowSiteAnnouncement,
  type SiteAnnouncement,
} from '../lib/siteAnnouncement';
import Tooltip from '../components/Tooltip';
import ClientDownloadModal from '../components/ClientDownloadModal';
import SiteAnnouncementPopup from '../components/SiteAnnouncementPopup';
import BrandMark from '../components/BrandMark';
import { getRememberedAdminEntryPath } from '../lib/adminEntryShortcut';

/** 大厅只用接口带回的 CDN 直链，不走 meting type=pic 再查 */
function lobbyDirectCoverUrl(pic?: string): string | null {
  const raw = String(pic || '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.searchParams.get('type') === 'pic') return null;
  } catch {
    return null;
  }
  return resizeCoverUrl(raw, 'thumb');
}

function GiteeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" className={className} aria-hidden>
      <path d="M512 1024q-104 0-199-40-92-39-163-110T40 711Q0 616 0 512t40-199Q79 221 150 150T313 40q95-40 199-40t199 40q92 39 163 110t110 163q40 95 40 199t-40 199q-39 92-110 163T711 984q-95 40-199 40z m259-569H480q-10 0-17.5 7.5T455 480v64q0 10 7.5 17.5T480 569h177q11 0 18.5 7.5T683 594v13q0 31-22.5 53.5T607 683H367q-11 0-18.5-7.5T341 657V417q0-31 22.5-53.5T417 341h354q11 0 18-7t7-18v-63q0-11-7-18t-18-7H417q-38 0-72.5 14T283 283q-27 27-41 61.5T228 417v354q0 11 7 18t18 7h373q46 0 85.5-22.5t62-62Q796 672 796 626V480q0-10-7-17.5t-18-7.5z" />
    </svg>
  );
}

const repoLinkCls = 'p-2.5 rounded-full text-white/50 border border-white/5 bg-white/[0.02] hover:text-white hover:bg-white/10 hover:border-white/10 transition-all duration-300';

/** 逐字母渐变色：品牌红 → 玫红 → 紫，跨整个词插值（hover 时逐字点亮） */
function buildGradientLetters(text: string) {
  const stops = [
    [255, 77, 85],
    [244, 114, 182],
    [192, 132, 252],
  ];
  return text.split('').map((char, i, arr) => {
    const t = arr.length > 1 ? i / (arr.length - 1) : 0;
    const seg = t * (stops.length - 1);
    const idx = Math.min(Math.floor(seg), stops.length - 2);
    const f = seg - idx;
    const mix = stops[idx].map((v, c) => Math.round(v + (stops[idx + 1][c] - v) * f));
    return { char, color: `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})` };
  });
}

const BRAND_LETTERS = buildGradientLetters('OpenMusic');

const COVER_GRADIENTS = [
  'from-rose-500 to-orange-400',
  'from-sky-500 to-indigo-500',
  'from-violet-500 to-fuchsia-500',
  'from-emerald-500 to-teal-400',
  'from-amber-500 to-red-500',
  'from-cyan-500 to-blue-500',
  'from-pink-500 to-rose-500',
  'from-lime-500 to-emerald-500',
];

function gradientForId(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return COVER_GRADIENTS[hash % COVER_GRADIENTS.length];
}

function EqualizerBars({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-end gap-[3px] h-3.5 ${className}`}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-current animate-equalizer"
          style={{
            animationDelay: `${i * 0.12}s`,
            animationDuration: `${0.7 + (i % 3) * 0.18}s`,
          }}
        />
      ))}
    </span>
  );
}

/** 大厅封面：优先自定义封面，否则用接口带回的歌曲 CDN 直链（不走 meting type=pic） */
function lobbyCoverUrl(room: Pick<RoomSummary, 'customCoverUrl' | 'currentSong'>): string | null {
  const custom = String(room.customCoverUrl || '').trim();
  if (custom.startsWith('data:image/')) return custom;
  if (custom) {
    const fromCustom = lobbyDirectCoverUrl(custom);
    if (fromCustom) return fromCustom;
  }
  return lobbyDirectCoverUrl(room.currentSong?.pic);
}

const RoomCard = memo(function RoomCard({
  room,
  onJoin,
  isRecent,
}: {
  room: RoomSummary;
  onJoin: (room: RoomSummary) => void;
  isRecent?: boolean;
}) {
  const isActive = room.isPlaying && room.currentSong;
  const hardLocked = isLobbyHardLocked(room);
  const gradient = gradientForId(room.id);
  const coverUrl = lobbyCoverUrl(room);

  const cardRef = useRef<HTMLDivElement | HTMLButtonElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const resetTilt = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--tx', '0px');
    el.style.setProperty('--ty', '0px');
    el.style.setProperty('--tz', '0px');
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (hardLocked) return;
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;   // 0..1
    const py = (e.clientY - rect.top) / rect.height;   // 0..1
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      el.style.setProperty('--rx', `${(0.5 - py) * 10}deg`);
      el.style.setProperty('--ry', `${(px - 0.5) * 12}deg`);
      // 朝鼠标一侧偏移
      el.style.setProperty('--tx', `${(px - 0.5) * 14}px`);
      el.style.setProperty('--ty', `${(py - 0.5) * 14}px`);
      el.style.setProperty('--tz', '24px');
      // 跟随鼠标的高光位置
      el.style.setProperty('--mx', `${px * 100}%`);
      el.style.setProperty('--my', `${py * 100}%`);
    });
  }, [hardLocked]);

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);

  const cardClassName = `group relative w-full text-left rounded-[24px] border overflow-hidden backdrop-blur-md will-change-transform
    ${hardLocked
      ? 'border-white/5 bg-black/40 opacity-60 cursor-not-allowed'
      : 'border-white/10 bg-gradient-to-br from-white/[0.09] to-white/[0.02] shadow-xl shadow-black/40 hover:border-white/25 hover:from-white/[0.14] hover:to-white/[0.04] hover:shadow-2xl hover:shadow-black/70'
    }`;

  const tiltStyle: React.CSSProperties = hardLocked
    ? {}
    : {
        transform:
          'perspective(900px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg)) translate3d(var(--tx,0px),var(--ty,0px),var(--tz,0px))',
        transition: 'transform 0.18s ease-out, border-color 0.3s ease, box-shadow 0.3s ease',
        transformStyle: 'preserve-3d',
      };

  const body = (
    <>
      {/* 炫光背景 */}
      {isActive && !hardLocked && (
        <div className={`absolute -top-20 -right-20 w-48 h-48 rounded-full bg-gradient-to-br ${gradient} opacity-[0.08] blur-3xl group-hover:opacity-20 transition-opacity duration-500 pointer-events-none`} />
      )}

      {/* 鼠标跟随高光 */}
      {!hardLocked && (
        <div
          className="pointer-events-none absolute inset-0 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{
            background:
              'radial-gradient(340px circle at var(--mx,50%) var(--my,50%), rgba(255,255,255,0.14), transparent 60%)',
          }}
        />
      )}

      {/* 顶部细亮线，增强边缘立体感 */}
      {!hardLocked && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      )}

      <div className="relative p-5 sm:p-6" style={{ transformStyle: 'preserve-3d' }}>
        <div className="flex items-center gap-5" style={{ transformStyle: 'preserve-3d' }}>
          {/* 封面区块（倾斜时视差浮起） */}
          <div className="relative flex-shrink-0 transition-transform duration-300 ease-out [transform:translateZ(0)] group-hover:[transform:translateZ(45px)]">
            <div className={`relative w-16 h-16 sm:w-24 sm:h-24 rounded-2xl overflow-hidden bg-gradient-to-br ${gradient} flex items-center justify-center transition-all duration-300 shadow-[0_10px_22px_rgba(0,0,0,0.55),0_2px_5px_rgba(0,0,0,0.5),inset_0_1.5px_0_rgba(255,255,255,0.35),inset_0_-2px_4px_rgba(0,0,0,0.35)] ${hardLocked ? 'grayscale' : 'group-hover:shadow-[0_18px_36px_rgba(0,0,0,0.65),0_3px_7px_rgba(0,0,0,0.5),inset_0_1.5px_0_rgba(255,255,255,0.4),inset_0_-2px_4px_rgba(0,0,0,0.35)] group-hover:scale-105'}`}>
              {coverUrl && (
                <img
                  key={coverUrl}
                  src={coverUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
              )}
              {coverUrl && <div className="absolute inset-0 bg-black/20 pointer-events-none" />}
              {isActive && !hardLocked ? (
                <EqualizerBars className="relative text-white drop-shadow-md scale-110" />
              ) : !coverUrl ? (
                <Disc3 className={`relative w-8 h-8 sm:w-10 sm:h-10 text-white/90 drop-shadow-md transition-transform duration-500 ${hardLocked ? '' : 'group-hover:rotate-[20deg]'}`} />
              ) : null}
            </div>
            {isActive && !hardLocked && (
              <span className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-[#111] border border-white/10 backdrop-blur-md flex items-center justify-center shadow-xl">
                <Play className="w-3.5 h-3.5 text-netease-red fill-netease-red ml-0.5" />
              </span>
            )}
          </div>

          {/* 信息区块（倾斜时视差浮起） */}
          <div className="min-w-0 flex-1 flex flex-col h-full justify-center transition-transform duration-300 ease-out [transform:translateZ(0)] group-hover:[transform:translateZ(24px)]">
            <div className="flex items-center gap-2.5 mb-1.5">
              {isRecent && (
                <span className="flex-shrink-0 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-sky-200 bg-gradient-to-b from-sky-400/30 to-sky-600/15 ring-1 ring-sky-400/30 px-2 py-0.5 rounded-md font-bold shadow-[0_2px_5px_rgba(0,0,0,0.5),0_0_14px_rgba(56,189,248,0.3),inset_0_1px_0_rgba(255,255,255,0.25)]">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75 animate-ping" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-300" />
                  </span>
                  RECENT
                </span>
              )}
              {/* 房间名 */}
              <h3 className={`text-xl sm:text-[22px] font-black tracking-tight truncate ${hardLocked ? 'text-white/50' : 'text-emboss'}`}>
                {room.name}
              </h3>
              {room.hasPassword && !hardLocked && (
                <span className="flex-shrink-0 p-1 rounded-full bg-amber-400/10 text-amber-400 group-hover:bg-amber-400/20 transition-colors">
                  <Lock className="w-3.5 h-3.5" />
                </span>
              )}
            </div>

            {/* 歌名行：凹陷刻槽，和凸起的标题形成对比 */}
            {room.currentSong ? (
              <div className="min-w-0 max-w-full self-start mt-0.5 rounded-lg bg-black/25 px-2.5 py-1 shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.55),0_1px_0_rgba(255,255,255,0.06)]">
                <p className={`flex items-center gap-1.5 text-[13px] truncate transition-colors ${isActive && !hardLocked ? 'text-white/65' : 'text-white/50'} group-hover:text-white/75`}>
                  {isActive && !hardLocked && (
                    <span className="flex-shrink-0 text-netease-red/80 text-[12px] animate-pulse">♪</span>
                  )}
                  {/* 歌名优先：不参与收缩、最多占满整行；歌手名只用剩余空间被截断 */}
                  <span className="flex-none max-w-full truncate">{room.currentSong.name}</span>
                  <span className="flex-shrink-0 text-white/25">·</span>
                  <span className="min-w-0 truncate text-white/35 group-hover:text-white/50 transition-colors">{room.currentSong.artist}</span>
                </p>
              </div>
            ) : (
              <p className="self-start mt-0.5 rounded-lg bg-black/25 px-2.5 py-1 shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.55),0_1px_0_rgba(255,255,255,0.06)] text-[13px] text-white/30 italic group-hover:text-white/50 transition-colors">等待点播...</p>
            )}

            {/* 底部状态栏：分隔线做成刻痕（上暗下亮） */}
            <div className="flex items-center gap-2 sm:gap-5 mt-4 pt-3.5 border-t border-black/40 [box-shadow:inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors">
              <div className="flex min-w-0 items-center gap-1.5 sm:gap-2.5">
                <span className="inline-flex flex-shrink-0 items-center gap-1 sm:gap-1.5 whitespace-nowrap rounded-lg px-1.5 sm:px-2 py-1 text-xs font-semibold text-white/55 group-hover:text-white/85 transition-colors bg-gradient-to-b from-white/[0.09] to-white/[0.02] border border-white/10 shadow-[0_2px_4px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.12)]">
                  <Users className="w-3.5 h-3.5 flex-shrink-0 text-white/40 group-hover:text-emerald-400 group-hover:scale-110 transition-all duration-300" />
                  {room.userCount}人
                </span>
                <span className="inline-flex flex-shrink-0 items-center gap-1 sm:gap-1.5 whitespace-nowrap rounded-lg px-1.5 sm:px-2 py-1 text-xs font-semibold text-white/55 group-hover:text-white/85 transition-colors bg-gradient-to-b from-white/[0.09] to-white/[0.02] border border-white/10 shadow-[0_2px_4px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.12)]">
                  <ListMusic className="w-3.5 h-3.5 flex-shrink-0 text-white/40 group-hover:text-violet-400 group-hover:scale-110 transition-all duration-300" />
                  {room.queueLength}首
                </span>
              </div>
              
              <span className="ml-auto flex-shrink-0">
                {hardLocked ? (
                  <span className="flex items-center gap-1 whitespace-nowrap text-xs text-red-400/60 font-medium">
                    <Lock className="w-3.5 h-3.5" />
                    已上锁
                  </span>
                ) : (
                  <span className="hidden sm:flex items-center gap-1 text-[13px] text-netease-red opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 font-bold">
                    立即加入
                    <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <button
      type="button"
      ref={(node) => { cardRef.current = node; }}
      onClick={() => onJoin(room)}
      onMouseMove={handleMouseMove}
      onMouseLeave={resetTilt}
      className={cardClassName}
      style={tiltStyle}
    >
      {body}
    </button>
  );
});

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
        aria-label="关闭"
      />
      <div className="relative w-full max-w-md bg-[#111111]/90 backdrop-blur-xl rounded-[32px] border border-white/10 shadow-2xl p-7 animate-fade-in">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-white/40 bg-white/5 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const nickname = useRoomStore((s) => s.nickname);
  const setNickname = useRoomStore((s) => s.setNickname);
  const { leaveRoom } = useSocket();

  usePageSeo({
    title: '一起听歌 · 房间大厅',
    description: '创建或加入点歌房间，和好友一起听歌、多人实时同步播放；支持多音源搜索点歌与歌词跟唱。',
    path: '/',
  });

  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [adminEntryPath] = useState(() => getRememberedAdminEntryPath());
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [createRoomName, setCreateRoomName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [modalError, setModalError] = useState('');
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [siteAnnouncement, setSiteAnnouncement] = useState<SiteAnnouncement | null>(null);
  const [siteAnnouncementOpen, setSiteAnnouncementOpen] = useState(false);

  const heroCopyRef = useRef<HTMLParagraphElement | null>(null);
  const handleHeroCopyMove = useCallback((e: React.MouseEvent) => {
    const el = heroCopyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--hx', `${((e.clientX - rect.left) / rect.width) * 100}%`);
    el.style.setProperty('--hy', `${((e.clientY - rect.top) / rect.height) * 100}%`);
  }, []);

  const handleBtnTilt = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty('--brx', `${(-py * 16).toFixed(2)}deg`);
    el.style.setProperty('--bry', `${(px * 12).toFixed(2)}deg`);
  }, []);

  const resetBtnTilt = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    el.style.setProperty('--brx', '0deg');
    el.style.setProperty('--bry', '0deg');
  }, []);

  const fetchRooms = useCallback(async (silent = false) => {
    if (!silent) setRoomsLoading(true);
    try {
      const data = await listRooms();
      setRooms((prev) => (areRoomListsEqual(prev, data) ? prev : data));
    } catch {
      if (!silent) setError('加载房间列表失败');
    } finally {
      if (!silent) setRoomsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (useRoomStore.getState().room) {
      leaveRoom();
    }
  }, [leaveRoom]);

  useEffect(() => {
    fetchRooms();
    const POLL_MS = 8000;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchRooms(true);
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) fetchRooms(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchRooms]);

  // 空闲后再预热热歌榜 / Room chunk，避免与首屏房间列表抢带宽
  useEffect(() => {
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      void import('../api/music/toplist')
        .then((m) => m.getNeteaseHotToplist(200))
        .catch(() => {});
      void import('../pages/Room');
    };
    const ric = typeof window !== 'undefined'
      ? (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
      : undefined;
    const idleId = ric ? ric(warm, { timeout: 2500 }) : 0;
    const timeoutId = ric ? 0 : window.setTimeout(warm, 1200);
    return () => {
      cancelled = true;
      const cic = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (idleId && cic) cic(idleId);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchSiteAnnouncement().then((announcement) => {
      if (cancelled || !announcement) return;
      setSiteAnnouncement(announcement);
      if (shouldAutoShowSiteAnnouncement(announcement)) {
        setSiteAnnouncementOpen(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCloseSiteAnnouncement = useCallback(() => {
    if (siteAnnouncement?.id) {
      markSiteAnnouncementSeen(siteAnnouncement.id);
    }
    setSiteAnnouncementOpen(false);
  }, [siteAnnouncement?.id]);

  const goToRoom = (roomId: string, password?: string) => {
    navigate(`/room/${roomId}`, { state: password ? { password } : undefined });
  };

  const handleCreate = async () => {
    setActionLoading(true);
    setError('');
    setModalError('');
    try {
      const room = await createRoom(createRoomName, createPassword);
      setShowCreate(false);
      setCreateRoomName('');
      setCreatePassword('');
      goToRoom(room.id, createPassword.trim() || undefined);
    } catch {
      setModalError('创建房间失败，请重试');
    } finally {
      setActionLoading(false);
    }
  };

  const handleJoinByCode = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setModalError('请输入房间号');
      return;
    }
    setActionLoading(true);
    setError('');
    setModalError('');
    try {
      const result = await checkRoom(code);
      if (!result.exists) {
        setModalError('房间不存在，请检查房间号');
        return;
      }
      setShowJoin(false);
      setJoinCode('');
      setJoinPassword('');
      goToRoom(code, joinPassword.trim() || undefined);
    } catch {
      setModalError('加入房间失败，请重试');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRoomCardClick = useCallback((room: RoomSummary) => {
    setError('');
    const storedPassword = getStoredRoomPassword(room.id);
    if (room.hasPassword && !storedPassword) {
      navigate(`/room/${room.id}`, { state: { hasPassword: true } });
      return;
    }
    goToRoom(room.id, storedPassword);
  }, [navigate]);

  const { recent: recentRooms, others: otherRooms } = useMemo(() => {
    const { recent, others } = partitionRoomsByRecent(rooms);
    return {
      recent: sortLobbyRooms(recent),
      others: sortLobbyRooms(others),
    };
  }, [rooms]);

  const inputCls = 'w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-3.5 text-white text-[15px] placeholder:text-white/30 focus:outline-none focus:border-netease-red/60 focus:bg-white/[0.03] transition-all duration-300';

  return (
    <div className="h-full flex flex-col relative overflow-hidden bg-[#050505] text-white font-sans selection:bg-netease-red/30">
      {/* 背景光效 */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[10%] w-[600px] h-[600px] bg-netease-red/5 rounded-full blur-[140px] mix-blend-screen" />
        <div className="absolute bottom-[-10%] right-[10%] w-[500px] h-[500px] bg-purple-600/5 rounded-full blur-[120px] mix-blend-screen" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.02]" />
      </div>

      {/* 悬浮顶栏 */}
      <header className="relative z-20 pt-6 px-4 sm:px-6 max-w-7xl mx-auto w-full">
        <div className="bg-white/[0.03] border border-white/10 backdrop-blur-xl rounded-full px-5 py-3 flex items-center justify-between shadow-2xl">
          <div className="flex items-center gap-3">
            <BrandMark className="h-10 w-10 drop-shadow-[0_8px_20px_rgba(255,77,85,.18)]" />
            <span className="brand-wordmark text-xl font-extrabold tracking-tight select-none" aria-label="OpenMusic">
              {BRAND_LETTERS.map((letter, index) => (
                <span
                  key={index}
                  aria-hidden
                  className="brand-letter"
                  style={{
                    transitionDelay: `${index * 28}ms`,
                    ['--brand-c' as string]: letter.color,
                  }}
                >
                  {letter.char}
                </span>
              ))}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {!isMobileDevice() && (
              <div className="hidden lg:flex items-center gap-2 mr-2">
                <Tooltip content="下载 Android 客户端">
                  <a href={ANDROID_APK_URL} download="openmusic.apk" className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 transition-all">
                    <Download className="w-4 h-4" /> Android
                  </a>
                </Tooltip>
                <Tooltip content="下载 iOS IPA（需自签安装）">
                  <a href={IOS_IPA_URL} download="openmusic.ipa" className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 transition-all">
                    <Download className="w-4 h-4" /> iOS
                  </a>
                </Tooltip>
              </div>
            )}
            {adminEntryPath && (
              <Tooltip content="管理后台（仅本机可见）">
                <a href={adminEntryPath} className={`hidden sm:flex ${repoLinkCls}`} aria-label="管理后台">
                  <ShieldCheck className="w-5 h-5" />
                </a>
              </Tooltip>
            )}
            <a href="https://gitee.com/w3126197382/openmusic" target="_blank" rel="noopener noreferrer" className={`hidden sm:flex ${repoLinkCls}`} aria-label="Gitee">
              <GiteeIcon className="w-5 h-5" />
            </a>
            <a href="https://github.com/qq01-hub/openmusic" target="_blank" rel="noopener noreferrer" className={`hidden sm:flex ${repoLinkCls}`} aria-label="GitHub">
              <Github className="w-5 h-5" />
            </a>
            {isMobileDevice() && (
              <button type="button" onClick={() => setDownloadModalOpen(true)} className={repoLinkCls} aria-label="App">
                <Smartphone className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 滚动内容区 */}
      <main className="relative z-10 flex-1 overflow-y-auto pb-20 custom-scrollbar">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16">
          
          {/* 精简居中版 Hero Section */}
          <section className="mb-16 flex flex-col items-center text-center max-w-3xl mx-auto">
            {/* 状态徽章 */}
            <div className="mb-6 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/10 backdrop-blur-md text-xs sm:text-[13px] font-medium text-white/70">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              多人实时同步 · 边听边聊
            </div>

            <h1 className="relative text-4xl sm:text-5xl lg:text-[68px] font-black tracking-tight leading-[1.1] mb-5">
              <span aria-label="和喜欢的人">
                {'和喜欢的人'.split('').map((char, index) => (
                  <span key={index} aria-hidden className="hero-char">{char}</span>
                ))}
              </span>
              {' '}
              <br className="sm:hidden" />
              <span className="hero-gradient relative inline-block sm:ml-4">
                <span
                  aria-hidden
                  className="hero-gradient-glow hero-gradient-text absolute inset-0 text-transparent bg-clip-text blur-2xl opacity-60 select-none transition-opacity duration-500"
                >
                  听同一首歌
                </span>
                <span className="hero-gradient-text relative text-transparent bg-clip-text">
                  听同一首歌
                </span>
              </span>
            </h1>

            <p
              ref={heroCopyRef}
              onMouseMove={handleHeroCopyMove}
              className="hero-copy text-[15px] sm:text-lg mb-10 max-w-xl leading-relaxed"
            >
              全网曲库秒搜秒播，歌词实时同步，打破距离的限制，创建属于你们的
              <br />
              <span className="font-semibold">专属音乐宇宙</span>。
            </p>

            {/* 居中控制台 (Command Bar) */}
            <div className="w-full bg-white/[0.03] border border-white/10 rounded-[28px] sm:rounded-full p-2.5 flex flex-col sm:flex-row gap-2.5 shadow-2xl backdrop-blur-xl">
              <div className="relative flex-1 group">
                <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none">
                  <Users className="w-5 h-5 text-white/40 group-focus-within:text-netease-red group-focus-within:scale-110 transition-all duration-300" />
                </div>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => { setNickname(e.target.value); setError(''); }}
                  placeholder="给自己起个昵称..."
                  maxLength={20}
                  className="w-full h-12 sm:h-14 bg-transparent pl-14 pr-6 text-white caret-netease-red placeholder:text-white/30 outline-none focus:bg-white/[0.04] rounded-full transition-all text-[15px]"
                />
              </div>
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => { setError(''); setModalError(''); setShowCreate(true); }}
                  onMouseMove={handleBtnTilt}
                  onMouseLeave={resetBtnTilt}
                  className="btn-shine btn-tilt group/create flex-1 sm:flex-none h-12 sm:h-14 px-6 sm:px-8 rounded-full bg-netease-red hover:bg-netease-red/90 text-white font-semibold shadow-lg shadow-netease-red/25 hover:shadow-xl hover:shadow-netease-red/45 whitespace-nowrap"
                >
                  <span className="btn-tilt-face flex h-full w-full items-center justify-center gap-2">
                    <Plus className="w-5 h-5 transition-transform duration-300 ease-out group-hover/create:rotate-90" />
                    创建房间
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => { setError(''); setModalError(''); setShowJoin(true); }}
                  onMouseMove={handleBtnTilt}
                  onMouseLeave={resetBtnTilt}
                  className="btn-shine btn-tilt group/join flex-1 sm:flex-none h-12 sm:h-14 px-6 sm:px-8 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 hover:border-white/25 text-white font-medium whitespace-nowrap"
                >
                  <span className="btn-tilt-face flex h-full w-full items-center justify-center">
                    加入
                    <ArrowRight className="h-4 w-0 ml-0 opacity-0 -translate-x-1 group-hover/join:w-4 group-hover/join:ml-1.5 group-hover/join:opacity-100 group-hover/join:translate-x-0 transition-all duration-300 ease-out" />
                  </span>
                </button>
              </div>
            </div>

            {error && (
              <div className="mt-4 flex items-center gap-2 px-5 py-3 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-sm animate-fade-in">
                <Activity className="w-4 h-4" /> {error}
              </div>
            )}
          </section>

          {/* 房间列表区（突出显示，变宽） */}
          <div className="flex items-center justify-between mb-8 border-b border-white/5 pb-5">
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight flex items-center gap-3">
              大厅
              {rooms.length > 0 && (
                <span className="text-sm font-medium bg-white/10 text-white/80 px-3 py-1 rounded-full align-middle">
                  {rooms.length} 活跃
                </span>
              )}
            </h2>
            <button
              type="button"
              onClick={() => fetchRooms()}
              disabled={roomsLoading}
              className="group flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 group-hover:rotate-180 transition-transform duration-500 ${roomsLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">刷新列表</span>
            </button>
          </div>

          {roomsLoading && rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32 text-white/40">
              <Loader2 className="w-10 h-10 animate-spin mb-4 text-netease-red" />
              <p className="text-base font-medium">寻找房间中...</p>
            </div>
          ) : rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 px-4 text-center bg-white/[0.01] border border-white/5 rounded-[32px]">
              <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center mb-6 shadow-inner">
                <Search className="w-10 h-10 text-white/20" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">当前没有活跃房间</h3>
              <p className="text-white/40 mb-8 max-w-sm">一切都很安静。不如由你来开启第一首歌，邀请朋友们一起来听吧。</p>
              <button
                type="button"
                onClick={() => { setError(''); setShowCreate(true); }}
                className="flex items-center gap-2 px-8 py-4 rounded-full bg-white text-black font-bold hover:bg-white/90 hover:scale-105 transition-all"
              >
                <Plus className="w-5 h-5" />
                创建我的房间
              </button>
            </div>
          ) : (
            <div className="space-y-10">
              {recentRooms.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-6">
                    <History className="w-5 h-5 text-sky-400" />
                    <h3 className="text-lg font-bold text-white">最近去过</h3>
                  </div>
                  {/* 这里改成了更宽的网格，最大 3 列，从而让卡片变宽 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6">
                    {recentRooms.map((room) => (
                      <RoomCard key={room.id} room={room} onJoin={handleRoomCardClick} isRecent />
                    ))}
                  </div>
                </section>
              )}
              {otherRooms.length > 0 && (
                <section>
                  {recentRooms.length > 0 && (
                    <div className="flex items-center gap-2 mb-6 mt-4">
                      <Search className="w-5 h-5 text-white/50" />
                      <h3 className="text-lg font-bold text-white/80">探索更多</h3>
                    </div>
                  )}
                  {/* 同样最大 3 列，保证宽度充足 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6">
                    {otherRooms.map((room) => (
                      <RoomCard key={room.id} room={room} onJoin={handleRoomCardClick} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </main>

      {/* 弹窗: 创建房间 */}
      {showCreate && (
        <Modal title="创建新房间" onClose={() => { setShowCreate(false); setCreateRoomName(''); setCreatePassword(''); setModalError(''); }}>
          <form
            className="space-y-5"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              if (!actionLoading) void handleCreate();
            }}
          >
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2 pl-1">给房间起个名字</label>
              <input
                type="text"
                name="om-room-name"
                value={createRoomName}
                onChange={(e) => { setCreateRoomName(e.target.value); if (modalError) setModalError(''); }}
                placeholder="例如：周杰伦专场、深夜EMO"
                maxLength={30}
                className={inputCls}
                autoFocus
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2 pl-1">访问密码 <span className="text-white/30 font-normal">(可选)</span></label>
              <input
                type="password"
                name="om-room-access-code"
                value={createPassword}
                onChange={(e) => { setCreatePassword(e.target.value); if (modalError) setModalError(''); }}
                placeholder="留空即为公开房间"
                maxLength={32}
                className={inputCls}
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
              />
            </div>
            {modalError && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                <Activity className="w-4 h-4 flex-shrink-0" />
                {modalError}
              </div>
            )}
            <button
              type="submit"
              disabled={actionLoading}
              className="w-full flex items-center justify-center gap-2 bg-white text-black hover:bg-gray-200 disabled:opacity-50 font-bold py-4 rounded-2xl transition-all mt-2"
            >
              {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
              开启音乐之旅
            </button>
          </form>
        </Modal>
      )}

      {/* 弹窗: 加入房间 */}
      {showJoin && (
        <Modal title="加入房间" onClose={() => { setShowJoin(false); setJoinCode(''); setJoinPassword(''); setModalError(''); }}>
          <form
            className="space-y-5"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              if (!actionLoading) void handleJoinByCode();
            }}
          >
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2 pl-1">房间代码</label>
              <input
                type="text"
                name="om-room-code"
                value={joinCode}
                onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); if (modalError) setModalError(''); }}
                placeholder="输入 6 位房间号"
                maxLength={6}
                className={`${inputCls} uppercase tracking-[0.2em] font-mono text-center text-lg`}
                autoFocus
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2 pl-1">房间密码 <span className="text-white/30 font-normal">(如未上锁请留空)</span></label>
              <input
                type="password"
                name="om-room-join-code"
                value={joinPassword}
                onChange={(e) => { setJoinPassword(e.target.value); if (modalError) setModalError(''); }}
                placeholder="输入密码"
                maxLength={32}
                className={inputCls}
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
              />
            </div>
            {modalError && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                <Activity className="w-4 h-4 flex-shrink-0" />
                {modalError}
              </div>
            )}
            <button
              type="submit"
              disabled={actionLoading}
              className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/10 disabled:opacity-50 text-white font-bold py-4 rounded-2xl transition-all mt-2"
            >
              {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
              立即加入
            </button>
          </form>
        </Modal>
      )}

      <ClientDownloadModal open={downloadModalOpen} onClose={() => setDownloadModalOpen(false)} />

      <SiteAnnouncementPopup
        open={siteAnnouncementOpen}
        title={siteAnnouncement?.title}
        text={siteAnnouncement?.text || ''}
        onClose={handleCloseSiteAnnouncement}
      />
    </div>
  );
}