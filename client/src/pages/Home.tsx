import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Music, Users, Radio, ArrowRight, Lock, ListMusic,
  Loader2, RefreshCw, Plus, Hash, X, Disc3, Sparkles, Github, History, Download, Smartphone, ShieldCheck,
} from 'lucide-react';
import { createRoom, checkRoom, listRooms } from '../api/meting';
import { useRoomStore } from '../stores/roomStore';
import { useSocket } from '../hooks/useSocket';
import type { RoomSummary } from '../types';
import { createRandomNickname } from '../lib/randomNickname';
import { usePageSeo } from '../lib/seo';
import { partitionRoomsByRecent } from '../lib/recentRooms';
import { areRoomListsEqual, isLobbyHardLocked, sortLobbyRooms } from '../lib/roomListCompare';
import { isMobileDevice } from '../lib/audioUnlock';
import { ANDROID_APK_URL } from '../lib/androidDownload';
import { IOS_IPA_URL } from '../lib/iosDownload';
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

function GiteeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" className={className} aria-hidden>
      <path d="M512 1024q-104 0-199-40-92-39-163-110T40 711Q0 616 0 512t40-199Q79 221 150 150T313 40q95-40 199-40t199 40q92 39 163 110t110 163q40 95 40 199t-40 199q-39 92-110 163T711 984q-95 40-199 40z m259-569H480q-10 0-17.5 7.5T455 480v64q0 10 7.5 17.5T480 569h177q11 0 18.5 7.5T683 594v13q0 31-22.5 53.5T607 683H367q-11 0-18.5-7.5T341 657V417q0-31 22.5-53.5T417 341h354q11 0 18-7t7-18v-63q0-11-7-18t-18-7H417q-38 0-72.5 14T283 283q-27 27-41 61.5T228 417v354q0 11 7 18t18 7h373q46 0 85.5-22.5t62-62Q796 672 796 626V480q0-10-7-17.5t-18-7.5z" />
    </svg>
  );
}

const repoLinkCls = 'icon-button h-10 w-10 p-0';

function PlayingBars() {
  return (
    <span className="inline-flex items-end gap-[3px] h-3.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-netease-red animate-pulse"
          style={{
            height: `${8 + (i % 2) * 6}px`,
            animationDelay: `${i * 0.15}s`,
            animationDuration: '0.8s',
          }}
        />
      ))}
    </span>
  );
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

  const cardClassName = `group relative w-full text-left rounded-2xl border transition-all duration-300 overflow-hidden
    ${hardLocked
      ? 'border-white/5 bg-surface-base/75 opacity-70 cursor-not-allowed'
      : isActive
        ? 'border-netease-red/35 bg-gradient-to-br from-netease-red/12 via-surface-raised/80 to-surface-base/75 shadow-lg shadow-netease-red/5 hover:-translate-y-0.5 hover:shadow-netease-red/15 hover:border-netease-red/55'
        : 'border-white/8 bg-surface-raised/70 shadow-lg shadow-black/10 hover:-translate-y-0.5 hover:border-white/15 hover:bg-surface-hover/80'
    }`;

  const body = (
    <>
      {isActive && !hardLocked && (
        <div className="absolute inset-0 bg-gradient-to-r from-netease-red/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      )}

      <div className="relative p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {isRecent && (
              <span className="flex-shrink-0 flex items-center gap-1 text-[10px] uppercase tracking-wide text-sky-400/90 bg-sky-500/10 px-1.5 py-0.5 rounded-md font-medium">
                <History className="w-3 h-3" />
                最近
              </span>
            )}
            <h3 className={`text-base font-semibold truncate transition-colors ${hardLocked ? 'text-white/70' : 'text-white group-hover:text-netease-red'}`}>
              {room.name}
            </h3>
            {room.hasPassword && (
              <span className="flex-shrink-0 p-1 rounded-md bg-amber-500/10 text-amber-400/90">
                <Lock className="w-3.5 h-3.5" />
              </span>
            )}
            {hardLocked && (
              <Tooltip content="已上锁，无法进入">
                <span className="flex-shrink-0 p-1 rounded-md bg-red-500/10 text-red-400/90">
                  <Lock className="w-3.5 h-3.5" />
                </span>
              </Tooltip>
            )}
          </div>
          <span className="flex-shrink-0 flex items-center gap-1.5 text-xs text-white/50 bg-white/5 px-2.5 py-1 rounded-full">
            <Users className="w-3.5 h-3.5" />
            {room.userCount}
          </span>
        </div>

        <div className="min-h-[3.5rem] mb-4">
          {room.currentSong ? (
            <div className="flex items-center gap-3">
              <div className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-netease-red/20 to-surface-raised shadow-md shadow-black/30">
                <Disc3 className={`h-6 w-6 text-netease-red/80 ${room.isPlaying && !hardLocked ? 'animate-spin-slow' : ''}`} />
                <span className="absolute inset-[7px] rounded-full border border-white/5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {room.isPlaying && !hardLocked && <PlayingBars />}
                  <span className="text-[10px] uppercase tracking-wider text-netease-red/80 font-medium">
                    {room.isPlaying ? '正在播放' : '已暂停'}
                  </span>
                </div>
                <p className="text-sm font-medium text-white/90 truncate leading-snug">
                  {room.currentSong.name}
                </p>
                <p className="text-xs text-white/40 truncate mt-0.5">
                  {room.currentSong.artist}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-white/30">
              <Disc3 className="w-4 h-4" />
              <span className="text-sm">等待点播</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-white/5">
          <span className="flex items-center gap-1.5 text-xs text-white/35">
            <ListMusic className="w-3.5 h-3.5" />
            队列 {room.queueLength} 首
          </span>
          {hardLocked ? (
            <span className="flex items-center gap-1 text-xs text-red-400/70 font-medium">
              <Lock className="w-3.5 h-3.5" />
              已上锁
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-netease-red/80 opacity-0 group-hover:opacity-100 transition-opacity font-medium">
              进入
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </span>
          )}
        </div>
      </div>
    </>
  );

  if (hardLocked) {
    return (
      <div className={cardClassName} aria-disabled="true">
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onJoin(room)}
      className={cardClassName}
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
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div className="relative w-full max-w-sm glass rounded-2xl border border-white/10 shadow-2xl p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
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
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showAdminEntry, setShowAdminEntry] = useState(false);
  const [adminEntryPath, setAdminEntryPath] = useState('');
  const [adminEntryError, setAdminEntryError] = useState('');
  const [createRoomName, setCreateRoomName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [siteAnnouncement, setSiteAnnouncement] = useState<SiteAnnouncement | null>(null);
  const [siteAnnouncementOpen, setSiteAnnouncementOpen] = useState(false);

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
    const timer = setInterval(() => fetchRooms(true), 5000);
    return () => clearInterval(timer);
  }, [fetchRooms]);

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

  const ensureNickname = () => {
    const trimmed = nickname.trim();
    if (trimmed) return trimmed;
    const generated = createRandomNickname();
    setNickname(generated);
    return generated;
  };

  const goToRoom = (roomId: string, password?: string) => {
    navigate(`/room/${roomId}`, { state: password ? { password } : undefined });
  };

  const handleCreate = async () => {
    ensureNickname();
    setActionLoading(true);
    setError('');
    try {
      const room = await createRoom(createRoomName, createPassword);
      setShowCreate(false);
      setCreateRoomName('');
      setCreatePassword('');
      goToRoom(room.id, createPassword.trim() || undefined);
    } catch (error) {
      setError(error instanceof Error && error.message ? error.message : '创建房间失败，请重试');
    } finally {
      setActionLoading(false);
    }
  };

  const handleJoinByCode = async () => {
    ensureNickname();
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setError('请输入房间号');
      return;
    }
    setActionLoading(true);
    setError('');
    try {
      const result = await checkRoom(code);
      if (!result.exists) {
        setError('房间不存在，请检查房间号');
        return;
      }
      setShowJoin(false);
      goToRoom(code, joinPassword.trim() || undefined);
    } catch {
      setError('加入房间失败，请重试');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRoomCardClick = useCallback((room: RoomSummary) => {
    if (isLobbyHardLocked(room)) return;
    const trimmed = nickname.trim();
    if (!trimmed) {
      setNickname(createRandomNickname());
    }
    setError('');
    navigate(`/room/${room.id}`);
  }, [nickname, navigate, setNickname]);

  const { recent: recentRooms, others: otherRooms } = useMemo(() => {
    const { recent, others } = partitionRoomsByRecent(rooms);
    return {
      recent: sortLobbyRooms(recent),
      others: sortLobbyRooms(others),
    };
  }, [rooms]);

  const inputCls = 'w-full bg-black/25 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-netease-red/55 focus:ring-2 focus:ring-netease-red/10 transition-[border-color,box-shadow,background]';

  const openAdminEntry = () => {
    const raw = adminEntryPath.trim();
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    if (!/^\/(?:admin|[A-Za-z0-9_-]{8,64})$/.test(path)) {
      setAdminEntryError('请输入管理后台入口路径，例如 /AbCd1234');
      return;
    }
    setShowAdminEntry(false);
    setAdminEntryError('');
    navigate(path);
  };

  return (
    <div className="h-full flex flex-col relative overflow-hidden bg-surface-canvas">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_-10%,rgba(255,77,85,0.16),transparent_34%),radial-gradient(circle_at_82%_105%,rgba(124,58,237,0.11),transparent_30%)] pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.4)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.4)_1px,transparent_1px)] [background-size:48px_48px] pointer-events-none" />

      {/* 顶栏：昵称 + 创建/加入 */}
      <header className="relative z-20 flex-shrink-0 border-b border-white/8 glass safe-top shadow-[0_12px_40px_rgba(0,0,0,.18)]">
        <div className="relative h-14 sm:h-16">
          <div className="absolute right-4 sm:right-6 top-1/2 -translate-y-1/2 z-30 flex items-center gap-2">
            {!isMobileDevice() && (
              <>
                <Tooltip content="下载 Android 客户端">
                  <a
                    href={ANDROID_APK_URL}
                    download="openmusic.apk"
                    className="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-emerald-400/90 border border-emerald-500/25 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span>Android</span>
                  </a>
                </Tooltip>
                <Tooltip content="下载 iOS IPA（需 Sideloadly / AltStore 安装）">
                  <a
                    href={IOS_IPA_URL}
                    download="openmusic.ipa"
                    className="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-sky-400/90 border border-sky-500/25 hover:text-sky-300 hover:bg-sky-500/10 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span>iOS</span>
                  </a>
                </Tooltip>
              </>
            )}
            <a
              href="https://gitee.com/w3126197382/openmusic"
              target="_blank"
              rel="noopener noreferrer"
              className={`hidden sm:flex ${repoLinkCls}`}
              aria-label="Gitee 仓库"
            >
              <GiteeIcon className="w-4 h-4" />
            </a>
            <a
              href="https://github.com/qq01-hub/openmusic"
              target="_blank"
              rel="noopener noreferrer"
              className={`hidden sm:flex ${repoLinkCls}`}
              aria-label="GitHub 仓库"
            >
              <Github className="w-4 h-4" />
            </a>
          </div>
          <div className="max-w-6xl mx-auto px-4 sm:px-6 sm:pr-72 h-full flex items-center gap-2 sm:gap-4 min-w-0">
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <BrandMark className="h-10 w-10 drop-shadow-[0_8px_20px_rgba(255,77,85,.18)]" />
            <span className="hidden sm:block text-lg font-bold tracking-tight text-gradient">OpenMusic</span>
          </div>

          <div className="flex-1 min-w-0 sm:max-w-xs">
            <input
              type="text"
              value={nickname}
              onChange={(e) => { setNickname(e.target.value); setError(''); }}
              placeholder="你的昵称"
              maxLength={20}
              className={`${inputCls} py-2`}
            />
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => { setError(''); setShowJoin(true); }}
              className="hidden sm:flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-white/80 border border-white/10 bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.07] active:scale-[.97] transition-all"
            >
              <Hash className="w-4 h-4" />
              加入
            </button>
            <button
              type="button"
              onClick={() => { setError(''); setShowJoin(true); }}
              className="sm:hidden p-2.5 rounded-xl text-white/80 border border-white/10 hover:bg-white/5"
              aria-label="加入房间"
            >
              <Hash className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => { setError(''); setShowCreate(true); }}
              className="hidden sm:flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-netease-red hover:bg-[#ff626a] text-white transition-all active:scale-[.97] hover:shadow-lg hover:shadow-netease-red/25"
            >
              <Plus className="w-4 h-4" />
              <span>创建房间</span>
            </button>
            <button
              type="button"
              onClick={() => { setError(''); setShowCreate(true); }}
              className="sm:hidden p-2.5 rounded-xl bg-netease-red hover:bg-red-500 text-white transition-all"
              aria-label="创建房间"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => { setAdminEntryError(''); setShowAdminEntry(true); }}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-white/60 border border-white/10 bg-white/[0.025] hover:border-white/15 hover:text-white hover:bg-white/[0.07] active:scale-[.97] transition-all"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>管理</span>
            </button>
            <button
              type="button"
              onClick={() => { setAdminEntryError(''); setShowAdminEntry(true); }}
              className="sm:hidden p-2.5 rounded-xl text-white/70 border border-white/10 hover:text-white hover:bg-white/5"
              aria-label="管理后台"
            >
              <ShieldCheck className="w-4 h-4" />
            </button>
            {isMobileDevice() && (
              <Tooltip content="下载客户端">
                <button
                  type="button"
                  onClick={() => setDownloadModalOpen(true)}
                  className="sm:hidden p-2.5 rounded-xl text-white/70 border border-white/10 hover:text-white hover:bg-white/5 transition-colors"
                  aria-label="下载客户端"
                >
                  <Smartphone className="w-4 h-4" />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
        </div>
      </header>

      {/* 中间：房间列表 */}
      <main className="relative z-10 flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-1.5">
                <span className="sr-only">OpenMusic 在线点歌 - </span>
                房间大厅
              </h1>
              <p className="text-sm text-white/45">选择一个房间加入，或创建属于你的共同播放空间</p>
            </div>
            <button
              type="button"
              onClick={() => fetchRooms()}
              disabled={roomsLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-white/50 border border-white/10 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${roomsLoading ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-netease-red/10 border border-netease-red/20 text-netease-red text-sm text-center">
              {error}
            </div>
          )}

          {roomsLoading && rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-white/30">
              <Loader2 className="w-8 h-8 animate-spin mb-3" />
              <p className="text-sm">加载房间中...</p>
            </div>
          ) : rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 sm:py-28">
              <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-5">
                <Radio className="w-9 h-9 text-white/20" />
              </div>
              <p className="text-lg font-medium text-white/60 mb-2">还没有活跃房间</p>
              <p className="text-sm text-white/35 mb-6">成为第一个创建房间的人吧</p>
              <button
                type="button"
                onClick={() => { setError(''); setShowCreate(true); }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-netease-red hover:bg-red-500 text-white text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                创建房间
              </button>
            </div>
          ) : (
            <div className="space-y-8">
              {recentRooms.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <History className="w-4 h-4 text-sky-400/80" />
                    <h2 className="text-sm font-medium text-white/70">最近访问</h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {recentRooms.map((room) => (
                      <RoomCard key={room.id} room={room} onJoin={handleRoomCardClick} isRecent />
                    ))}
                  </div>
                </section>
              )}
              {otherRooms.length > 0 && (
                <section>
                  {recentRooms.length > 0 && (
                    <h2 className="text-sm font-medium text-white/50 mb-4">全部房间</h2>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

      {/* 底栏 */}
      <footer className="relative z-10 flex-shrink-0 border-t border-white/5 py-3 px-4">
        <div className="flex flex-col items-center gap-2.5">
          <div className="flex justify-center gap-6 sm:gap-10 text-white/25 text-xs">
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              多人实时同步
            </span>
            <span className="flex items-center gap-1.5">
              <Music className="w-3.5 h-3.5" />
              三平台曲库
            </span>
          </div>
          <p className="text-xs text-white/35">
            友链：
            <a
              href="https://linux.do/"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 text-white/50 transition-colors hover:text-white/75"
            >
              Linux.do
            </a>
          </p>
          {/* <p className="flex flex-wrap items-center justify-center gap-1 text-xs text-white/35">
            本网站由
            <a
              href="https://www.upyun.com/?utm_source=lianmeng&utm_medium=referral"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex opacity-80 hover:opacity-100 transition-opacity"
              aria-label="又拍云"
            >
              <img src="/又拍云_logo5.png" alt="又拍云" className="h-6 w-auto" />
            </a>
            提供 CDN 加速 / 云存储服务
          </p> */}
        </div>
      </footer>

      {showCreate && (
        <Modal title="创建房间" onClose={() => { setShowCreate(false); setCreateRoomName(''); setCreatePassword(''); }}>
          <p className="text-sm text-white/45 mb-4">先给你的房间起个名字，方便大家在大厅里找到</p>
          <label className="block text-xs text-white/50 mb-1.5">房间名称</label>
          <input
            type="text"
            value={createRoomName}
            onChange={(e) => setCreateRoomName(e.target.value)}
            placeholder="例如：周杰伦专场"
            maxLength={30}
            className={`${inputCls} mb-4`}
          />
          <label className="block text-xs text-white/50 mb-1.5">房间密码（可选）</label>
          <input
            type="password"
            value={createPassword}
            onChange={(e) => setCreatePassword(e.target.value)}
            placeholder="留空则无需密码"
            maxLength={32}
            className={`${inputCls} mb-5`}
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={actionLoading}
            className="w-full flex items-center justify-center gap-2 bg-netease-red hover:bg-red-500 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors"
          >
            {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
            创建并进入
          </button>
        </Modal>
      )}

      {showJoin && (
        <Modal title="加入房间" onClose={() => { setShowJoin(false); setJoinCode(''); setJoinPassword(''); }}>
          <label className="block text-xs text-white/50 mb-1.5">房间号</label>
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="6 位房间号"
            maxLength={6}
            className={`${inputCls} uppercase tracking-widest mb-4`}
          />
          <label className="block text-xs text-white/50 mb-1.5">密码（如有）</label>
          <input
            type="password"
            value={joinPassword}
            onChange={(e) => setJoinPassword(e.target.value)}
            placeholder="无密码可留空"
            maxLength={32}
            className={`${inputCls} mb-5`}
          />
          <button
            type="button"
            onClick={handleJoinByCode}
            disabled={actionLoading}
            className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 disabled:opacity-50 text-white font-medium py-3 rounded-xl border border-white/10 transition-colors"
          >
            {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
            加入房间
          </button>
        </Modal>
      )}

      {showAdminEntry && (
        <Modal title="进入管理后台" onClose={() => { setShowAdminEntry(false); setAdminEntryError(''); }}>
          <p className="text-sm text-white/45 mb-4">
            为避免公开随机管理地址，请输入后台中设置的入口路径。
          </p>
          <label className="block text-xs text-white/50 mb-1.5">管理入口路径</label>
          <input
            type="text"
            value={adminEntryPath}
            onChange={(e) => { setAdminEntryPath(e.target.value); setAdminEntryError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') openAdminEntry(); }}
            placeholder="例如 /AbCd1234"
            autoComplete="off"
            className={`${inputCls} mb-2 font-mono`}
          />
          {adminEntryError && <p className="mb-3 text-xs text-red-400">{adminEntryError}</p>}
          <button
            type="button"
            onClick={openAdminEntry}
            className="mt-2 w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 text-white font-medium py-3 rounded-xl border border-white/10 transition-colors"
          >
            <ShieldCheck className="w-5 h-5" />
            进入管理后台
          </button>
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
