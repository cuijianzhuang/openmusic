import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';

import { useParams, useNavigate, useLocation } from 'react-router-dom';

import { Search, Loader2, Copy, Check, LogOut, X, Heart, Plus, Download, ListMusic, Upload, History, ListPlus, Pencil, Lock, LockOpen, ChevronLeft, ChevronRight, SlidersHorizontal, Shield, Maximize2, Smartphone } from 'lucide-react';

import { searchAllSongs, getAvailableSources, type SearchFilterMode } from '../api/music';
import { importPlaylist, searchPlaylists, type PlaylistSearchItem, type PlaylistPlatform, type PlaylistChannelFilter as PlaylistChannelFilterMode } from '../api/music/playlist';
import { normalizeFmMode } from '../api/music/fmMode';
import { addSongsToQueue, formatBulkAddToast } from '../lib/addSongsToQueue';
import { rememberPlaylistImportHistory } from '../lib/playlistImportHistory';
import { detectPlaylistLink } from '../lib/playlistLink';

import type { FavoriteSong, MusicSource, RoomAudioQuality, RoomMemberSettings, RoomMemberTier, SearchResult, Song, SongHistoryItem } from '../types';

import type { MusicProviderMeta } from '../api/music/types';

import { useRoomStore } from '../stores/roomStore';
import { usePureModeStore } from '../stores/pureModeStore';
import { useImmersiveModeStore } from '../stores/immersiveModeStore';

import { useSocket } from '../hooks/useSocket';
import { useFavorites } from '../hooks/useFavorites';
import { createRandomNickname } from '../lib/randomNickname';
import { usePageSeo } from '../lib/seo';
import {
  applyPureModeDisguise,
  clearPureModeDisguise,
} from '../lib/roomPureMode';
import { normalizeDislikeSkipMode } from '../lib/dislikeSkip';

import { songKey, getCoverUrl } from '../api/music';
import SongCover from '../components/SongCover';

import AudioEngine from '../components/AudioEngine';

import SourceBadge from '../components/SourceBadge';
import SearchFilterSelect from '../components/SearchFilterSelect';
import PlaylistChannelFilter from '../components/PlaylistChannelFilter';
import PageNumberPagination from '../components/PageNumberPagination';
import SearchSkeleton, { RESULT_BODY_HEIGHT } from '../components/SearchSkeleton';
import SongResultList from '../components/SongResultList';
import {
  getStoredSongResultPageSize,
  setStoredSongResultPageSize,
  SONG_RESULT_PAGE_SIZE_OPTIONS,
  type SongResultPageSize,
} from '../lib/songResultPagination';
import FavoriteButton from '../components/FavoriteButton';
import PageSizeSelect from '../components/PageSizeSelect';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useSongHistoryStore } from '../stores/songHistoryStore';

import RoomFmModeBadge from '../components/RoomFmModeBadge';
import type { SongRequestSettings } from '../components/RoomSettingsModal';
import RoomQualityBadge from '../components/RoomQualityBadge';
import { resolveEffectiveAudioQuality, useUserQualityStore } from '../stores/userQualityStore';
import { invalidateUnloadedSongUrlCache, prefetchUpcomingFromRoom } from '../lib/songPreloadCache';
import { DEFAULT_MEMBER_SETTINGS } from '../lib/memberTierPresets';
import { getSongRequestBlockReason } from '../lib/roomPermissions';
import { markAnnouncementSeen, shouldAutoShowAnnouncement } from '../lib/announcementSeen';
import JumpRequestBanner from '../components/JumpRequestBanner';
import Toast from '../components/Toast';
import QueueSystemToast from '../components/QueueSystemToast';
import Tooltip from '../components/Tooltip';
import RoleBadge from '../components/RoleBadge';
import { copyToClipboard } from '../lib/copyToClipboard';
import { rememberRoomVisit } from '../lib/recentRooms';
import { ensureRoomChromeInit } from '../lib/roomChromeInit';
import { buildRoomShareText } from '../lib/roomShare';
import {
  getStoredRoomPassword,
  parseRoomPasswordFromSearch,
  rememberRoomPassword,
  clearStoredRoomPassword,
  stripRoomPasswordFromSearch,
} from '../lib/roomPassword';
import { isMobileDevice } from '../lib/audioUnlock';
import { exitDocumentFullscreen } from '../lib/browserFullscreen';
import {
  readRoomVisualFx,
  roomAmbientGlassClass,
  readRoomVisualMode,
  writeRoomVisualMode,
  shouldProxySongPlaybackUrl,
  DEFAULT_ROOM_VISUAL_FX,
  type RoomVisualFxSettings,
  type RoomVisualMode,
} from '../lib/roomVisualPreset';
import {
  immersiveGlassChip,
  immersiveGlassListRow,
  immersiveGlassModal,
  immersiveGlassScrim,
  immersiveGlassSheetHeader,
  immersiveGlassListFooter,
} from '../lib/immersiveGlass';

const PlayerPage = lazy(() => import('../components/PlayerPage'));
const PlaylistImportModal = lazy(() => import('../components/PlaylistImportModal'));
const RecommendedPlaylistsDrawer = lazy(() => import('../components/RecommendedPlaylistsDrawer'));
const ClientDownloadModal = lazy(() => import('../components/ClientDownloadModal'));
const RoomMemberModal = lazy(() => import('../components/RoomMemberModal'));
const RoomSettingsModal = lazy(() => import('../components/RoomSettingsModal'));
const RoomVisualFxPanel = lazy(() => import('../components/RoomVisualFxPanel'));
const RoomImmersiveShell = lazy(() => import('../components/immersive/RoomImmersiveShell'));
const ImmersiveFxSettingsPanel = lazy(() => import('../components/immersive/ImmersiveFxSettingsPanel'));
const ImmersiveExitModal = lazy(() => import('../components/immersive/ImmersiveExitModal'));
const ImmersiveTransitionOverlay = lazy(() => import('../components/immersive/ImmersiveTransitionOverlay'));
const ChatPanel = lazy(() => import('../components/ChatPanel'));
const PureModeChatDock = lazy(() => import('../components/PureModeChatDock'));
const QueuePanel = lazy(() => import('../components/QueuePanel'));
const HotSongPanel = lazy(() => import('../components/HotSongPanel'));
const OnlineUsers = lazy(() => import('../components/OnlineUsers'));
const RoomAmbientBackground = lazy(() => import('../components/RoomAmbientBackground'));
const MiniPlayer = lazy(() => import('../components/MiniPlayer'));
const RoomQualityModal = lazy(() => import('../components/RoomQualityModal'));
const RoomAnnouncementPopup = lazy(() => import('../components/RoomAnnouncementPopup'));

function ensureGalaxyAudioOutputLazy() {
  void import('../components/galaxy/lib/galaxyAudio').then((m) => m.ensureGalaxyAudioOutput());
}

import {
  commitRoomVisualFx,
  patchRoomVisualFx,
  roomVisualFxLive,
} from '../lib/roomVisualFxLive';
import { resetSharedAudioElement } from '../lib/audioElement';
import { useAudioStore } from '../stores/audioStore';
import {
  createEnterSteps,
  createExitSteps,
  ensureMinimumLoadingDuration,
  IMMERSIVE_REVEAL_IN_MS,
  IMMERSIVE_REVEAL_OUT_MS,
  immersiveTimingCssVars,
  runImmersiveEnterPrep,
  runImmersiveExitPrep,
  type ImmersiveTransitionState,
} from '../lib/immersiveTransition';


function mapImportedSource(source: unknown): MusicSource {
  if (source === 'wy' || source === 'netease') return 'netease';
  if (source === 'qq' || source === 'tencent') return 'tencent';
  if (source === 'kugou') return 'kugou';
  return 'netease';
}

function normalizeImportedFavorite(raw: unknown): Song | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, any>;
  const id = String(item.id || item.mediaMid || '').trim();
  const name = String(item.name || '').trim();
  const artist = String(item.artist || item.album?.artist || '').trim();
  if (!id || !name) return null;
  return {
    id,
    source: mapImportedSource(item.source),
    name,
    artist: artist || '未知歌手',
    album: typeof item.album?.name === 'string' ? item.album.name : undefined,
    pic: String(item.pictureUrl || item.pic || item.album?.pictureUrl || '').trim() || undefined,
    duration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : undefined,
    lrc: typeof item.lyric === 'string' ? item.lyric : undefined,
  };
}

function parseFavoriteImportJson(text: string): Song[] {
  const parsed = JSON.parse(text) as unknown;
  const rawItems = Array.isArray(parsed) ? parsed : Object.values(parsed as Record<string, unknown> || {});
  return rawItems.map(normalizeImportedFavorite).filter(Boolean) as Song[];
}

function chunkSongs<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function formatHistoryTime(time: number) {
  if (!time) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(time));
  } catch {
    return '';
  }
}

const FAVORITES_IMPORT_BATCH_SIZE = 500;
const FAVORITES_PAGE_SIZE_OPTIONS = [15, 30, 50] as const;
type FavoritesPageSize = (typeof FAVORITES_PAGE_SIZE_OPTIONS)[number];
const DEFAULT_FAVORITES_PAGE_SIZE: FavoritesPageSize = 15;
type SearchMode = 'song' | 'playlist';

interface PlaylistSearchBackup {
  keyword: string;
  results: PlaylistSearchItem[];
  page: number;
  total: number;
  channel: PlaylistChannelFilterMode;
  pageSize: SongResultPageSize;
}


export default function Room() {

  const { roomId } = useParams<{ roomId: string }>();

  const navigate = useNavigate();

  const location = useLocation();

  const urlPassword = parseRoomPasswordFromSearch(location.search);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [joinPasswordOverride, setJoinPasswordOverride] = useState<string | undefined>(undefined);
  const [needsPasswordPrompt, setNeedsPasswordPrompt] = useState(false);
  const [ignoreUrlPassword, setIgnoreUrlPassword] = useState(false);

  const roomPassword =
    joinPasswordOverride
    || (location.state as { password?: string } | null)?.password
    || (!ignoreUrlPassword ? urlPassword : undefined)
    || getStoredRoomPassword(roomId);

  // 分享链接带 ?pwd= 时立刻写入 sessionStorage 并清掉 URL，降低历史/Referer 泄露
  useEffect(() => {
    if (!roomId) return;
    const fromUrl = parseRoomPasswordFromSearch(location.search);
    if (!fromUrl) return;
    rememberRoomPassword(roomId, fromUrl);
    const nextSearch = stripRoomPasswordFromSearch(location.search);
    if (nextSearch === location.search) return;
    navigate(
      { pathname: location.pathname, search: nextSearch },
      { replace: true, state: location.state },
    );
  }, [roomId, location.pathname, location.search, location.state, navigate]);

  const room = useRoomStore((s) => s.room);
  const nickname = useRoomStore((s) => s.nickname);
  const showPlayer = useRoomStore((s) => s.showPlayer);
  const setShowPlayer = useRoomStore((s) => s.setShowPlayer);
  const isOwner = useRoomStore((s) => s.isOwner);
  const isAdmin = useRoomStore((s) => s.isAdmin);
  const canControlPlayback = useRoomStore((s) => s.canControlPlayback);
  const mySocketId = useRoomStore((s) => s.mySocketId);
  const exitReason = useRoomStore((s) => s.exitReason);
  const isReconnecting = useRoomStore((s) => s.isReconnecting);

  const pureMode = usePureModeStore((s) => s.enabled);
  const setPureModeEnabled = usePureModeStore((s) => s.setEnabled);
  const immersiveMode = useImmersiveModeStore((s) => s.enabled);
  const setImmersiveModeEnabled = useImmersiveModeStore((s) => s.setEnabled);
  const setImmersiveQualityCapActive = useImmersiveModeStore((s) => s.setQualityCapActive);
  const [purePlayerHidden, setPurePlayerHidden] = useState(false);

  const roomPageTitle = room?.name ? `${room.name} 房间` : '正在加入房间';

  usePageSeo({
    title: roomPageTitle,
    description: room?.current
      ? `正在播放「${room.current.name}」— 加入 ${room.name} 多人同步听歌、点歌、聊天`
      : '多人实时同步听歌、搜索点歌、歌词滚动、房间聊天',
    path: roomId ? `/room/${roomId}` : undefined,
    noindex: true,
  });

  const { joinRoom, addSong, leaveRoom, listFavorites, setFavorite, importFavorites, renameRoomName, setRoomLock, setRoomFmMode, setRoomAnnouncement, setChatHistoryVisibleOnJoin, setSongRequestEnabled, unbanRoomSong, setRoomMemberTier, removeRoomMemberTier, setRoomMemberSettings, loadSongHistory, transferOwner } = useSocket();
  const { applyFavorites } = useFavorites();



  const [sources, setSources] = useState<MusicProviderMeta[]>([]);

  const [query, setQuery] = useState('');

  const [results, setResults] = useState<SearchResult[]>([]);

  const [searching, setSearching] = useState(false);
  const [playlistSearchLoading, setPlaylistSearchLoading] = useState(false);

  const [joinError, setJoinError] = useState('');

  const [addingId, setAddingId] = useState<string | null>(null);
  const [addingPage, setAddingPage] = useState(false);
  const [listPageSongs, setListPageSongs] = useState<SearchResult[]>([]);

  const [copied, setCopied] = useState(false);
  const [searchedKeyword, setSearchedKeyword] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('song');
  const [activeSearchMode, setActiveSearchMode] = useState<SearchMode>('song');
  const [overlaySearchMode, setOverlaySearchMode] = useState<SearchMode>('song');
  const [overlayQuery, setOverlayQuery] = useState('');
  const prevOverlayOpenRef = useRef(false);
  const [searchFilterMode, setSearchFilterMode] = useState<SearchFilterMode>('smart');
  const [playlistImportOpen, setPlaylistImportOpen] = useState(false);
  const [recommendDrawerOpen, setRecommendDrawerOpen] = useState(false);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [isPlaylistResults, setIsPlaylistResults] = useState(false);
  const [playlistSearchResults, setPlaylistSearchResults] = useState<PlaylistSearchItem[]>([]);
  const [playlistSearchPage, setPlaylistSearchPage] = useState(1);
  const [playlistSearchPageSize, setPlaylistSearchPageSize] = useState<SongResultPageSize>(getStoredSongResultPageSize);
  const [playlistSearchTotal, setPlaylistSearchTotal] = useState(0);
  const [playlistChannelFilter, setPlaylistChannelFilter] = useState<PlaylistChannelFilterMode>('all');
  const [playlistSearchBackup, setPlaylistSearchBackup] = useState<PlaylistSearchBackup | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [immersiveExitPromptOpen, setImmersiveExitPromptOpen] = useState(false);
  const [immersiveTransition, setImmersiveTransition] = useState<ImmersiveTransitionState | null>(null);
  const [immersiveShellMotion, setImmersiveShellMotion] = useState<'entering' | 'exiting' | null>(null);
  const immersiveTransitionRef = useRef(false);
  const [visualMode, setVisualMode] = useState<RoomVisualMode>(readRoomVisualMode);
  const [immersivePanelFocus, setImmersivePanelFocus] = useState<'search' | 'queue' | 'chat' | null>(null);
  const [visualFx, setVisualFx] = useState<RoomVisualFxSettings>(() => {
    const fx = readRoomVisualFx();
    roomVisualFxLive.current = fx;
    return fx;
  });
  const [visualFxOpen, setVisualFxOpen] = useState(false);
  const [visualFxDragging, setVisualFxDragging] = useState(false);
  const isLgUp = useMediaQuery('(min-width: 1024px)');
  const isSmUp = useMediaQuery('(min-width: 640px)');
  const showImmersiveEntry = isLgUp && !isMobileDevice() && !pureMode;
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [songHistoryOpen, setSongHistoryOpen] = useState(false);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteSong[]>([]);
  const [favoriteQuery, setFavoriteQuery] = useState('');
  const [favoritePage, setFavoritePage] = useState(1);
  const [favoritePageSize, setFavoritePageSize] = useState<FavoritesPageSize>(DEFAULT_FAVORITES_PAGE_SIZE);
  const [removingFavoriteId, setRemovingFavoriteId] = useState<string | null>(null);
  const [addingAllFavorites, setAddingAllFavorites] = useState(false);
  const [importingFavorites, setImportingFavorites] = useState(false);
  const [favoritesImportProgress, setFavoritesImportProgress] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [lockPassword, setLockPassword] = useState('');
  const [lockSaving, setLockSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fmSaving, setFmSaving] = useState(false);
  const [transferSaving, setTransferSaving] = useState(false);
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [announcementPopupOpen, setAnnouncementPopupOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [memberSaving, setMemberSaving] = useState(false);
  const [songRequestSaving, setSongRequestSaving] = useState(false);
  const [chatHistorySaving, setChatHistorySaving] = useState(false);
  const lastSongRequestAtRef = useRef(0);
  const playlistSearchScrollRef = useRef<HTMLDivElement>(null);
  const songHistoryItems = useSongHistoryStore((s) => s.songs);
  const songHistoryLoading = useSongHistoryStore((s) => s.loading);

  useEffect(() => {
    ensureRoomChromeInit();
  }, []);

  useEffect(() => {
    if (!songHistoryOpen || !room?.id) return;
    void loadSongHistory();
  }, [songHistoryOpen, room?.id, loadSongHistory]);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    const onVisualToast = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string; type?: 'success' | 'error' }>).detail;
      if (detail?.message) showToast(detail.message, detail.type || 'success');
    };
    window.addEventListener('openmusic:visual-toast', onVisualToast);
    return () => window.removeEventListener('openmusic:visual-toast', onVisualToast);
  }, [showToast]);

  const closeToast = useCallback(() => setToast(null), []);

  const isCreator = Boolean(room?.creatorId && mySocketId && room.creatorId === mySocketId);
  const songRequestBlockReason = getSongRequestBlockReason(
    room,
    isOwner,
    isAdmin,
    mySocketId,
    lastSongRequestAtRef.current,
    canControlPlayback,
  );
  const canModerate = isOwner || isAdmin;
  const canOpenRoomSettings = canModerate;
  const songRequestSettings: SongRequestSettings = useMemo(() => ({
    enabled: room?.songRequestEnabled !== false,
    memberJumpEnabled: Boolean(room?.memberJumpEnabled),
    memberSeekEnabled: Boolean(room?.memberSeekEnabled),
    memberPauseEnabled: Boolean(room?.memberPauseEnabled),
    systemMediaPlayBound: room?.systemMediaPlayBound !== false,
    systemMediaSkipBound: room?.systemMediaSkipBound !== false,
    dislikeSkipMode: normalizeDislikeSkipMode(room?.dislikeSkipMode),
    dislikeSkipThreshold: Math.max(1, room?.dislikeSkipThreshold ?? 5),
    dislikeSkipPercent: Math.min(100, Math.max(1, room?.dislikeSkipPercent ?? 50)),
    clearSongsOnLeaveEnabled: Boolean(room?.clearSongsOnLeaveEnabled),
    clearSongsOnLeaveDelayMinutes: Math.floor((room?.clearSongsOnLeaveDelaySec ?? 60) / 60),
    minStayMinutes: Math.floor((room?.songRequestMinStaySec ?? 0) / 60),
    maxPerUser: room?.songRequestMaxPerUser ?? 0,
    cooldownSec: room?.songRequestCooldownSec ?? 0,
    queueMaxLength: room?.queueMaxLength ?? 200,
  }), [
    room?.songRequestEnabled,
    room?.memberJumpEnabled,
    room?.memberSeekEnabled,
    room?.memberPauseEnabled,
    room?.systemMediaPlayBound,
    room?.systemMediaSkipBound,
    room?.dislikeSkipMode,
    room?.dislikeSkipThreshold,
    room?.dislikeSkipPercent,
    room?.clearSongsOnLeaveEnabled,
    room?.clearSongsOnLeaveDelaySec,
    room?.songRequestMinStaySec,
    room?.songRequestMaxPerUser,
    room?.songRequestCooldownSec,
    room?.queueMaxLength,
  ]);

  const openRenameModal = useCallback(() => {
    if (!room) return;
    setRenameDraft(room.name);
    setRenameOpen(true);
  }, [room]);

  const handleRenameRoom = useCallback(async () => {
    const nextName = renameDraft.trim();
    if (!nextName || renameSaving) return;
    setRenameSaving(true);
    const res = await renameRoomName(nextName);
    setRenameSaving(false);
    if (res.success) {
      setRenameOpen(false);
      showToast('房间名称已更新', 'success');
    } else {
      showToast(res.error || '改名失败', 'error');
    }
  }, [renameDraft, renameSaving, renameRoomName, showToast]);

  const openLockModal = useCallback(() => {
    setLockPassword('');
    setLockOpen(true);
  }, []);

  const handleUnlockRoom = useCallback(async () => {
    if (lockSaving) return;
    setLockSaving(true);
    const res = await setRoomLock(false);
    setLockSaving(false);
    if (res.success) {
      setLockOpen(false);
      showToast('房间已解锁', 'success');
    } else {
      showToast(res.error || '解锁失败', 'error');
    }
  }, [lockSaving, setRoomLock, showToast]);

  const handleLockRoom = useCallback(async () => {
    if (lockSaving) return;
    setLockSaving(true);
    const res = await setRoomLock(true, lockPassword.trim() || undefined);
    setLockSaving(false);
    if (res.success) {
      const pwd = lockPassword.trim();
      if (pwd && room?.id) rememberRoomPassword(room.id, pwd);
      setLockOpen(false);
      setLockPassword('');
      showToast(pwd ? '房间已上锁（他人需密码，创建者免密）' : '房间已上锁（他人无法进入，创建者免密）', 'success');
    } else {
      showToast(res.error || '上锁失败', 'error');
    }
  }, [lockPassword, lockSaving, room?.id, setRoomLock, showToast]);

  const filteredFavorites = favorites.filter((song) => {
    const keyword = favoriteQuery.trim().toLowerCase();
    if (!keyword) return true;
    return [song.name, song.artist, song.album, song.lrc].some((value) => String(value || '').toLowerCase().includes(keyword));
  });

  const favoriteTotalPages = Math.max(1, Math.ceil(filteredFavorites.length / favoritePageSize));
  const pagedFavorites = filteredFavorites.slice(
    (favoritePage - 1) * favoritePageSize,
    favoritePage * favoritePageSize,
  );

  useEffect(() => {
    setFavoritePage(1);
  }, [favoriteQuery, favorites.length, favoritePageSize]);

  useEffect(() => {
    if (favoritePage > favoriteTotalPages) {
      setFavoritePage(favoriteTotalPages);
    }
  }, [favoritePage, favoriteTotalPages]);

  const openFavorites = useCallback(async () => {
    setFavoritesOpen(true);
    setFavoritePage(1);
    setFavoritesLoading(true);
    const res = await listFavorites();
    setFavoritesLoading(false);
    if (res.success) {
      const next = res.favorites || [];
      setFavorites(next);
      applyFavorites(next);
    } else {
      showToast(res.error || '收藏列表加载失败', 'error');
    }
  }, [listFavorites, showToast, applyFavorites]);

  const removeFavorite = useCallback(async (song: FavoriteSong) => {
    const key = songKey(song);
    setRemovingFavoriteId(key);
    const res = await setFavorite(song, false);
    setRemovingFavoriteId(null);
    if (res.success) {
      const next = res.favorites || [];
      setFavorites(next);
      applyFavorites(next);
      showToast('已取消收藏', 'success');
    } else {
      showToast(res.error || '取消收藏失败', 'error');
    }
  }, [setFavorite, showToast, applyFavorites]);

  const handleAddPageFavorites = useCallback(async () => {
    if (addingAllFavorites || pagedFavorites.length === 0) return;
    setAddingAllFavorites(true);
    try {
      const result = await addSongsToQueue(pagedFavorites, {
        getRoom: () => useRoomStore.getState().room,
        addSong,
      });
      const toast = formatBulkAddToast(result);
      showToast(toast.message, toast.type);
    } finally {
      setAddingAllFavorites(false);
    }
  }, [addingAllFavorites, pagedFavorites, addSong, showToast]);

  const handleImportFavoritesJson = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setImportingFavorites(true);
      setFavoritesImportProgress('');
      try {
        const songs = parseFavoriteImportJson(await file.text());
        if (songs.length === 0) {
          showToast('JSON 中没有可导入的歌曲', 'error');
          return;
        }
        const batches = chunkSongs(songs, FAVORITES_IMPORT_BATCH_SIZE);
        let imported = 0;
        let dropped = 0;
        let maxFavorites = 5000;
        for (let index = 0; index < batches.length; index += 1) {
          setFavoritesImportProgress(`导入进度 ${Math.min((index + 1) * FAVORITES_IMPORT_BATCH_SIZE, songs.length)}/${songs.length}`);
          const res = await importFavorites(batches[index]);
          if (!res.success) {
            showToast(res.error || `导入到 ${index * FAVORITES_IMPORT_BATCH_SIZE}/${songs.length} 时失败`, 'error');
            return;
          }
          imported += res.imported || 0;
          dropped = Math.max(dropped, res.dropped || 0);
          if (res.maxFavorites) maxFavorites = res.maxFavorites;
          if (res.favorites) {
            setFavorites(res.favorites);
            applyFavorites(res.favorites);
          }
        }
        if (dropped > 0) {
          showToast(`已导入 ${imported} 首新收藏，${dropped} 首因超出 ${maxFavorites} 首上限未导入`, 'success');
        } else {
          showToast(`已导入 ${imported} 首新收藏，重复歌曲已跳过`, 'success');
        }
      } catch {
        showToast('JSON 解析失败，请检查文件格式', 'error');
      } finally {
        setImportingFavorites(false);
        setFavoritesImportProgress('');
      }
    };
    input.click();
  }, [importFavorites, showToast, applyFavorites]);

  const handleExportFavoritesJson = useCallback(() => {
    const data = Object.fromEntries(favorites.map((song) => [
      `${song.source}:${song.id}`,
      {
        id: song.id,
        source: song.source,
        name: song.name,
        artist: song.artist,
        album: song.album || '',
        pic: song.pic || '',
        duration: song.duration || 0,
        lrc: song.lrc || '',
        favoritedAt: song.favoritedAt || Date.now(),
      },
    ]));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `openmusic-favorites-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [favorites]);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    let redirectTimer: number | undefined;

    // 清除上一次会话残留的退出原因（如“房间已被站点管理员解散”），
    // 否则新建/加入房间后页面会误判为已被踢出并弹回大厅
    if (useRoomStore.getState().exitReason) {
      useRoomStore.getState().setExitReason(null);
    }

    let nick = useRoomStore.getState().nickname.trim();
    if (!nick) {
      nick = createRandomNickname();
      useRoomStore.getState().setNickname(nick);
    }

    // 清除上一次被踢/被解散残留的退出原因，否则新房间会误显示旧提示并被弹回首页
    useRoomStore.getState().setExitReason(null);

    joinRoom(roomId, nick, roomPassword).then((res) => {
      if (cancelled) return;
      if (!res.success) {
        if (res.needsPassword) {
          const sentPassword = Boolean(roomPassword?.trim());
          if (sentPassword) {
            clearStoredRoomPassword(roomId);
          }
          setNeedsPasswordPrompt(true);
          setIgnoreUrlPassword(true);
          setJoinError(sentPassword ? (res.error || '密码错误') : '');
          if (parseRoomPasswordFromSearch(location.search)) {
            const nextSearch = stripRoomPasswordFromSearch(location.search);
            navigate(
              { pathname: location.pathname, search: nextSearch },
              { replace: true, state: location.state },
            );
          }
          return;
        }
        setJoinError(res.error || '加入房间失败');
        redirectTimer = window.setTimeout(() => navigate('/'), 2000);
        return;
      }

      setNeedsPasswordPrompt(false);
      rememberRoomPassword(roomId, roomPassword);
      rememberRoomVisit(roomId);
      if (
        res.room
        && shouldAutoShowAnnouncement(res.room.id, res.room.announcementEnabled, res.room.announcementText)
      ) {
        setAnnouncementPopupOpen(true);
      }
    });

    return () => {
      cancelled = true;
      if (redirectTimer) window.clearTimeout(redirectTimer);
      // 刷新/关闭页面时不主动 leave，避免房间被暂停；依赖 socket 断开与重连
    };
  }, [roomId, roomPassword, joinRoom, leaveRoom, navigate, location.pathname, location.search, location.state]);

  useEffect(() => {
    if (!room?.id) return;
    if (!parseRoomPasswordFromSearch(location.search)) return;
    const nextSearch = stripRoomPasswordFromSearch(location.search);
    if (nextSearch === location.search) return;
    navigate(
      { pathname: location.pathname, search: nextSearch },
      { replace: true, state: location.state },
    );
  }, [room?.id, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (!room?.id) return;
    if (shouldAutoShowAnnouncement(room.id, room.announcementEnabled, room.announcementText)) {
      setAnnouncementPopupOpen(true);
    }
  }, [room?.id, room?.announcementEnabled, room?.announcementText]);

  useEffect(() => {
    if (!exitReason) return;
    const redirectTimer = window.setTimeout(() => navigate('/'), 2500);
    return () => window.clearTimeout(redirectTimer);
  }, [exitReason, navigate]);

  useEffect(() => {
    getAvailableSources().then(setSources);
  }, []);

  useEffect(() => {
    const overlayOpen = Boolean(searchedKeyword || searching || playlistSearchLoading);
    if (overlayOpen && !prevOverlayOpenRef.current) {
      setOverlaySearchMode(activeSearchMode);
      const fromSearched = searchedKeyword.trim();
      let keyword = '';
      if (fromSearched.startsWith('歌单：')) {
        keyword = playlistSearchBackup?.keyword.trim() || '';
      } else if (!fromSearched.startsWith('正在')) {
        keyword = fromSearched;
      } else {
        keyword = query.trim();
      }
      setOverlayQuery(keyword);
    }
    prevOverlayOpenRef.current = overlayOpen;
  }, [activeSearchMode, searchedKeyword, searching, playlistSearchLoading, playlistSearchBackup, query]);

  const doSearch = useCallback(async (keyword: string, filterMode = searchFilterMode) => {

    if (!keyword.trim()) {

      setResults([]);

      return;

    }

    setSearching(true);

    try {

      const songs = await searchAllSongs(keyword, sources, { filterMode });

      setResults(songs);

    } catch {

      setResults([]);

    } finally {

      setSearching(false);

    }

  }, [sources, searchFilterMode]);

  const handleSearchFilterChange = useCallback((next: SearchFilterMode) => {
    if (isPlaylistResults) return;
    setSearchFilterMode(next);
    if (searchedKeyword.trim()) {
      doSearch(searchedKeyword, next);
    }
  }, [isPlaylistResults, searchedKeyword, doSearch]);

  const doPlaylistSearch = useCallback(async (
    keyword: string,
    page = 1,
    channel = playlistChannelFilter,
    limit = playlistSearchPageSize,
  ) => {
    const trimmed = keyword.trim();
    if (!trimmed) {
      setPlaylistSearchResults([]);
      setPlaylistSearchTotal(0);
      return;
    }
    setPlaylistSearchLoading(true);
    setIsPlaylistResults(false);
    setResults([]);
    try {
      const data = await searchPlaylists(trimmed, page, limit, channel);
      setPlaylistSearchResults(data.playlists);
      setPlaylistSearchPage(data.page);
      setPlaylistSearchTotal(data.total);
    } catch (err) {
      setPlaylistSearchResults([]);
      setPlaylistSearchTotal(0);
      showToast(err instanceof Error ? err.message : '歌单搜索失败', 'error');
    } finally {
      setPlaylistSearchLoading(false);
    }
  }, [playlistChannelFilter, playlistSearchPageSize, showToast]);

  useEffect(() => {
    playlistSearchScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [playlistSearchPage]);

  const handlePlaylistPageSizeChange = useCallback((next: SongResultPageSize) => {
    setPlaylistSearchPageSize(next);
    setStoredSongResultPageSize(next);
    if (searchedKeyword.trim() && activeSearchMode === 'playlist') {
      void doPlaylistSearch(searchedKeyword, 1, playlistChannelFilter, next);
    }
  }, [searchedKeyword, activeSearchMode, playlistChannelFilter, doPlaylistSearch]);

  const handlePlaylistChannelChange = useCallback((next: PlaylistChannelFilterMode) => {
    setPlaylistChannelFilter(next);
    if (searchedKeyword.trim() && activeSearchMode === 'playlist') {
      void doPlaylistSearch(searchedKeyword, 1, next);
    }
  }, [searchedKeyword, activeSearchMode, doPlaylistSearch]);

  const handlePlaylistImport = useCallback(async (platform: PlaylistPlatform, input: string) => {
    setPlaylistImportOpen(false);
    if (activeSearchMode === 'playlist' && searchedKeyword.trim() && playlistSearchResults.length > 0) {
      setPlaylistSearchBackup({
        keyword: searchedKeyword,
        results: playlistSearchResults,
        page: playlistSearchPage,
        total: playlistSearchTotal,
        channel: playlistChannelFilter,
        pageSize: playlistSearchPageSize,
      });
    }
    setSearching(true);
    setIsPlaylistResults(true);
    if (!isLgUp) {
      setSearchMode('song');
    }
    setActiveSearchMode('song');
    setOverlaySearchMode('song');
    setPlaylistSearchResults([]);
    setPlaylistSearchTotal(0);
    setSearchedKeyword(`正在解析${platform === 'netease' ? '红点' : '绿点'}歌单…`);
    setResults([]);

    try {
      const result = await importPlaylist(platform, input);
      if (result.playlistId) {
        rememberPlaylistImportHistory({ platform, playlistId: result.playlistId, name: result.name });
      }
      setResults(result.songs);
      setSearchedKeyword(`歌单：${result.name}`);

      if (result.songs.length === 0) {
        showToast('歌单为空或歌曲无法解析', 'error');
      } else if (result.failed && result.failed > 0) {
        showToast(`已解析 ${result.songs.length} 首，${result.failed} 首失败，请自选点歌`, 'success');
      } else {
        showToast(`已解析 ${result.songs.length} 首，请在结果中自选点歌`, 'success');
      }
    } catch (err) {
      setResults([]);
      setSearchedKeyword('');
      setIsPlaylistResults(false);
      showToast(err instanceof Error ? err.message : '歌单解析失败', 'error');
    } finally {
      setSearching(false);
    }
  }, [showToast, activeSearchMode, searchedKeyword, playlistSearchResults, playlistSearchPage, playlistSearchTotal, playlistChannelFilter, playlistSearchPageSize, isLgUp]);

  const handleRecommendPlaylistSelect = useCallback(async (playlist: PlaylistSearchItem) => {
    await handlePlaylistImport(playlist.platform, playlist.id);
  }, [handlePlaylistImport]);

  const handleSearch = useCallback(() => {
    const keyword = query.trim();
    const detectedPlatform = detectPlaylistLink(keyword);
    if (detectedPlatform) {
      void handlePlaylistImport(detectedPlatform, keyword);
      return;
    }
    setActiveSearchMode(searchMode);
    if (searchMode === 'playlist') {
      setSearchedKeyword(keyword);
      setIsPlaylistResults(false);
      void doPlaylistSearch(keyword, 1);
      return;
    }
    setIsPlaylistResults(false);
    setPlaylistSearchResults([]);
    setPlaylistSearchTotal(0);
    setSearchedKeyword(keyword);
    doSearch(keyword);
  }, [query, searchMode, doPlaylistSearch, doSearch, handlePlaylistImport]);

  const handleSearchModeChange = useCallback((mode: SearchMode) => {
    if (mode === searchMode) return;

    const fromQuery = query.trim();
    let keyword = fromQuery;
    if (!keyword) {
      const fromSearched = searchedKeyword.trim();
      if (fromSearched.startsWith('歌单：')) {
        keyword = playlistSearchBackup?.keyword.trim() || '';
      } else if (!fromSearched.startsWith('正在')) {
        keyword = fromSearched;
      }
    }
    if (!keyword) {
      setSearchMode(mode);
      return;
    }

    setSearchMode(mode);
    setActiveSearchMode(mode);
    setIsPlaylistResults(false);

    if (mode === 'playlist') {
      setResults([]);
      setSearchedKeyword(keyword);
      void doPlaylistSearch(keyword, 1);
      return;
    }

    setPlaylistSearchResults([]);
    setPlaylistSearchTotal(0);
    setSearchedKeyword(keyword);
    void doSearch(keyword);
  }, [searchMode, query, searchedKeyword, playlistSearchBackup, doPlaylistSearch, doSearch]);

  const handleOverlaySearch = useCallback(() => {
    const keyword = overlayQuery.trim();
    const detectedPlatform = detectPlaylistLink(keyword);
    if (detectedPlatform) {
      void handlePlaylistImport(detectedPlatform, keyword);
      return;
    }
    setActiveSearchMode(overlaySearchMode);
    if (overlaySearchMode === 'playlist') {
      setSearchedKeyword(keyword);
      setIsPlaylistResults(false);
      void doPlaylistSearch(keyword, 1);
      return;
    }
    setIsPlaylistResults(false);
    setPlaylistSearchResults([]);
    setPlaylistSearchTotal(0);
    setSearchedKeyword(keyword);
    void doSearch(keyword);
  }, [overlayQuery, overlaySearchMode, doPlaylistSearch, doSearch, handlePlaylistImport]);

  const handleOverlaySearchModeChange = useCallback((mode: SearchMode) => {
    if (mode === overlaySearchMode) return;

    const fromQuery = overlayQuery.trim();
    let keyword = fromQuery;
    if (!keyword) {
      const fromSearched = searchedKeyword.trim();
      if (fromSearched.startsWith('歌单：')) {
        keyword = playlistSearchBackup?.keyword.trim() || '';
      } else if (!fromSearched.startsWith('正在')) {
        keyword = fromSearched;
      }
    }
    if (!keyword) {
      setOverlaySearchMode(mode);
      return;
    }

    setOverlaySearchMode(mode);
    setActiveSearchMode(mode);
    setOverlayQuery(keyword);
    setIsPlaylistResults(false);

    if (mode === 'playlist') {
      setResults([]);
      setSearchedKeyword(keyword);
      void doPlaylistSearch(keyword, 1);
      return;
    }

    setPlaylistSearchResults([]);
    setPlaylistSearchTotal(0);
    setSearchedKeyword(keyword);
    void doSearch(keyword);
  }, [overlaySearchMode, overlayQuery, searchedKeyword, playlistSearchBackup, doPlaylistSearch, doSearch]);

  const clearSearchResults = useCallback(() => {
    setQuery('');
    setOverlayQuery('');
    setResults([]);
    setPlaylistSearchResults([]);
    setPlaylistSearchTotal(0);
    setPlaylistSearchLoading(false);
    setSearchedKeyword('');
    setIsPlaylistResults(false);
    setListPageSongs([]);
    setPlaylistSearchBackup(null);
    setActiveSearchMode('song');
    setOverlaySearchMode('song');
  }, []);

  const handleBackToPlaylistSearch = useCallback(() => {
    if (!playlistSearchBackup) {
      clearSearchResults();
      return;
    }
    setIsPlaylistResults(false);
    setResults([]);
    setActiveSearchMode('playlist');
    setOverlaySearchMode('playlist');
    setSearchedKeyword(playlistSearchBackup.keyword);
    setOverlayQuery(playlistSearchBackup.keyword);
    if (!isLgUp) {
      setSearchMode('playlist');
      setQuery(playlistSearchBackup.keyword);
    }
    setPlaylistSearchResults(playlistSearchBackup.results);
    setPlaylistSearchPage(playlistSearchBackup.page);
    setPlaylistSearchTotal(playlistSearchBackup.total);
    setPlaylistChannelFilter(playlistSearchBackup.channel);
    setPlaylistSearchPageSize(playlistSearchBackup.pageSize);
    setListPageSongs([]);
  }, [playlistSearchBackup, clearSearchResults, isLgUp]);

  const handleAdd = useCallback(async (song: SearchResult) => {
    if (songRequestBlockReason) {
      showToast(songRequestBlockReason, 'error');
      return;
    }
    const key = songKey(song);
    setAddingId(key);
    const res = await addSong({
      id: song.id,
      source: song.source,
      name: song.name,
      artist: song.artist,
      album: song.album,
      pic: song.pic,
      duration: song.duration,
      url: song.url,
      lrc: song.lrc,
    });
    setAddingId(null);
    if (res.success) {
      lastSongRequestAtRef.current = Date.now();
      showToast('点歌成功', 'success');
    } else if (res.error) {
      showToast(res.error, 'error');
    }
  }, [songRequestBlockReason, addSong, showToast]);

  const handleListPageResultsChange = useCallback((songs: SearchResult[]) => {
    setListPageSongs(songs);
  }, []);

  const handleAddMany = useCallback(async (songs: SearchResult[]) => {
    if (addingPage || songs.length === 0) return;
    const blockReason = getSongRequestBlockReason(
      useRoomStore.getState().room,
      isOwner,
      isAdmin,
      useRoomStore.getState().mySocketId,
      lastSongRequestAtRef.current || null,
      useRoomStore.getState().canControlPlayback,
    );
    if (blockReason) {
      showToast(blockReason, 'error');
      return;
    }
    setAddingPage(true);
    try {
      const result = await addSongsToQueue(songs, {
        getRoom: () => useRoomStore.getState().room,
        addSong,
      });
      const toast = formatBulkAddToast(result);
      showToast(toast.message, toast.type);
    } finally {
      setAddingPage(false);
    }
  }, [addingPage, addSong, showToast, isOwner, isAdmin]);

  const handleSaveFmMode = useCallback(async (mode: string) => {
    if (fmSaving) return;
    setFmSaving(true);
    const res = await setRoomFmMode(mode);
    setFmSaving(false);
    if (res.success) {
      showToast('漫游模式已更新', 'success');
    } else {
      showToast(res.error || '漫游模式设置失败', 'error');
    }
  }, [fmSaving, setRoomFmMode, showToast]);

  const handleTransferOwner = useCallback(async (userId: string) => {
    if (transferSaving) return;
    setTransferSaving(true);
    const res = await transferOwner(userId);
    setTransferSaving(false);
    if (res.success) {
      showToast(res.message || '房主已转让', 'success');
      setSettingsOpen(false);
    } else {
      showToast(res.error || '转让失败', 'error');
    }
  }, [transferSaving, transferOwner, showToast]);

  const handleSaveAnnouncement = useCallback(async (options: { enabled: boolean; text: string }) => {
    if (announcementSaving) return;
    setAnnouncementSaving(true);
    const res = await setRoomAnnouncement(options);
    setAnnouncementSaving(false);
    if (res.success) {
      showToast('公告已更新', 'success');
    } else {
      showToast(res.error || '公告设置失败', 'error');
    }
  }, [announcementSaving, setRoomAnnouncement, showToast]);

  const handleSaveChatHistory = useCallback(async (enabled: boolean) => {
    if (chatHistorySaving) return;
    setChatHistorySaving(true);
    const res = await setChatHistoryVisibleOnJoin(enabled);
    setChatHistorySaving(false);
    if (res.success) {
      showToast(enabled ? '已允许进房查看历史消息' : '已关闭进房查看历史消息', 'success');
    } else {
      showToast(res.error || '聊天设置失败', 'error');
    }
  }, [chatHistorySaving, setChatHistoryVisibleOnJoin, showToast]);

  const handleSaveSongRequestSettings = useCallback(async (settings: SongRequestSettings) => {
    if (songRequestSaving) return;
    setSongRequestSaving(true);
    const res = await setSongRequestEnabled({
      enabled: settings.enabled,
      memberJumpEnabled: settings.memberJumpEnabled,
      memberSeekEnabled: settings.memberSeekEnabled,
      memberPauseEnabled: settings.memberPauseEnabled,
      systemMediaPlayBound: settings.systemMediaPlayBound,
      systemMediaSkipBound: settings.systemMediaSkipBound,
      dislikeSkipMode: settings.dislikeSkipMode,
      dislikeSkipThreshold: settings.dislikeSkipThreshold,
      dislikeSkipPercent: settings.dislikeSkipPercent,
      clearSongsOnLeaveEnabled: settings.clearSongsOnLeaveEnabled,
      clearSongsOnLeaveDelaySec: settings.clearSongsOnLeaveDelayMinutes * 60,
      minStaySec: settings.minStayMinutes * 60,
      maxPerUser: settings.maxPerUser,
      cooldownSec: settings.cooldownSec,
      queueMaxLength: settings.queueMaxLength,
    });
    setSongRequestSaving(false);
    if (res.success) {
      showToast('点歌规则已更新', 'success');
    } else {
      showToast(res.error || '点歌设置失败', 'error');
    }
  }, [songRequestSaving, setSongRequestEnabled, showToast]);

  const handleUnbanSong = useCallback(async (name: string) => {
    if (songRequestSaving) return;
    setSongRequestSaving(true);
    const res = await unbanRoomSong(name);
    setSongRequestSaving(false);
    if (res.success) {
      showToast('已解除禁播', 'success');
    } else {
      showToast(res.error || '解除禁播失败', 'error');
    }
  }, [songRequestSaving, unbanRoomSong, showToast]);

  const handleOpenMemberModalFromSettings = useCallback(() => {
    setSettingsOpen(false);
    setMemberOpen(true);
  }, []);

  const handleSaveMemberSettings = useCallback(async (settings: RoomMemberSettings) => {
    if (memberSaving) return;
    setMemberSaving(true);
    const res = await setRoomMemberSettings(settings);
    setMemberSaving(false);
    if (res.success) {
      showToast('贵宾设置已更新', 'success');
    } else {
      showToast(res.error || '贵宾设置失败', 'error');
    }
  }, [memberSaving, setRoomMemberSettings, showToast]);

  const handleSaveUserQuality = useCallback((quality: RoomAudioQuality) => {
    useUserQualityStore.getState().setQuality(quality);
    const liveRoom = useRoomStore.getState().room;
    const keepTrackKey = liveRoom?.current ? songKey(liveRoom.current) : null;
    invalidateUnloadedSongUrlCache(keepTrackKey);
    if (liveRoom) prefetchUpcomingFromRoom(liveRoom);
    showToast('音质已更新，当前歌曲继续播放', 'success');
  }, [showToast]);

  const handleAssignMemberTier = useCallback(async (userId: string, tier: Omit<RoomMemberTier, 'userId' | 'assignedAt'>) => {
    if (memberSaving) return;
    setMemberSaving(true);
    const res = await setRoomMemberTier(userId, tier);
    setMemberSaving(false);
    if (res.success) {
      showToast('已赋予贵宾身份', 'success');
    } else {
      showToast(res.error || '赋予失败', 'error');
    }
  }, [memberSaving, setRoomMemberTier, showToast]);

  const handleRemoveMemberTier = useCallback(async (userId: string) => {
    if (memberSaving) return;
    setMemberSaving(true);
    const res = await removeRoomMemberTier(userId);
    setMemberSaving(false);
    if (res.success) {
      showToast('已移除贵宾身份', 'success');
    } else {
      showToast(res.error || '移除失败', 'error');
    }
  }, [memberSaving, removeRoomMemberTier, showToast]);

  const handleCloseAnnouncementPopup = useCallback(() => {
    if (room?.id && room.announcementEnabled && room.announcementText?.trim()) {
      markAnnouncementSeen(room.id, room.announcementEnabled, room.announcementText);
    }
    setAnnouncementPopupOpen(false);
  }, [room]);

  const handleAddCurrentPage = useCallback(() => {
    void handleAddMany(listPageSongs);
  }, [handleAddMany, listPageSongs]);

  const handleCopyRoom = async () => {
    if (!room?.id) return;
    let sharePassword: string | undefined;
    if (room.hasPassword) {
      sharePassword = getStoredRoomPassword(room.id) || lockPassword.trim() || undefined;
      if (!sharePassword) {
        showToast('无法获取房间密码，请在房间设置中重新设置密码后再分享', 'error');
        return;
      }
    }
    const text = buildRoomShareText({
      inviterNickname: nickname,
      roomId: room.id,
      roomName: room.name,
      password: sharePassword,
      currentSong: room.current
        ? { name: room.current.name, artist: room.current.artist }
        : null,
      isPlaying: room.isPlaying,
    });
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      showToast('复制失败，请手动复制地址栏链接', 'error');
    }
  };

  const displayVisualMode: RoomVisualMode = pureMode ? 'off' : visualMode;
  const ambientGlassClass = roomAmbientGlassClass(displayVisualMode);

  const handlePureModeToggle = useCallback(() => {
    const next = !pureMode;
    setPureModeEnabled(next);
    if (next) {
      void exitDocumentFullscreen();
      setImmersiveModeEnabled(false);
      setVisualFxOpen(false);
      setPurePlayerHidden(false);
      if (searchMode !== 'song') {
        setSearchMode('song');
        setActiveSearchMode('song');
        setOverlaySearchMode('song');
      }
      applyPureModeDisguise();
      showToast('已开启纯净模式', 'success');
    } else {
      clearPureModeDisguise(roomPageTitle);
      showToast('已退出纯净模式', 'success');
    }
  }, [pureMode, setPureModeEnabled, setImmersiveModeEnabled, searchMode, roomPageTitle, showToast]);

  const applyVisualMode = useCallback(
    (mode: RoomVisualMode, options?: { notifyProxyChange?: boolean; reloadAudio?: boolean }) => {
      if (!isLgUp) return;
      const prevNeedsProxy = shouldProxySongPlaybackUrl(visualMode);
      const nextNeedsProxy = shouldProxySongPlaybackUrl(mode);
      setVisualMode(mode);
      writeRoomVisualMode(mode);
      const shouldReloadAudio = options?.reloadAudio !== false;
      if (shouldReloadAudio && prevNeedsProxy !== nextNeedsProxy && room?.current) {
        resetSharedAudioElement();
        useAudioStore.getState().requestTrackReload();
        if (options?.notifyProxyChange !== false) {
          showToast('背景已切换，当前歌曲正在重新加载', 'success');
        }
      }
    },
    [isLgUp, room?.current, showToast, visualMode],
  );

  const refreshPlaybackUrlCacheForQuality = useCallback(() => {
    const liveRoom = useRoomStore.getState().room;
    const keepTrackKey = liveRoom?.current ? songKey(liveRoom.current) : null;
    invalidateUnloadedSongUrlCache(keepTrackKey);
    if (liveRoom) prefetchUpcomingFromRoom(liveRoom);
  }, []);

  const runImmersiveExit = useCallback(async (kind: 'keep-bg' | 'cover-bg') => {
    if (immersiveTransitionRef.current) return;
    immersiveTransitionRef.current = true;
    setImmersiveExitPromptOpen(false);
    void exitDocumentFullscreen();

    const liveRoom = useRoomStore.getState().room;
    const currentSong = liveRoom?.current ?? null;
    const initialSteps = createExitSteps(kind === 'cover-bg');
    const startedAt = Date.now();

    setImmersiveTransition({
      direction: 'exit',
      phase: 'loading',
      steps: initialSteps,
    });

    let recoveryPending = false;
    try {
      try {
        await runImmersiveExitPrep({
          kind,
          song: currentSong,
          visualMode,
          steps: initialSteps,
          applyVisualMode,
          onStepsChange: (steps) => {
            setImmersiveTransition((prev) => (prev ? { ...prev, steps } : prev));
          },
        });
      } catch (error) {
        // 退出界面不能被音频重载或媒体元数据超时阻塞，音频可在后台继续恢复。
        recoveryPending = true;
        console.warn('Immersive exit preparation is still recovering:', error);
      }

      await ensureMinimumLoadingDuration(startedAt);

      setImmersiveTransition((prev) => (prev ? { ...prev, phase: 'reveal' } : prev));
      setImmersiveShellMotion('exiting');
      ensureGalaxyAudioOutputLazy();

      await new Promise((resolve) => window.setTimeout(resolve, IMMERSIVE_REVEAL_OUT_MS));

    } catch (error) {
      recoveryPending = true;
      console.error('Unexpected immersive exit error:', error);
    } finally {
      // 无论背景或音频恢复是否及时完成，都必须先退出沉浸界面，避免用户被困住。
      setImmersiveModeEnabled(false);
      setVisualFxOpen(false);
      setImmersivePanelFocus(null);
      ensureGalaxyAudioOutputLazy();
      refreshPlaybackUrlCacheForQuality();
      immersiveTransitionRef.current = false;
      setImmersiveTransition(null);
      setImmersiveShellMotion(null);

      showToast(
        recoveryPending
          ? '已退出沉浸模式，音频正在后台恢复'
          : kind === 'cover-bg'
            ? '已退出沉浸模式，并切回封面背景'
            : '已退出沉浸模式，保留当前动态背景',
        'success',
      );
    }
  }, [applyVisualMode, refreshPlaybackUrlCacheForQuality, setImmersiveModeEnabled, showToast, visualMode]);

  const handleImmersiveExitKeepBackground = useCallback(() => {
    void runImmersiveExit('keep-bg');
  }, [runImmersiveExit]);

  const handleImmersiveExitToCover = useCallback(() => {
    void runImmersiveExit('cover-bg');
  }, [runImmersiveExit]);

  const handleImmersiveToggle = useCallback(() => {
    if (immersiveMode) {
      setImmersiveExitPromptOpen(true);
      return;
    }
    if (immersiveTransitionRef.current) return;

    const liveRoom = useRoomStore.getState().room;
    const currentSong = liveRoom?.current ?? null;
    const targetMode: RoomVisualMode = visualMode === 'cover-bg' ? 'emily' : visualMode;
    const needsModeSwitch = visualMode === 'cover-bg';
    const needsProxyReload =
      Boolean(currentSong)
      && shouldProxySongPlaybackUrl(targetMode)
      && !shouldProxySongPlaybackUrl(visualMode);
    const needsCover = Boolean(currentSong);
    const initialSteps = createEnterSteps(needsCover, needsProxyReload);
    const startedAt = Date.now();

    immersiveTransitionRef.current = true;
    setImmersiveTransition({
      direction: 'enter',
      phase: 'loading',
      steps: initialSteps,
    });

    // 沉浸仅临时封顶「极高」，不改写用户音质设置；设置更低时沿用设置
    setImmersiveQualityCapActive(true);
    refreshPlaybackUrlCacheForQuality();

    void (async () => {
      try {
        await runImmersiveEnterPrep({
          song: currentSong,
          needsProxyReload,
          needsCover,
          needsModeSwitch,
          mode: targetMode,
          steps: initialSteps,
          applyVisualMode: (mode, opts) => applyVisualMode(mode, { ...opts, reloadAudio: false }),
          onStepsChange: (steps) => {
            setImmersiveTransition((prev) => (prev ? { ...prev, steps } : prev));
          },
        });

        await ensureMinimumLoadingDuration(startedAt);

        setImmersiveTransition((prev) => (prev ? { ...prev, phase: 'reveal' } : prev));
        setImmersiveShellMotion('entering');
        setImmersiveModeEnabled(true);
        setVisualFxOpen(false);
        ensureGalaxyAudioOutputLazy();

        await new Promise((resolve) => window.setTimeout(resolve, IMMERSIVE_REVEAL_IN_MS));
        showToast('已进入沉浸模式', 'success');
      } catch (error) {
        console.error('Failed to enter immersive mode:', error);
        setImmersiveQualityCapActive(false);
        refreshPlaybackUrlCacheForQuality();
        showToast('沉浸模式加载失败，请重试', 'error');
      } finally {
        immersiveTransitionRef.current = false;
        setImmersiveTransition(null);
        setImmersiveShellMotion(null);
      }
    })();
  }, [
    applyVisualMode,
    immersiveMode,
    refreshPlaybackUrlCacheForQuality,
    setImmersiveModeEnabled,
    setImmersiveQualityCapActive,
    showToast,
    visualMode,
  ]);

  useEffect(() => {
    if (!showImmersiveEntry && immersiveMode) {
      void exitDocumentFullscreen();
      setImmersiveModeEnabled(false);
    }
  }, [showImmersiveEntry, immersiveMode, setImmersiveModeEnabled]);

  useEffect(() => {
    if (pureMode && immersiveMode) {
      void exitDocumentFullscreen();
      setImmersiveModeEnabled(false);
    }
  }, [pureMode, immersiveMode, setImmersiveModeEnabled]);

  useEffect(() => {
    if (pureMode) {
      applyPureModeDisguise();
    }
    return () => {
      if (pureMode) clearPureModeDisguise(roomPageTitle);
    };
  }, [pureMode, roomPageTitle]);

  useEffect(() => {
    if (!pureMode) {
      setPurePlayerHidden(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      setPurePlayerHidden((hidden) => !hidden);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pureMode]);

  const handleVisualModeChange = (mode: RoomVisualMode) => {
    applyVisualMode(mode, { notifyProxyChange: true });
  };

  useEffect(() => {
    if (!isLgUp) setVisualFxOpen(false);
  }, [isLgUp]);

  const patchVisualFx = (patch: Partial<RoomVisualFxSettings>) => {
    if (!isLgUp) return;
    const next = patchRoomVisualFx(patch);
    setVisualFx(next);
  };

  const resetVisualFx = () => {
    const next = commitRoomVisualFx({ ...DEFAULT_ROOM_VISUAL_FX });
    setVisualFx(next);
  };


  const handlePasswordJoin = useCallback(() => {
    const pwd = passwordDraft.trim();
    if (!pwd) {
      setJoinError('请输入房间密码');
      return;
    }
    setJoinError('');
    setJoinPasswordOverride(pwd);
  }, [passwordDraft]);


  if (needsPasswordPrompt && !room) {

    return (

      <div className="min-h-full flex items-center justify-center px-6">

        <div className="w-full max-w-sm rounded-2xl border border-netease-border/60 bg-netease-card/80 p-6 shadow-xl">
          <h2 className="text-lg font-medium text-white mb-1">需要房间密码</h2>
          <p className="text-sm text-netease-muted mb-4">输入密码后即可进入房间</p>
          <label className="block text-xs text-white/50 mb-1.5">房间密码</label>
          <input
            type="password"
            value={passwordDraft}
            onChange={(e) => {
              setPasswordDraft(e.target.value);
              if (joinError) setJoinError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handlePasswordJoin();
            }}
            maxLength={32}
            autoFocus
            placeholder="输入房间密码"
            className="w-full bg-netease-dark border border-netease-border rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-netease-muted/50 focus:outline-none focus:border-netease-red/50 mb-3"
          />
          {joinError && <p className="text-xs text-netease-red mb-3">{joinError}</p>}
          <button
            type="button"
            onClick={handlePasswordJoin}
            className="w-full bg-netease-red hover:bg-red-500 text-white font-medium py-3 rounded-xl transition-colors"
          >
            进入房间
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="w-full mt-2 text-sm text-white/50 hover:text-white/80 py-2 transition-colors"
          >
            返回大厅
          </button>
        </div>

      </div>

    );

  }


  if (joinError) {

    return (

      <div className="min-h-full flex items-center justify-center">

        <p className="text-netease-red">{joinError}，正在返回...</p>

      </div>

    );

  }

  if (exitReason) {

    return (

      <div className="min-h-full flex items-center justify-center px-6 text-center">

        <p className="text-netease-red">{exitReason}，正在返回...</p>

      </div>

    );

  }



  if (!room) {

    return (

      <div className="min-h-full flex items-center justify-center">

        <Loader2 className="w-8 h-8 text-netease-red animate-spin" />

      </div>

    );

  }



  const searchableCount = sources.filter((s) => s.supportsSearch).length;
  const qqImportEnabled = sources.some((s) => s.id === 'tencent' && s.supportsSearch);
  const queueCount = (room.current ? 1 : 0) + room.queue.length;
  const showDesktopSearchOverlay = Boolean(searchedKeyword || searching || playlistSearchLoading);
  const showPlaylistSearch = activeSearchMode === 'playlist' && Boolean(searchedKeyword || playlistSearchLoading);
  const hasPlaylistSearchResults = showPlaylistSearch && playlistSearchResults.length > 0;
  const showPlaylistEmpty = showPlaylistSearch && !playlistSearchLoading && playlistSearchResults.length === 0;
  const showPlaylistSkeleton = showPlaylistSearch && playlistSearchLoading && playlistSearchResults.length === 0;
  const playlistSearchTotalPages = Math.max(1, Math.ceil(playlistSearchTotal / playlistSearchPageSize));
  const externalSearchButtonLoading = showDesktopSearchOverlay
    ? false
    : searchMode === 'song'
      ? searching
      : playlistSearchLoading && playlistSearchResults.length === 0;

  const overlaySearchButtonLoading = overlaySearchMode === 'song'
    ? searching
    : playlistSearchLoading && playlistSearchResults.length === 0;

  const renderResultsSummary = () => {
    if (activeSearchMode === 'playlist' && playlistSearchLoading) {
      return `正在搜索歌单「${searchedKeyword}」...`;
    }
    if (searching) {
      return isPlaylistResults ? searchedKeyword : `正在搜索「${searchedKeyword}」...`;
    }
    if (hasPlaylistSearchResults) return `找到 ${playlistSearchTotal || playlistSearchResults.length} 个相关歌单`; 
    if (results.length === 0) {
      if (showPlaylistSearch) return '没有找到相关歌单';
      return isPlaylistResults ? '歌单为空或链接无效' : `「${searchedKeyword}」无相关结果`;
    }
    if (isPlaylistResults) {
      const name = searchedKeyword.replace(/^歌单：/, '');
      return `「${name}」共 ${results.length} 首，请自选点歌`;
    }
    return `找到 ${results.length} 首相关歌曲`;
  };

  const showSongListResults = Boolean(
    !searching && searchedKeyword && !showPlaylistSearch && results.length > 0,
  );

  const renderBulkAddPageButton = (className = '') => (
    <button
      type="button"
      onClick={handleAddCurrentPage}
      disabled={addingPage || listPageSongs.length === 0}
      className={`flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-netease-red transition-colors hover:bg-netease-red/10 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {addingPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" />}
      一键点歌本页
    </button>
  );

  const renderQueueSection = (fillHeight = false) => (
    <div
      className={`surface-panel rounded-2xl overflow-hidden flex flex-col ${
        fillHeight ? 'h-full flex-1 min-h-0' : 'flex-shrink-0'
      }`}
    >
      <div className="relative flex items-center justify-between px-4 py-2.5 sm:py-3 border-b border-netease-border/50 flex-shrink-0">
        <h2 className="text-sm font-medium">播放队列</h2>
        <span className="text-xs text-netease-muted">
          {queueCount > 0 ? `共 ${queueCount} 首` : '暂无歌曲'}
        </span>
        <QueueSystemToast />
      </div>
      <div className={`p-2 ${fillHeight ? 'flex-1 min-h-0 overflow-hidden flex flex-col' : ''}`}>
        <QueuePanel fillHeight={fillHeight} />
      </div>
    </div>
  );

  const searchBar = (
    <div className="flex gap-2 mb-2">
      {!pureMode && (
        <Tooltip side="bottom" content="搜索类型">
          <div className="flex flex-shrink-0 overflow-hidden rounded-xl border border-netease-border bg-netease-card p-1 sm:rounded-2xl">
          {([
            ['song', '歌曲'],
            ['playlist', '歌单'],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => handleSearchModeChange(mode)}
              className={`rounded-lg px-2.5 py-2 text-xs transition-colors sm:px-3 sm:py-2.5 sm:text-sm ${
                searchMode === mode ? 'bg-netease-red text-white shadow-sm' : 'text-netease-muted hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
          </div>
        </Tooltip>
      )}
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 sm:w-5 h-4 sm:h-5 text-netease-muted pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder={searchMode === 'playlist' ? '搜索红点/绿点歌单...' : '搜索歌曲、歌手，或粘贴歌单链接...'}
          className="w-full bg-netease-card border border-netease-border rounded-xl sm:rounded-2xl pl-10 sm:pl-12 pr-4 py-3 sm:py-3.5 text-sm sm:text-base text-white placeholder:text-netease-muted/50 focus:outline-none focus:border-netease-red/50 transition-colors"
        />
      </div>
      <button
        type="button"
        onClick={handleSearch}
        disabled={!query.trim() || (searchMode === 'song' && searching)}
        className="flex-shrink-0 px-3.5 sm:px-5 py-3 sm:py-3.5 rounded-xl sm:rounded-2xl bg-netease-red text-white text-sm font-medium hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
      >
        {externalSearchButtonLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 sm:hidden" />}
        <span className="hidden sm:inline">搜索</span>
      </button>
    </div>
  );

  const renderPlaylistSearchList = (fillHeight = false, immersiveGlass = false) => (
    <div
      className={`flex min-h-0 flex-col ${fillHeight ? 'h-full' : ''}`}
      style={fillHeight ? undefined : { height: RESULT_BODY_HEIGHT }}
    >
      <div ref={playlistSearchScrollRef} className={`relative min-h-0 flex-1 overflow-y-auto ${playlistSearchLoading ? 'pointer-events-none' : ''}`}>
        <div className={`space-y-2 transition-opacity ${playlistSearchLoading ? 'opacity-40' : ''}`}>
          {playlistSearchResults.map((playlist) => (
            <Tooltip key={`${playlist.platform}-${playlist.id}`} content="双击查看歌单" side="bottom">
              <div
                className={`group flex cursor-pointer items-center gap-2 rounded-xl p-2.5 transition-colors sm:gap-3 sm:p-3 ${
                  immersiveGlass ? immersiveGlassListRow : 'hover:bg-netease-card/80'
                }`}
                onDoubleClick={() => {
                  if (!playlistSearchLoading && !searching) {
                    void handlePlaylistImport(playlist.platform, playlist.id);
                  }
                }}
              >
                <img
                  src={playlist.coverImgUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect fill="%23333" width="48" height="48"/><text x="24" y="28" text-anchor="middle" fill="%23666" font-size="16">♪</text></svg>'}
                  alt=""
                  className="h-12 w-12 flex-shrink-0 rounded-lg bg-netease-card object-cover"
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-sm font-medium">{playlist.name}</p>
                  <p className="truncate text-xs text-netease-muted">
                    {playlist.creatorName || (playlist.platform === 'qq' ? '绿点歌单' : '红点歌单')} · {playlist.trackCount} 首
                  </p>
                </div>
                <SourceBadge source={playlist.platform === 'qq' ? 'tencent' : 'netease'} variant="muted" />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handlePlaylistImport(playlist.platform, playlist.id);
                  }}
                  disabled={playlistSearchLoading || searching}
                  className="flex flex-shrink-0 items-center gap-1 rounded-full bg-netease-red/10 px-2.5 py-1 text-xs font-medium text-netease-red transition-all hover:bg-netease-red hover:text-white disabled:opacity-50"
                >
                  <ListMusic className="h-4 w-4" />
                  查看
                </button>
              </div>
            </Tooltip>
          ))}
        </div>
        {playlistSearchLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-netease-muted" />
          </div>
        )}
      </div>
      <div
        className={`mt-auto flex-shrink-0 space-y-2 overflow-visible pt-3 ${
          immersiveGlass ? immersiveGlassListFooter : 'border-t border-netease-border/40 bg-netease-bg/90'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PageSizeSelect
            value={playlistSearchPageSize}
            options={SONG_RESULT_PAGE_SIZE_OPTIONS}
            onChange={handlePlaylistPageSizeChange}
          />
          <span className="text-xs text-netease-muted">
            {playlistSearchPage} / {playlistSearchTotalPages}
            <span className="ml-1 text-netease-muted/50">共 {playlistSearchTotal} 个</span>
          </span>
        </div>
        <PageNumberPagination
          page={playlistSearchPage}
          totalPages={playlistSearchTotalPages}
          disabled={playlistSearchLoading}
          onPageChange={(p) => void doPlaylistSearch(searchedKeyword, p)}
        />
      </div>
    </div>
  );

  const overlaySearchBar = (
    <div className="flex gap-2 flex-shrink-0">
      {!pureMode && (
        <div className="flex flex-shrink-0 overflow-hidden rounded-xl border border-netease-border bg-netease-card p-1">
          {([
            ['song', '歌曲'],
            ['playlist', '歌单'],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => handleOverlaySearchModeChange(mode)}
              className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                overlaySearchMode === mode ? 'bg-netease-red text-white shadow-sm' : 'text-netease-muted hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-netease-muted pointer-events-none" />
        <input
          type="text"
          value={overlayQuery}
          onChange={(e) => setOverlayQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleOverlaySearch()}
          placeholder={overlaySearchMode === 'playlist' ? '搜索红点/绿点歌单...' : '搜索歌曲、歌手，或粘贴歌单链接...'}
          className="w-full bg-netease-card border border-netease-border rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder:text-netease-muted/50 focus:outline-none focus:border-netease-red/50 transition-colors"
        />
      </div>
      <button
        type="button"
        onClick={handleOverlaySearch}
        disabled={!overlayQuery.trim() || (overlaySearchMode === 'song' && searching)}
        className="flex-shrink-0 px-3 py-2 rounded-xl bg-netease-red text-white text-sm font-medium hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
      >
        {overlaySearchButtonLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        搜索
      </button>
    </div>
  );

  const immersiveSearchBar = (
    <div className="w-full">
      <div id="search-box" className="mineradio-glass-search-box">
        <Search className="mr-2.5 h-4 w-4 flex-shrink-0 text-white/30" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder={searchMode === 'playlist' ? '搜索红点/绿点歌单...' : '搜索歌曲、歌手，或粘贴歌单链接...'}
          className="min-w-0 flex-1 border-none bg-transparent text-[13.5px] tracking-wide text-white outline-none placeholder:text-white/22"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={!query.trim() || (searchMode === 'song' && searching)}
          className="ml-3 flex-shrink-0 rounded-full px-3 py-1 text-[11px] font-medium text-[#eafffb] transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {externalSearchButtonLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '搜索'}
        </button>
      </div>
      <div className="mt-2 flex justify-center">
        <div id="search-mode-tabs" className="mineradio-search-mode-tabs">
        {([
          ['song', '歌曲'],
          ['playlist', '歌单'],
        ] as const).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => handleSearchModeChange(mode)}
            className={searchMode === mode ? 'active' : undefined}
          >
            {label}
          </button>
        ))}
        </div>
      </div>
    </div>
  );

  const immersiveSearchExtras = (
    <div className="flex items-center justify-center gap-1.5 overflow-x-auto">
      <button
        type="button"
        onClick={() => setSongHistoryOpen(true)}
        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] text-white/55 ${immersiveGlassChip}`}
      >
        播放历史
      </button>
      <button
        type="button"
        onClick={() => setRecommendDrawerOpen(true)}
        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] text-white/55 ${immersiveGlassChip}`}
      >
        热榜歌单
      </button>
      <button
        type="button"
        onClick={openFavorites}
        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] text-white/55 ${immersiveGlassChip}`}
      >
        我的收藏
      </button>
      <button
        type="button"
        onClick={() => setPlaylistImportOpen(true)}
        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] text-white/55 ${immersiveGlassChip}`}
      >
        导入歌单
      </button>
    </div>
  );

  const renderSearchResultsCore = (fillHeight = true, immersiveGlass = false) => (
    <div className={`flex min-h-0 flex-col ${fillHeight ? 'h-full flex-1' : ''}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
        <p className="min-w-0 truncate text-xs text-white/55">{renderResultsSummary()}</p>
        <div className="flex flex-shrink-0 items-center gap-2">
          {showPlaylistSearch && (
            <PlaylistChannelFilter value={playlistChannelFilter} onChange={handlePlaylistChannelChange} />
          )}
          {!searching && searchableCount > 0 && !isPlaylistResults && activeSearchMode === 'song' && (
            <SearchFilterSelect value={searchFilterMode} onChange={handleSearchFilterChange} />
          )}
          {showSongListResults && renderBulkAddPageButton('px-2.5 py-1.5')}
          <button
            type="button"
            onClick={clearSearchResults}
            className="rounded-lg px-2 py-1 text-xs text-white/45 transition-colors hover:bg-white/10 hover:text-white"
          >
            清除
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {searching && searchedKeyword && !showPlaylistSearch && <SearchSkeleton fillHeight />}
        {showPlaylistSkeleton && (
          <SearchSkeleton fillHeight count={playlistSearchPageSize} showPaginationFooter={false} />
        )}
        {!searching && !playlistSearchLoading && searchedKeyword && !hasPlaylistSearchResults && results.length === 0 && (
          <p className="animate-fade-in py-10 text-center text-white/45">
            {showPlaylistEmpty ? '没有找到相关歌单' : isPlaylistResults ? '歌单为空或链接无效' : '换个关键词试试'}
          </p>
        )}
        {hasPlaylistSearchResults && renderPlaylistSearchList(true, immersiveGlass)}
        {!searching && searchedKeyword && !showPlaylistSearch && (
          <SongResultList
            results={results}
            addingId={addingId}
            onAdd={handleAdd}
            keyword={searchedKeyword}
            alwaysShowActions
            fillHeight
            immersiveGlass={immersiveGlass}
            onPageResultsChange={handleListPageResultsChange}
          />
        )}
      </div>
    </div>
  );



  return (
    <Suspense fallback={null}>
    <div
      className="relative isolate flex h-full flex-col overflow-hidden"
      style={immersiveTransition || immersiveShellMotion ? immersiveTimingCssVars() : undefined}
    >

      <Suspense fallback={null}>
        <ImmersiveTransitionOverlay
          transition={immersiveTransition}
          coverUrl={room.current ? getCoverUrl(room.current, 'medium') : null}
        />
      </Suspense>

      <RoomAmbientBackground
        song={room.current}
        visualMode={displayVisualMode}
        isPlaying={Boolean(room.isPlaying)}
        immersivePanelFocus={immersiveMode ? immersivePanelFocus : null}
      />

      {immersiveMode && (
        <Suspense fallback={null}>
          <RoomImmersiveShell
            className={
              immersiveShellMotion === 'entering'
                ? 'is-shell-entering'
                : immersiveShellMotion === 'exiting'
                  ? 'is-shell-exiting'
                  : undefined
            }
            onExit={() => {
              if (immersiveTransition) return;
              setImmersiveExitPromptOpen(true);
            }}
            onPanelFocusChange={setImmersivePanelFocus}
            searchBar={immersiveSearchBar}
            searchExtras={immersiveSearchExtras}
            showSearchResults={showDesktopSearchOverlay}
            searchResults={
              showDesktopSearchOverlay ? (
                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                  {renderSearchResultsCore(true, true)}
                </div>
              ) : null
            }
            queueContent={<QueuePanel fillHeight />}
            chatContent={<ChatPanel />}
            settingsPanel={
              <ImmersiveFxSettingsPanel
                value={visualFx}
                onPatch={patchVisualFx}
                onReset={resetVisualFx}
                visualMode={visualMode}
                onVisualModeChange={handleVisualModeChange}
                onDraggingChange={setVisualFxDragging}
                coverUrl={room.current ? getCoverUrl(room.current, 'medium') : null}
              />
            }
            player={
              room.current || room.randomLoading ? (
                <MiniPlayer variant="immersive" onExpand={() => setShowPlayer(true)} />
              ) : (
                <div className="mineradio-glass-bar px-4 py-3 text-center text-xs text-white/45">等待播放…</div>
              )
            }
          />
        </Suspense>
      )}

      {immersiveExitPromptOpen ? (
        <Suspense fallback={null}>
          <ImmersiveExitModal
            open={immersiveExitPromptOpen}
            onKeepBackground={handleImmersiveExitKeepBackground}
            onSwitchCoverBg={handleImmersiveExitToCover}
            onCancel={() => setImmersiveExitPromptOpen(false)}
          />
        </Suspense>
      ) : null}

      <Suspense fallback={null}>
        <RoomVisualFxPanel
          open={visualFxOpen && !immersiveMode}
          value={visualFx}
          onPatch={patchVisualFx}
          onReset={resetVisualFx}
          onClose={() => setVisualFxOpen(false)}
          onDraggingChange={setVisualFxDragging}
        />
      </Suspense>

      <AudioEngine />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={closeToast}
        />
      )}

      <Suspense fallback={null}>
      <RoomSettingsModal
        open={settingsOpen}
        isOwner={isOwner}
        canModerate={canModerate}
        fmMode={normalizeFmMode(room?.neteaseFmMode)}
        fmModeBeforeOff={room?.fmModeBeforeOff}
        fmSaving={fmSaving}
        announcementEnabled={Boolean(room?.announcementEnabled)}
        announcementText={room?.announcementText || ''}
        announcementSaving={announcementSaving}
        chatHistoryVisibleOnJoin={Boolean(room?.chatHistoryVisibleOnJoin)}
        chatHistorySaving={chatHistorySaving}
        songRequest={songRequestSettings}
        songRequestSaving={songRequestSaving}
        bannedSongs={room?.bannedSongs ?? []}
        onUnbanSong={handleUnbanSong}
        memberTierCount={Object.keys(room?.memberTiers ?? {}).length}
        users={room?.users ?? []}
        myUserId={mySocketId}
        transferSaving={transferSaving}
        onClose={() => setSettingsOpen(false)}
        onSaveFmMode={handleSaveFmMode}
        onOpenMemberModal={handleOpenMemberModalFromSettings}
        onSaveAnnouncement={handleSaveAnnouncement}
        onSaveChatHistory={handleSaveChatHistory}
        onSaveSongRequest={handleSaveSongRequestSettings}
        onTransferOwner={handleTransferOwner}
      />
      </Suspense>

      <Suspense fallback={null}>
      <RoomMemberModal
        open={memberOpen}
        users={room?.users ?? []}
        creatorId={room?.creatorId ?? undefined}
        adminIds={room?.adminIds ?? []}
        memberTiers={room?.memberTiers ?? {}}
        memberSettings={room?.memberSettings ?? DEFAULT_MEMBER_SETTINGS}
        saving={memberSaving}
        onClose={() => setMemberOpen(false)}
        onSaveSettings={handleSaveMemberSettings}
        onSaveTier={handleAssignMemberTier}
        onRemoveTier={handleRemoveMemberTier}
      />
      </Suspense>

      <RoomQualityModal
        open={qualityOpen}
        value={resolveEffectiveAudioQuality(room?.audioQuality)}
        onClose={() => setQualityOpen(false)}
        onSave={handleSaveUserQuality}
      />

      <RoomAnnouncementPopup
        open={announcementPopupOpen}
        text={room?.announcementText || ''}
        onClose={handleCloseAnnouncementPopup}
      />

      <div
        className={`room-page-chrome relative z-10 flex min-h-0 flex-1 flex-col transition-opacity duration-200 ${
          immersiveMode || visualFxDragging ? 'pointer-events-none opacity-0' : ''
        }`}
      >
      <header className={`relative z-30 flex-shrink-0 border-b px-3 py-2.5 sm:px-4 sm:py-3 safe-top ${ambientGlassClass}`}>

        <div className="max-w-[1680px] mx-auto flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">

          <div className="flex items-center justify-between gap-2 min-w-0">

            {room.current && !pureMode && (
              <div className="relative hidden flex-shrink-0 sm:block">
                <SongCover
                  song={room.current}
                  eager
                  className="h-11 w-11 rounded-xl border border-white/10 bg-surface-raised object-cover shadow-lg shadow-black/30"
                />
                {room.isPlaying && (
                  <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-surface-base bg-netease-red shadow-md shadow-netease-red/30">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                  </span>
                )}
              </div>
            )}

            <div className="min-w-0">

              <div className="flex items-center gap-2">

                <h1 className="text-base sm:text-lg font-semibold truncate">

                  <span className="truncate">{room.name}</span>

                </h1>

                {isCreator && (
                  <>
                    <Tooltip side="bottom" content="修改房间名">
                      <button
                        type="button"
                        onClick={openRenameModal}
                        className="flex-shrink-0 rounded-lg p-1 text-netease-muted hover:bg-white/10 hover:text-white transition-colors"
                        aria-label="修改房间名"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>
                    <Tooltip side="bottom" content={room.isLocked ? '房间已上锁' : '房间上锁'}>
                      <button
                        type="button"
                        onClick={openLockModal}
                        className={`flex-shrink-0 rounded-lg p-1 transition-colors hover:bg-white/10 ${room.isLocked ? 'text-amber-400' : 'text-netease-muted hover:text-white'}`}
                        aria-label={room.isLocked ? '房间已上锁' : '房间上锁'}
                      >
                        {room.isLocked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
                      </button>
                    </Tooltip>
                  </>
                )}

                {!isCreator && (room.isLocked || room.hasPassword) && (
                  <Tooltip side="bottom" content={room.hasPassword ? '密码房' : '已上锁'}>
                    <span className="flex-shrink-0 text-amber-400/90">
                      <Lock className="w-3.5 h-3.5" />
                    </span>
                  </Tooltip>
                )}

                {isOwner && <RoleBadge role="owner" />}

                {(isAdmin || canControlPlayback) && !isOwner && <RoleBadge role="admin" />}

                {canOpenRoomSettings && (
                  <Tooltip side="bottom" content="房间设置">
                    <button
                      type="button"
                      onClick={() => setSettingsOpen(true)}
                      className="flex-shrink-0 rounded-lg p-1 text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
                      aria-label="房间设置"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                )}

              </div>

              <p className="text-xs text-netease-muted mt-0.5">
                房间号 <span className="text-netease-red">{room.id}</span>
                {pureMode && (
                  <span className="ml-2 text-[10px] text-white/35">Esc 隐藏/显示播放器</span>
                )}
              </p>

              {!pureMode && (
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="inline-flex h-5 items-center whitespace-nowrap text-[10px] leading-none text-netease-muted">
                  {room.userCount} 人在线
                </span>
                <RoomQualityBadge onClick={() => setQualityOpen(true)} />
                <RoomFmModeBadge fmMode={room.neteaseFmMode} />
                {room.songRequestEnabled === false && (
                  <span className="inline-flex h-5 items-center text-[10px] leading-none text-amber-400/90 bg-amber-400/10 px-1.5 rounded-full">禁止点歌</span>
                )}
                {(room.songRequestMinStaySec ?? 0) > 0 && (
                  <span className="inline-flex h-5 items-center text-[10px] leading-none text-white/45 bg-white/5 px-1.5 rounded-full">
                    进房 {Math.ceil((room.songRequestMinStaySec ?? 0) / 60)} 分钟后可点歌
                  </span>
                )}
                {(room.songRequestMaxPerUser ?? 0) > 0 && (
                  <span className="inline-flex h-5 items-center text-[10px] leading-none text-white/45 bg-white/5 px-1.5 rounded-full">
                    每人最多 {room.songRequestMaxPerUser} 首待播
                  </span>
                )}
                {(room.songRequestCooldownSec ?? 0) > 0 && (
                  <span className="inline-flex h-5 items-center text-[10px] leading-none text-white/45 bg-white/5 px-1.5 rounded-full">
                    点歌冷却 {room.songRequestCooldownSec} 秒
                  </span>
                )}
                {(room.queueMaxLength ?? 200) < 200 && (
                  <span className="inline-flex h-5 items-center text-[10px] leading-none text-white/45 bg-white/5 px-1.5 rounded-full">
                    队列上限 {room.queueMaxLength} 首
                  </span>
                )}
                {room.announcementEnabled && room.announcementText?.trim() && (
                  <button
                    type="button"
                    onClick={() => setAnnouncementPopupOpen(true)}
                    className="inline-flex h-5 items-center text-[10px] leading-none text-amber-400/90 bg-amber-400/10 px-1.5 rounded-full hover:bg-amber-400/15"
                  >
                    查看公告
                  </button>
                )}
              </div>
              )}

            </div>

            {!pureMode && room && !isSmUp && (
            <div className="flex-shrink-0">
              <OnlineUsers
                users={room.users}
                creatorId={room.creatorId}
                memberTiers={room.memberTiers}
                onNotice={showToast}
              />
            </div>
            )}

          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3">

            <div className="flex items-center gap-1 sm:gap-2">

              {isMobileDevice() && (
                <Tooltip side="bottom" content="下载客户端">
                  <button
                    type="button"
                    onClick={() => setDownloadModalOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-netease-muted transition-colors hover:bg-netease-card hover:text-white"
                    aria-label="下载客户端"
                  >
                    <Smartphone className="h-4 w-4" />
                  </button>
                </Tooltip>
              )}

              <Tooltip side="bottom" content={pureMode ? '退出纯净模式（电脑端右侧滑入聊天）' : '纯净模式：隐藏动效与热榜，保留搜索与播放队列；标签页低调伪装'}>
                <button
                  type="button"
                  onClick={handlePureModeToggle}
                  className={`flex items-center gap-1.5 text-xs transition-colors px-2.5 sm:px-3 py-1.5 rounded-lg hover:bg-netease-card ${
                    pureMode ? 'text-sky-400' : 'text-netease-muted hover:text-white'
                  }`}
                  aria-label={pureMode ? '退出纯净模式' : '开启纯净模式'}
                  aria-pressed={pureMode}
                >
                  <Shield className="w-4 h-4" />
                  <span className="hidden sm:inline">{pureMode ? '纯净中' : '纯净模式'}</span>
                </button>
              </Tooltip>

              {showImmersiveEntry ? (
                <Tooltip side="bottom" content={immersiveMode ? '退出沉浸模式' : '沉浸模式：全屏视觉，边缘滑出点歌/队列/聊天'}>
                  <button
                    type="button"
                    onClick={handleImmersiveToggle}
                    disabled={Boolean(immersiveTransition)}
                    className={`flex items-center gap-1.5 text-xs transition-colors px-2.5 sm:px-3 py-1.5 rounded-lg hover:bg-netease-card disabled:opacity-50 disabled:pointer-events-none ${
                      immersiveMode ? 'text-violet-300' : 'text-netease-muted hover:text-white'
                    }`}
                    aria-label={immersiveMode ? '退出沉浸模式' : '进入沉浸模式'}
                    aria-pressed={immersiveMode}
                  >
                    <Maximize2 className="h-4 w-4" />
                    <span className="hidden sm:inline">{immersiveMode ? '沉浸中' : '沉浸模式'}</span>
                  </button>
                </Tooltip>
              ) : null}

              <Tooltip side="bottom" content="分享房间">
                <button
                  onClick={handleCopyRoom}
                  className="flex items-center gap-1.5 text-xs text-netease-muted hover:text-white transition-colors px-2.5 sm:px-3 py-1.5 rounded-lg hover:bg-netease-card"
                >
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  <span className="hidden sm:inline">{copied ? '已复制' : '分享房间'}</span>
                </button>
              </Tooltip>

              <Tooltip side="bottom" content="退出房间">
                <button
                  onClick={() => {
                    leaveRoom();
                    navigate('/');
                  }}
                  className="flex items-center gap-1.5 text-xs text-netease-muted hover:text-white transition-colors px-2.5 sm:px-3 py-1.5 rounded-lg hover:bg-netease-card"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="hidden sm:inline">退出房间</span>
                </button>
              </Tooltip>

            </div>

            {!pureMode && room && isSmUp && (
              <OnlineUsers
                users={room.users}
                creatorId={room.creatorId}
                memberTiers={room.memberTiers}
                onNotice={showToast}
              />
            )}

          </div>

        </div>

      </header>

      {isReconnecting && (
        <div className="relative z-20 flex flex-shrink-0 items-center justify-center gap-2 border-b border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-200">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>连接已断开，正在自动重新加入房间…</span>
        </div>
      )}

      <div className={`relative z-10 flex-1 min-h-0 mx-auto w-full px-3 sm:px-4 pt-3 sm:pt-4 pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))] overflow-y-auto lg:overflow-hidden ${pureMode ? 'max-w-3xl' : 'max-w-[1680px]'}`}>

        <div className={`flex flex-col gap-3 lg:gap-4 lg:h-full lg:min-h-0 ${pureMode ? '' : 'lg:grid lg:grid-cols-[320px_minmax(0,1fr)_340px]'}`}>

          {/* 左侧：网易云热榜 */}
          {isLgUp && !pureMode && (
            <div className="surface-panel order-0 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl lg:h-full">
              <HotSongPanel embedded addingId={addingId} onAdd={handleAdd} />
            </div>
          )}

          {/* 中间：搜索 + 播放队列 */}
          <div className="order-1 flex min-h-0 min-w-0 flex-col lg:h-full lg:overflow-hidden">
            {!isLgUp && !pureMode && (
              <div className="mb-3">
                <HotSongPanel compact addingId={addingId} onAdd={handleAdd} />
              </div>
            )}

            <div className="flex-shrink-0">
              <JumpRequestBanner />
              {searchBar}
              <div className="mb-2 flex items-center justify-between gap-2 overflow-x-auto px-1 sm:mb-4">
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSongHistoryOpen(true)}
                    className="rounded-lg px-2 py-1 text-[11px] sm:text-xs text-white/75 hover:bg-white/10 hover:text-white transition-colors whitespace-nowrap"
                  >
                    播放历史
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecommendDrawerOpen(true)}
                    className="hidden lg:inline-flex rounded-lg px-2 py-1 text-[11px] sm:text-xs text-white/75 hover:bg-white/10 hover:text-white transition-colors whitespace-nowrap"
                  >
                    热榜歌单
                  </button>
                </div>
                {searchableCount > 0 && (
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={openFavorites}
                      className="rounded-lg px-2 py-1 text-[11px] sm:text-xs text-white/75 hover:bg-white/10 hover:text-white transition-colors whitespace-nowrap"
                    >
                      我的收藏
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlaylistImportOpen(true)}
                      className="rounded-lg px-2 py-1 text-[11px] sm:text-xs text-white/75 hover:bg-white/10 hover:text-white transition-colors whitespace-nowrap"
                    >
                      导入歌单
                    </button>
                  </div>
                )}
              </div>
            </div>

            {isLgUp && (
            <div className="flex-1 min-h-0 flex-col mt-1 flex">
              {renderQueueSection(true)}
            </div>
            )}

            {pureMode && !isLgUp && (
              <div className="mt-3 flex-shrink-0">
                {renderQueueSection()}
              </div>
            )}
          </div>

          {/* 右侧：聊天室（纯净模式桌面走滑入抽屉，手机内联展示） */}
          {(!pureMode || !isLgUp) && (
          <div className="order-2 flex min-h-0 min-w-0 flex-col gap-3 lg:h-full lg:min-h-0">
            {!pureMode && !isLgUp && (
            <div>
              {renderQueueSection()}
            </div>
            )}

            <div className="h-[min(55vh,480px)] sm:h-[min(60vh,520px)] lg:h-full lg:min-h-0 lg:flex-1">
              <ChatPanel />
            </div>
          </div>
          )}

        </div>

      </div>

      {/* 搜索结果弹层（移动端底部抽屉 / 桌面居中弹窗） */}
      {showDesktopSearchOverlay && !immersiveMode && (
        <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-start px-0 lg:px-4 pt-0 lg:pt-24 pb-0 lg:pb-8">
          <button
            type="button"
            className="absolute inset-0 z-0 bg-black/65 backdrop-blur-sm"
            onClick={clearSearchResults}
            aria-label="关闭搜索结果"
          />
          <div
            className="relative z-10 w-full max-w-2xl max-h-[min(85vh,680px)] lg:max-h-[min(72vh,680px)] flex flex-col glass rounded-t-2xl lg:rounded-2xl border border-white/10 border-b-0 lg:border-b shadow-2xl animate-fade-in overflow-hidden pointer-events-auto pb-[env(safe-area-inset-bottom,0px)]"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-netease-border/50 flex-shrink-0">
              <div className="min-w-0 flex items-center gap-2">
                {isPlaylistResults && playlistSearchBackup && (
                  <button
                    type="button"
                    onClick={handleBackToPlaylistSearch}
                    className="flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-netease-muted hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    返回歌单
                  </button>
                )}
                <div className="min-w-0">
                  <h2 className="text-sm font-medium text-white">{isPlaylistResults ? '歌单详情' : '搜索结果'}</h2>
                  <p className="text-xs text-netease-muted mt-0.5 truncate">
                    {renderResultsSummary()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                {showPlaylistSearch && (
                  <PlaylistChannelFilter value={playlistChannelFilter} onChange={handlePlaylistChannelChange} />
                )}
                {!searching && searchableCount > 0 && !isPlaylistResults && (
                  activeSearchMode === 'song' && <SearchFilterSelect value={searchFilterMode} onChange={handleSearchFilterChange} />
                )}
                {showSongListResults && renderBulkAddPageButton('px-2.5 py-1.5')}
                <button
                  type="button"
                  onClick={clearSearchResults}
                  className="flex-shrink-0 rounded-lg p-1.5 text-netease-muted hover:bg-white/10 hover:text-white transition-colors"
                  aria-label="关闭"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-shrink-0 px-3 pt-3">
              {overlaySearchBar}
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 pt-2">
              {searching && searchedKeyword && !showPlaylistSearch && <SearchSkeleton fillHeight />}
              {showPlaylistSkeleton && (
                <SearchSkeleton fillHeight count={playlistSearchPageSize} showPaginationFooter={false} />
              )}
              {!searching && !playlistSearchLoading && searchedKeyword && !hasPlaylistSearchResults && results.length === 0 && (
                <p className="text-center text-netease-muted py-10 animate-fade-in">
                  {showPlaylistEmpty ? '没有找到相关歌单' : (isPlaylistResults ? '歌单为空或链接无效' : '换个关键词试试')}
                </p>
              )}
              {hasPlaylistSearchResults && renderPlaylistSearchList(true)}
              {!searching && searchedKeyword && (
                !showPlaylistSearch && (
                <SongResultList
                  results={results}
                  addingId={addingId}
                  onAdd={handleAdd}
                  keyword={searchedKeyword}
                  alwaysShowActions
                  fillHeight
                  onPageResultsChange={handleListPageResultsChange}
                />
                )
              )}
            </div>
          </div>
        </div>
      )}

      {playlistImportOpen &&
        createPortal(
          <Suspense fallback={null}>
            <PlaylistImportModal
              open={playlistImportOpen}
              loading={searching}
              qqImportEnabled={qqImportEnabled}
              immersive={immersiveMode}
              onClose={() => setPlaylistImportOpen(false)}
              onImport={handlePlaylistImport}
            />
          </Suspense>,
          document.body,
        )}

      {songHistoryOpen &&
        createPortal(
          <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-24 pb-8">
            <button
              type="button"
              className={`absolute inset-0 ${immersiveMode ? immersiveGlassScrim : 'bg-black/65 backdrop-blur-sm'}`}
              onClick={() => setSongHistoryOpen(false)}
              aria-label="关闭播放历史"
            />
            <div
              className={`relative z-10 flex max-h-[min(72vh,680px)] w-full max-w-2xl flex-col overflow-hidden rounded-[22px] shadow-2xl ${
                immersiveMode ? immersiveGlassModal : 'rounded-2xl border border-white/10 glass'
              }`}
            >
              <div
                className={`flex items-center justify-between px-4 py-3 ${
                  immersiveMode ? immersiveGlassSheetHeader : 'border-b border-netease-border/50'
                }`}
              >
                <div>
                  <h2 className="text-sm font-medium text-white">播放历史</h2>
                  <p className="mt-0.5 text-xs text-netease-muted">最近 {songHistoryItems.length} 首，可复播或收藏</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSongHistoryOpen(false)}
                  className="rounded-lg p-1.5 text-netease-muted hover:bg-white/10 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {songHistoryLoading ? (
                  <div className="py-16 text-center text-sm text-netease-muted">
                    <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin opacity-40" />
                    加载播放历史…
                  </div>
                ) : !songHistoryItems.length ? (
                  <div className="py-16 text-center text-sm text-netease-muted">
                    <History className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    暂无播放历史
                  </div>
                ) : (
                  <div className="space-y-2">
                  {songHistoryItems.map((song: SongHistoryItem, index: number) => {
                    const key = songKey(song);
                    return (
                      <div
                        key={`${song.requestedAt}-${key}-${index}`}
                        className={`group flex items-center gap-2 rounded-xl p-2.5 transition-colors sm:gap-3 sm:p-3 ${
                          immersiveMode ? immersiveGlassListRow : 'hover:bg-netease-card/80'
                        }`}
                      >
                        <SongCover song={song} className="h-12 w-12 flex-shrink-0 rounded-lg bg-netease-card object-cover" />
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <p className="truncate text-sm font-medium">{song.name}</p>
                            <SourceBadge source={song.source} variant="muted" />
                          </div>
                          <p className="truncate text-xs text-netease-muted">{song.artist}{song.album ? ` · ${song.album}` : ''}</p>
                          <p className="truncate text-[11px] text-netease-muted/80">{song.requestedBy || '匿名'} 播放{formatHistoryTime(song.requestedAt) ? ` · ${formatHistoryTime(song.requestedAt)}` : ''}</p>
                        </div>
                        <FavoriteButton song={song} className="h-8 w-8 text-netease-muted hover:text-rose-300" />
                        <button
                          type="button"
                          onClick={() => void handleAdd(song as SearchResult)}
                          disabled={addingId === key}
                          className="flex flex-shrink-0 items-center gap-1 rounded-full bg-netease-red/10 px-2.5 py-1 text-xs font-medium text-netease-red transition-all hover:bg-netease-red hover:text-white disabled:opacity-50"
                        >
                          {addingId === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                          复播
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
          document.body,
        )}

      {favoritesOpen &&
        createPortal(
          <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-24 pb-8">
          <button
            type="button"
            className={`absolute inset-0 ${immersiveMode ? immersiveGlassScrim : 'bg-black/65 backdrop-blur-sm'}`}
            onClick={() => setFavoritesOpen(false)}
            aria-label="关闭收藏"
          />
          <div
            className={`relative z-10 flex max-h-[min(72vh,680px)] w-full max-w-2xl flex-col overflow-hidden rounded-[22px] shadow-2xl ${
              immersiveMode ? immersiveGlassModal : 'rounded-2xl border border-white/10 glass'
            }`}
          >
            <div
              className={`flex items-center justify-between px-4 py-3 ${
                immersiveMode ? immersiveGlassSheetHeader : 'border-b border-netease-border/50'
              }`}
            >
              <div>
                <h2 className="text-sm font-medium text-white">我的收藏</h2>
                <p className="mt-0.5 text-xs text-netease-muted">
                  共 {favorites.length} 首{favoriteQuery.trim() ? `，筛选 ${filteredFavorites.length} 首` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Tooltip content="当前页点歌">
                  <button
                    type="button"
                    onClick={() => void handleAddPageFavorites()}
                    disabled={pagedFavorites.length === 0 || addingAllFavorites || importingFavorites}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-netease-red hover:bg-netease-red/10 hover:text-netease-red disabled:opacity-50"
                  >
                    {addingAllFavorites ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />}
                    一键点歌
                  </button>
                </Tooltip>
                <Tooltip content="导入歌单">
                  <button
                    type="button"
                    onClick={handleImportFavoritesJson}
                    disabled={importingFavorites}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-netease-muted hover:bg-white/10 hover:text-white disabled:opacity-50"
                  >
                    {importingFavorites ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {favoritesImportProgress || '导入歌单'}
                  </button>
                </Tooltip>
                <Tooltip content="导出歌单">
                  <button
                    type="button"
                    onClick={handleExportFavoritesJson}
                    disabled={favorites.length === 0 || importingFavorites}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-netease-muted hover:bg-white/10 hover:text-white disabled:opacity-50"
                  >
                    <Upload className="h-4 w-4" />
                    导出歌单
                  </button>
                </Tooltip>
                <button type="button" onClick={() => setFavoritesOpen(false)} className="rounded-lg p-1.5 text-netease-muted hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className="flex-shrink-0 border-b border-netease-border/50 px-4 py-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-netease-muted" />
                <input
                  type="text"
                  value={favoriteQuery}
                  onChange={(event) => setFavoriteQuery(event.target.value)}
                  placeholder="搜索收藏歌名、歌手..."
                  className="w-full rounded-xl border border-netease-border bg-netease-dark py-2 pl-9 pr-3 text-sm text-white placeholder:text-netease-muted/50 focus:border-netease-red/50 focus:outline-none"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {favoritesLoading ? (
                <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-netease-red" /></div>
              ) : filteredFavorites.length === 0 ? (
                <div className="py-16 text-center text-sm text-netease-muted">
                  <Heart className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  {favorites.length === 0 ? '暂无收藏歌曲' : '没有匹配的收藏歌曲'}
                </div>
              ) : (
                <div className="space-y-2">
                  {pagedFavorites.map((song) => {
                    const key = songKey(song);
                    return (
                      <div
                        key={key}
                        className={`group flex items-center gap-2 rounded-xl p-2.5 transition-colors sm:gap-3 sm:p-3 ${
                          immersiveMode ? immersiveGlassListRow : 'hover:bg-netease-card/80'
                        }`}
                      >
                        <Tooltip content="取消收藏">
                          <button
                            type="button"
                            onClick={() => void removeFavorite(song)}
                            disabled={removingFavoriteId === key}
                            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-50"
                            aria-label="取消收藏"
                          >
                          {removingFavoriteId === key ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <span className="text-base leading-none">❤</span>
                          )}
                          </button>
                        </Tooltip>
                        <SongCover song={song} className="h-12 w-12 flex-shrink-0 rounded-lg bg-netease-card object-cover" />
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="truncate text-sm font-medium">{song.name}</p>
                          <p className="truncate text-xs text-netease-muted">{song.artist}{song.album ? ` · ${song.album}` : ''}</p>
                        </div>
                        <SourceBadge source={song.source} variant="muted" />
                        <button
                          type="button"
                          onClick={() => void handleAdd(song as SearchResult)}
                          disabled={addingId === key}
                          className="flex flex-shrink-0 items-center gap-1 rounded-full bg-netease-red/10 px-2.5 py-1 text-xs font-medium text-netease-red transition-all hover:bg-netease-red hover:text-white disabled:opacity-50"
                        >
                          {addingId === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                          点歌
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {!favoritesLoading && filteredFavorites.length > 0 && (
              <div
                className={`flex-shrink-0 space-y-2 px-4 py-3 ${
                  immersiveMode ? immersiveGlassListFooter : 'border-t border-netease-border/40 bg-netease-bg/90'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <PageSizeSelect
                    value={favoritePageSize}
                    options={FAVORITES_PAGE_SIZE_OPTIONS}
                    onChange={setFavoritePageSize}
                  />
                  <span className="text-xs text-netease-muted">
                    第 {favoritePage} / {favoriteTotalPages} 页
                    <span className="ml-1 text-netease-muted/50">共 {filteredFavorites.length} 首</span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={favoritePage <= 1}
                    onClick={() => setFavoritePage((page) => Math.max(1, page - 1))}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-netease-muted transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    上一页
                  </button>
                  <button
                    type="button"
                    disabled={favoritePage >= favoriteTotalPages}
                    onClick={() => setFavoritePage((page) => Math.min(favoriteTotalPages, page + 1))}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-netease-muted transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    下一页
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
          document.body,
        )}

      {(room.current || room.randomLoading) && !(pureMode && purePlayerHidden) && !immersiveMode && (
        <MiniPlayer onExpand={() => setShowPlayer(true)} barClassName={ambientGlassClass} />
      )}

      {pureMode && isLgUp && <PureModeChatDock />}
      </div>

      {recommendDrawerOpen &&
        createPortal(
          <Suspense fallback={null}>
            <RecommendedPlaylistsDrawer
              open={recommendDrawerOpen}
              immersive={immersiveMode}
              onClose={() => setRecommendDrawerOpen(false)}
              onSelectPlaylist={handleRecommendPlaylistSelect}
            />
          </Suspense>,
          document.body,
        )}

      {downloadModalOpen &&
        createPortal(
          <Suspense fallback={null}>
            <ClientDownloadModal open={downloadModalOpen} onClose={() => setDownloadModalOpen(false)} />
          </Suspense>,
          document.body,
        )}

      {showPlayer && room.current && (
        <Suspense fallback={null}>
          <PlayerPage onClose={() => setShowPlayer(false)} />
        </Suspense>
      )}

      {renameOpen && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setRenameOpen(false)} aria-label="关闭" />
          <div className="relative w-full max-w-sm glass rounded-2xl border border-white/10 shadow-2xl p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">修改房间名</h2>
              <button type="button" onClick={() => setRenameOpen(false)} className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            <input
              type="text"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              maxLength={30}
              placeholder="房间名称"
              className="w-full bg-netease-dark border border-netease-border rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-netease-muted/50 focus:outline-none focus:border-netease-red/50 mb-5"
              onKeyDown={(e) => e.key === 'Enter' && void handleRenameRoom()}
            />
            <button
              type="button"
              onClick={() => void handleRenameRoom()}
              disabled={renameSaving || !renameDraft.trim()}
              className="w-full flex items-center justify-center gap-2 bg-netease-red hover:bg-red-500 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors"
            >
              {renameSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              保存
            </button>
          </div>
        </div>,
        document.body,
      )}

      {lockOpen && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setLockOpen(false)} aria-label="关闭" />
          <div className="relative w-full max-w-sm glass rounded-2xl border border-white/10 shadow-2xl p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">房间上锁</h2>
              <button type="button" onClick={() => setLockOpen(false)} className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            {room.isLocked ? (
              <div className="space-y-4">
                <p className="text-sm text-white/70">
                  房间当前已上锁{room.hasPassword ? '（他人需密码，创建者免密）' : '（他人无法进入，创建者免密）'}。
                </p>
                <button
                  type="button"
                  onClick={() => void handleUnlockRoom()}
                  disabled={lockSaving}
                  className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-medium py-3 rounded-xl transition-colors"
                >
                  {lockSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <LockOpen className="w-5 h-5" />}
                  解锁房间
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-white/70">上锁后其他人需密码（或无法进入）。你作为创建者始终可免密进入。</p>
                <label className="block text-xs text-white/50 mb-1.5">进入密码（可选）</label>
                <input
                  type="password"
                  value={lockPassword}
                  onChange={(e) => setLockPassword(e.target.value)}
                  maxLength={32}
                  placeholder="留空则仅创建者可进入"
                  className="w-full bg-netease-dark border border-netease-border rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-netease-muted/50 focus:outline-none focus:border-netease-red/50"
                />
                <button
                  type="button"
                  onClick={() => void handleLockRoom()}
                  disabled={lockSaving}
                  className="w-full flex items-center justify-center gap-2 bg-netease-red hover:bg-red-500 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors"
                >
                  {lockSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
                  确认上锁
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

    </div>
    </Suspense>
  );

}
