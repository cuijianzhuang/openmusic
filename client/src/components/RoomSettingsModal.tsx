import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Crown, Minus, Plus, Sparkles, X } from 'lucide-react';
import { NETEASE_FM_MODE_OPTIONS, getFmModeLabel, normalizeFmMode, FM_MODE_OFF, DEFAULT_FM_MODE } from '../api/music/fmMode';
import type { BannedSong, RoomUser } from '../types';
import type { DislikeSkipMode } from '../lib/dislikeSkip';
import SourceBadge from './SourceBadge';
import ConfirmModal from './ConfirmModal';
import {
  fetchLinuxdoStatus,
  startLinuxdoBind,
  startLinuxdoRecover,
  unbindLinuxdo,
  type LinuxdoBinding,
} from '../lib/linuxdoAuth';
import {
  fetchGithubStatus,
  startGithubBind,
  startGithubRecover,
  unbindGithub,
  type GithubBinding,
} from '../lib/githubAuth';

const ANNOUNCEMENT_MAX_LENGTH = 2000;
const MIN_STAY_MINUTES_MAX = 24 * 60;
const MAX_PER_USER_MAX = 50;
const DISLIKE_SKIP_THRESHOLD_MAX = 50;
const CLEAR_ON_LEAVE_DELAY_MINUTES_MAX = 24 * 60;
const JOIN_NOTICE_COOLDOWN_MINUTES_MAX = 24 * 60;
const COOLDOWN_OPTIONS = [0, 10, 30, 60, 120] as const;
const QUEUE_LIMIT_OPTIONS = [50, 100, 200] as const;

type SettingsTab = 'fm' | 'member' | 'transfer' | 'identity' | 'announcement' | 'chat' | 'songRequest';

export interface SongRequestSettings {
  enabled: boolean;
  memberJumpEnabled: boolean;
  memberSeekEnabled: boolean;
  memberPauseEnabled: boolean;
  systemMediaPlayBound: boolean;
  systemMediaSkipBound: boolean;
  dislikeSkipMode: DislikeSkipMode;
  dislikeSkipThreshold: number;
  dislikeSkipPercent: number;
  clearSongsOnLeaveEnabled: boolean;
  clearSongsOnLeaveDelayMinutes: number;
  minStayMinutes: number;
  maxPerUser: number;
  cooldownSec: number;
  queueMaxLength: number;
}

function songRequestEqual(a: SongRequestSettings, b: SongRequestSettings) {
  return a.enabled === b.enabled
    && a.memberJumpEnabled === b.memberJumpEnabled
    && a.memberSeekEnabled === b.memberSeekEnabled
    && a.memberPauseEnabled === b.memberPauseEnabled
    && a.systemMediaPlayBound === b.systemMediaPlayBound
    && a.systemMediaSkipBound === b.systemMediaSkipBound
    && a.dislikeSkipMode === b.dislikeSkipMode
    && a.dislikeSkipThreshold === b.dislikeSkipThreshold
    && a.dislikeSkipPercent === b.dislikeSkipPercent
    && a.clearSongsOnLeaveEnabled === b.clearSongsOnLeaveEnabled
    && a.clearSongsOnLeaveDelayMinutes === b.clearSongsOnLeaveDelayMinutes
    && a.minStayMinutes === b.minStayMinutes
    && a.maxPerUser === b.maxPerUser
    && a.cooldownSec === b.cooldownSec
    && a.queueMaxLength === b.queueMaxLength;
}

interface Props {
  open: boolean;
  isOwner: boolean;
  canModerate: boolean;
  fmMode: string;
  fmModeBeforeOff?: string;
  fmSaving?: boolean;
  announcementEnabled: boolean;
  announcementText: string;
  announcementSaving?: boolean;
  chatHistoryVisibleOnJoin: boolean;
  chatHistorySaving?: boolean;
  joinNoticeEnabled: boolean;
  joinNoticeCooldownMinutes: number;
  joinNoticeSaving?: boolean;
  songRequest: SongRequestSettings;
  songRequestSaving?: boolean;
  bannedSongs?: BannedSong[];
  onUnbanSong?: (name: string) => void | Promise<void>;
  memberTierCount: number;
  users?: RoomUser[];
  myUserId?: string | null;
  transferSaving?: boolean;
  roomId?: string;
  onClose: () => void;
  onSaveFmMode: (mode: string) => void;
  onOpenMemberModal: () => void;
  onSaveAnnouncement: (options: { enabled: boolean; text: string }) => void;
  onSaveChatHistory: (enabled: boolean) => void;
  onSaveJoinNotice: (settings: { enabled: boolean; cooldownMinutes: number }) => void;
  onSaveSongRequest: (settings: SongRequestSettings) => void;
  onTransferOwner?: (userId: string) => void | Promise<void>;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="mt-0.5 text-xs text-netease-muted">{description}</p>}
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
    </label>
  );
}

function NumberStepper({
  id,
  value,
  min,
  max,
  disabled,
  suffix,
  onChange,
}: {
  id?: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  suffix?: string;
  onChange: (next: number) => void;
}) {
  const setValue = (next: number) => onChange(clampInt(next, min, max));

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="inline-flex items-stretch overflow-hidden rounded-lg border border-netease-border/60 bg-netease-dark">
        <button
          type="button"
          disabled={disabled || value <= min}
          onClick={() => setValue(value - 1)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-netease-muted transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="减少"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '');
            if (!digits) {
              setValue(min);
              return;
            }
            setValue(Number(digits));
          }}
          className="h-8 w-14 flex-shrink-0 border-x border-netease-border/60 bg-transparent text-center text-sm tabular-nums text-white outline-none disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          disabled={disabled || value >= max}
          onClick={() => setValue(value + 1)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-netease-muted transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="增加"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {suffix && <span className="text-sm text-netease-muted">{suffix}</span>}
    </div>
  );
}

export default function RoomSettingsModal({
  open,
  isOwner,
  canModerate,
  fmMode,
  fmModeBeforeOff,
  fmSaving = false,
  announcementEnabled,
  announcementText,
  announcementSaving = false,
  chatHistoryVisibleOnJoin,
  chatHistorySaving = false,
  joinNoticeEnabled,
  joinNoticeCooldownMinutes,
  joinNoticeSaving = false,
  songRequest,
  songRequestSaving = false,
  bannedSongs = [],
  onUnbanSong,
  memberTierCount,
  users = [],
  myUserId = null,
  transferSaving = false,
  roomId,
  onClose,
  onSaveFmMode,
  onOpenMemberModal,
  onSaveAnnouncement,
  onSaveChatHistory,
  onSaveJoinNotice,
  onSaveSongRequest,
  onTransferOwner,
}: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('announcement');
  const [draftAnnouncementEnabled, setDraftAnnouncementEnabled] = useState(announcementEnabled);
  const [draftAnnouncementText, setDraftAnnouncementText] = useState(announcementText);
  const [draftJoinNoticeEnabled, setDraftJoinNoticeEnabled] = useState(joinNoticeEnabled);
  const [draftJoinNoticeCooldownMinutes, setDraftJoinNoticeCooldownMinutes] = useState(joinNoticeCooldownMinutes);
  const [draftSongRequest, setDraftSongRequest] = useState(songRequest);
  const [transferTargetId, setTransferTargetId] = useState<string | null>(null);
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [linuxdoEnabled, setLinuxdoEnabled] = useState(false);
  const [linuxdoBound, setLinuxdoBound] = useState<LinuxdoBinding | null>(null);
  const [linuxdoUnbinding, setLinuxdoUnbinding] = useState(false);
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [githubBound, setGithubBound] = useState<GithubBinding | null>(null);
  const [githubUnbinding, setGithubUnbinding] = useState(false);
  const wasOpenRef = useRef(false);
  const appliedAnnouncementRef = useRef({ enabled: announcementEnabled, text: announcementText });
  const appliedSongRequestRef = useRef(songRequest);

  const transferCandidates = useMemo(
    () => users.filter((user) => !user.readOnly && user.id !== myUserId),
    [users, myUserId],
  );

  const selectedTransferUser = useMemo(
    () => transferCandidates.find((user) => user.id === transferTargetId) || null,
    [transferCandidates, transferTargetId],
  );

  const tabs = useMemo(() => {
    const items: { id: SettingsTab; label: string }[] = [];
    if (isOwner) {
      items.push({ id: 'fm', label: '漫游' });
      items.push({ id: 'member', label: '贵宾' });
      items.push({ id: 'transfer', label: '转让' });
    }
    if (canModerate) {
      items.push({ id: 'announcement', label: '公告' });
      items.push({ id: 'chat', label: '聊天' });
      items.push({ id: 'songRequest', label: '点歌' });
    }
    if (linuxdoEnabled || githubEnabled) {
      items.push({ id: 'identity', label: '身份' });
    }
    return items;
  }, [isOwner, canModerate, linuxdoEnabled, githubEnabled]);

  // 仅在弹框从关闭→打开时初始化 tab/草稿，避免 room_update 反复把 tab 打回「漫游」
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;

    setDraftAnnouncementEnabled(announcementEnabled);
    setDraftAnnouncementText(announcementText);
    setDraftJoinNoticeEnabled(joinNoticeEnabled);
    setDraftJoinNoticeCooldownMinutes(joinNoticeCooldownMinutes);
    setDraftSongRequest(songRequest);
    appliedAnnouncementRef.current = { enabled: announcementEnabled, text: announcementText };
    appliedSongRequestRef.current = songRequest;
    setTransferTargetId(null);
    setConfirmTransfer(false);
    setActiveTab(tabs[0]?.id ?? 'announcement');
  }, [
    open,
    announcementEnabled,
    announcementText,
    joinNoticeEnabled,
    joinNoticeCooldownMinutes,
    songRequest,
    tabs,
  ]);

  useEffect(() => {
    if (!open) {
      setConfirmTransfer(false);
      return;
    }
    if (transferTargetId && !transferCandidates.some((user) => user.id === transferTargetId)) {
      setTransferTargetId(null);
      setConfirmTransfer(false);
    }
  }, [open, transferCandidates, transferTargetId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchLinuxdoStatus().then((status) => {
      if (cancelled) return;
      setLinuxdoEnabled(status.enabled);
      setLinuxdoBound(status.bound);
    });
    void fetchGithubStatus().then((status) => {
      if (cancelled) return;
      setGithubEnabled(status.enabled);
      setGithubBound(status.bound);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 打开期间：服务端公告变化时，若用户未编辑（草稿仍等于上次应用值），则跟随服务端
  useEffect(() => {
    if (!open) return;
    const applied = appliedAnnouncementRef.current;
    const serverChanged = applied.enabled !== announcementEnabled
      || applied.text !== announcementText;
    if (!serverChanged) return;

    setDraftAnnouncementEnabled((prev) => {
      if (prev !== applied.enabled) return prev; // 用户已改开关
      return announcementEnabled;
    });
    setDraftAnnouncementText((prev) => {
      if (prev !== applied.text) return prev; // 用户已改文案
      return announcementText;
    });
    appliedAnnouncementRef.current = { enabled: announcementEnabled, text: announcementText };
  }, [open, announcementEnabled, announcementText]);

  useEffect(() => {
    if (!open) return;
    const applied = appliedSongRequestRef.current;
    if (songRequestEqual(applied, songRequest)) return;

    setDraftSongRequest((prev) => {
      if (!songRequestEqual(prev, applied)) return prev; // 用户有未保存修改
      return songRequest;
    });
    appliedSongRequestRef.current = songRequest;
  }, [open, songRequest]);

  // 权限变化导致当前 tab 不可用时，落到第一个可用 tab
  useEffect(() => {
    if (!open || tabs.length === 0) return;
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [open, tabs, activeTab]);

  if (!open) return null;

  const currentFm = normalizeFmMode(fmMode);
  const announcementDirty = draftAnnouncementEnabled !== announcementEnabled
    || draftAnnouncementText.trim() !== announcementText.trim();
  const joinNoticeDirty = draftJoinNoticeEnabled !== joinNoticeEnabled
    || draftJoinNoticeCooldownMinutes !== joinNoticeCooldownMinutes;
  const songRequestDirty = draftSongRequest.enabled !== songRequest.enabled
    || draftSongRequest.memberJumpEnabled !== songRequest.memberJumpEnabled
    || draftSongRequest.memberSeekEnabled !== songRequest.memberSeekEnabled
    || draftSongRequest.memberPauseEnabled !== songRequest.memberPauseEnabled
    || draftSongRequest.systemMediaPlayBound !== songRequest.systemMediaPlayBound
    || draftSongRequest.systemMediaSkipBound !== songRequest.systemMediaSkipBound
    || draftSongRequest.dislikeSkipMode !== songRequest.dislikeSkipMode
    || draftSongRequest.dislikeSkipThreshold !== songRequest.dislikeSkipThreshold
    || draftSongRequest.dislikeSkipPercent !== songRequest.dislikeSkipPercent
    || draftSongRequest.clearSongsOnLeaveEnabled !== songRequest.clearSongsOnLeaveEnabled
    || draftSongRequest.clearSongsOnLeaveDelayMinutes !== songRequest.clearSongsOnLeaveDelayMinutes
    || draftSongRequest.minStayMinutes !== songRequest.minStayMinutes
    || draftSongRequest.maxPerUser !== songRequest.maxPerUser
    || draftSongRequest.cooldownSec !== songRequest.cooldownSec
    || draftSongRequest.queueMaxLength !== songRequest.queueMaxLength;

  const formatCooldownLabel = (sec: number) => {
    if (sec <= 0) return '不限制';
    return `${sec} 秒`;
  };

  return (
    <>
      {createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div
        className="relative flex max-h-[min(88vh,640px)] w-full max-w-lg animate-fade-in flex-col rounded-2xl border border-white/10 bg-netease-dark shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">房间设置</h2>
            <p className="mt-0.5 text-xs text-netease-muted">漫游、贵宾、转让、公告、聊天与点歌规则</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {tabs.length > 1 && (
          <div className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-4 py-2.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-white/10 font-medium text-white'
                    : 'text-netease-muted hover:bg-white/5 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'fm' && isOwner && (
            <section>
              <Toggle
                checked={currentFm !== FM_MODE_OFF}
                disabled={fmSaving}
                onChange={(next) => {
                  const restored = normalizeFmMode(fmModeBeforeOff);
                  onSaveFmMode(next ? (restored === FM_MODE_OFF ? DEFAULT_FM_MODE : restored) : FM_MODE_OFF);
                }}
                label="自动漫游"
                description="队列为空时通过私人漫游自动推荐下一首"
              />
              <div className={`mt-3 space-y-1.5 ${currentFm === FM_MODE_OFF ? 'opacity-40' : ''}`}>
                {NETEASE_FM_MODE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={fmSaving || currentFm === FM_MODE_OFF}
                    onClick={() => onSaveFmMode(opt.value)}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                      currentFm === opt.value
                        ? 'border-netease-red/25 bg-netease-red/[0.08]'
                        : 'border-transparent bg-white/[0.03] hover:bg-white/[0.06]'
                    }`}
                  >
                    <p className={`text-sm font-medium ${currentFm === opt.value ? 'text-white' : 'text-white/90'}`}>
                      {opt.label}
                      {currentFm === opt.value && (
                        <span className="ml-2 text-[10px] font-normal text-netease-red">当前</span>
                      )}
                    </p>
                    {opt.description && (
                      <p className="mt-0.5 text-xs text-netease-muted">{opt.description}</p>
                    )}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-netease-muted">
                当前：{getFmModeLabel(currentFm)}
              </p>
            </section>
          )}

          {activeTab === 'member' && isOwner && (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-medium text-white">贵宾角标</h3>
              </div>
              <p className="mb-3 text-xs text-netease-muted">
                为在线用户赋予角标，进房欢迎与点歌边框自动生效
              </p>
              <button
                type="button"
                onClick={onOpenMemberModal}
                className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
              >
                <span className="text-sm text-white">管理贵宾</span>
                <span className="text-xs text-netease-muted">
                  {memberTierCount > 0 ? `已设置 ${memberTierCount} 人` : '未设置'}
                </span>
              </button>
            </section>
          )}

          {activeTab === 'transfer' && isOwner && (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <Crown className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-medium text-white">转让房主</h3>
              </div>
              <p className="mb-3 text-xs text-netease-muted">
                将房间创建者身份转让给在线成员。转让后对方成为房主，你将变为管理员（名额未满时）。
              </p>
              {transferCandidates.length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-netease-muted">
                  当前没有可转让的在线成员
                </p>
              ) : (
                <div className="space-y-1.5">
                  {transferCandidates.map((user) => {
                    const selected = transferTargetId === user.id;
                    return (
                      <button
                        key={user.id}
                        type="button"
                        disabled={transferSaving}
                        onClick={() => setTransferTargetId(user.id)}
                        className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                          selected
                            ? 'border-amber-400/30 bg-amber-400/[0.08]'
                            : 'border-transparent bg-white/[0.03] hover:bg-white/[0.06]'
                        }`}
                      >
                        <span className={`text-sm font-medium ${selected ? 'text-white' : 'text-white/90'}`}>
                          {user.nickname}
                        </span>
                        {selected && (
                          <span className="text-[10px] text-amber-300">已选择</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  disabled={!selectedTransferUser || transferSaving || !onTransferOwner}
                  onClick={() => setConfirmTransfer(true)}
                  className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
                >
                  {transferSaving ? '转让中…' : '转让房主'}
                </button>
              </div>
            </section>
          )}

          {activeTab === 'identity' && (
            <section className="space-y-5">
              {linuxdoEnabled && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Crown className="h-4 w-4 text-amber-400" />
                    <h3 className="text-sm font-medium text-white">Linux.do 身份</h3>
                  </div>
                  {isOwner ? (
                    <>
                      <p className="mb-3 text-xs text-netease-muted">
                        绑定 Linux.do 账号后，即使换设备或清除了浏览器 Cookie，也能用同一个 Linux.do 账号登录找回这个房间的房主身份。
                      </p>
                      {linuxdoBound ? (
                        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm text-white">已绑定：{linuxdoBound.username || linuxdoBound.linuxdoId}</p>
                            <p className="mt-0.5 text-[11px] text-netease-muted">
                              {new Date(linuxdoBound.boundAt).toLocaleString()}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={linuxdoUnbinding}
                            onClick={async () => {
                              setLinuxdoUnbinding(true);
                              const result = await unbindLinuxdo();
                              setLinuxdoUnbinding(false);
                              if (result.success) setLinuxdoBound(null);
                            }}
                            className="flex-shrink-0 rounded-lg px-3 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                          >
                            {linuxdoUnbinding ? '解绑中…' : '解绑'}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={!roomId}
                          onClick={() => roomId && startLinuxdoBind(roomId, window.location.pathname)}
                          className="w-full rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
                        >
                          绑定 Linux.do 账号
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="mb-3 text-xs text-netease-muted">
                        如果你是这个房间的房主，但因为换设备或清除 Cookie 而不再被识别为房主，可以用当初绑定的 Linux.do 账号登录找回身份。
                      </p>
                      <button
                        type="button"
                        onClick={() => startLinuxdoRecover(window.location.pathname)}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white transition-colors hover:bg-white/[0.06]"
                      >
                        用 Linux.do 找回房间身份
                      </button>
                    </>
                  )}
                </div>
              )}

              {githubEnabled && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Crown className="h-4 w-4 text-amber-400" />
                    <h3 className="text-sm font-medium text-white">GitHub 身份</h3>
                  </div>
                  {isOwner ? (
                    <>
                      <p className="mb-3 text-xs text-netease-muted">
                        绑定 GitHub 账号后，即使换设备或清除了浏览器 Cookie，也能用同一个 GitHub 账号登录找回这个房间的房主身份。
                      </p>
                      {githubBound ? (
                        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm text-white">已绑定：{githubBound.username || githubBound.githubId}</p>
                            <p className="mt-0.5 text-[11px] text-netease-muted">
                              {new Date(githubBound.boundAt).toLocaleString()}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={githubUnbinding}
                            onClick={async () => {
                              setGithubUnbinding(true);
                              const result = await unbindGithub();
                              setGithubUnbinding(false);
                              if (result.success) setGithubBound(null);
                            }}
                            className="flex-shrink-0 rounded-lg px-3 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                          >
                            {githubUnbinding ? '解绑中…' : '解绑'}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={!roomId}
                          onClick={() => roomId && startGithubBind(roomId, window.location.pathname)}
                          className="w-full rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
                        >
                          绑定 GitHub 账号
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="mb-3 text-xs text-netease-muted">
                        如果你是这个房间的房主，但因为换设备或清除 Cookie 而不再被识别为房主，可以用当初绑定的 GitHub 账号登录找回身份。
                      </p>
                      <button
                        type="button"
                        onClick={() => startGithubRecover(window.location.pathname)}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white transition-colors hover:bg-white/[0.06]"
                      >
                        用 GitHub 找回房间身份
                      </button>
                    </>
                  )}
                </div>
              )}
            </section>
          )}

          {activeTab === 'announcement' && canModerate && (
            <section>
              <div className="space-y-3">
                <Toggle
                  checked={draftAnnouncementEnabled}
                  disabled={announcementSaving}
                  onChange={setDraftAnnouncementEnabled}
                  label="开启公告"
                  description="新进房间的用户将弹窗展示公告"
                />
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="settings-announcement-text" className="text-xs text-netease-muted">
                      公告内容
                    </label>
                    <span className="text-[10px] text-netease-muted">
                      {draftAnnouncementText.length}/{ANNOUNCEMENT_MAX_LENGTH}
                    </span>
                  </div>
                  <textarea
                    id="settings-announcement-text"
                    value={draftAnnouncementText}
                    onChange={(e) => setDraftAnnouncementText(e.target.value.slice(0, ANNOUNCEMENT_MAX_LENGTH))}
                    disabled={announcementSaving}
                    rows={6}
                    placeholder="输入房间公告…"
                    className="w-full resize-none rounded-xl border border-netease-border/60 bg-netease-dark px-3 py-2 text-sm text-white outline-none focus:border-netease-red/50 disabled:opacity-50"
                  />
                </div>
                {announcementDirty && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={announcementSaving}
                      onClick={() => onSaveAnnouncement({
                        enabled: draftAnnouncementEnabled,
                        text: draftAnnouncementText.trim(),
                      })}
                      className="rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-netease-red/90 disabled:opacity-50"
                    >
                      {announcementSaving ? '保存中…' : '保存公告'}
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'chat' && canModerate && (
            <section>
              <div className="space-y-3">
                <Toggle
                  checked={chatHistoryVisibleOnJoin}
                  disabled={chatHistorySaving}
                  onChange={onSaveChatHistory}
                  label="进房可查看历史消息"
                  description="开启后，成员进入房间可浏览此前聊天记录；关闭则仅能看到进房之后的消息"
                />
                {isOwner && (
                  <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <Toggle
                      checked={draftJoinNoticeEnabled}
                      disabled={joinNoticeSaving}
                      onChange={setDraftJoinNoticeEnabled}
                      label="进房系统提醒"
                      description="成员进入时在聊天室提示“昵称进入房间”"
                    />
                    <div className={draftJoinNoticeEnabled ? '' : 'opacity-50'}>
                      <label htmlFor="settings-join-notice-cooldown" className="text-sm font-medium text-white">
                        重复提醒间隔
                      </label>
                      <p className="mt-0.5 text-xs text-netease-muted">
                        同一用户在此时间内重新进入不会重复提醒，0 表示每次都提醒
                      </p>
                      <NumberStepper
                        id="settings-join-notice-cooldown"
                        value={draftJoinNoticeCooldownMinutes}
                        min={0}
                        max={JOIN_NOTICE_COOLDOWN_MINUTES_MAX}
                        disabled={joinNoticeSaving || !draftJoinNoticeEnabled}
                        suffix="分钟"
                        onChange={setDraftJoinNoticeCooldownMinutes}
                      />
                    </div>
                    {joinNoticeDirty && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={joinNoticeSaving}
                          onClick={() => onSaveJoinNotice({
                            enabled: draftJoinNoticeEnabled,
                            cooldownMinutes: draftJoinNoticeCooldownMinutes,
                          })}
                          className="rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-netease-red/90 disabled:opacity-50"
                        >
                          {joinNoticeSaving ? '保存中…' : '保存进房提醒'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'songRequest' && canModerate && (
            <section>
              <div className="space-y-3">
                <Toggle
                  checked={draftSongRequest.enabled}
                  disabled={songRequestSaving}
                  onChange={(enabled) => setDraftSongRequest((prev) => ({ ...prev, enabled }))}
                  label="允许成员点歌"
                  description="关闭后仅房主与管理员可点歌"
                />

                <Toggle
                  checked={draftSongRequest.memberJumpEnabled}
                  disabled={songRequestSaving}
                  onChange={(memberJumpEnabled) => setDraftSongRequest((prev) => ({ ...prev, memberJumpEnabled }))}
                  label="允许成员插队"
                  description="开启后成员可对自己的点歌插队；房主与管理员始终可插队"
                />

                <Toggle
                  checked={draftSongRequest.memberSeekEnabled}
                  disabled={songRequestSaving}
                  onChange={(memberSeekEnabled) => setDraftSongRequest((prev) => ({ ...prev, memberSeekEnabled }))}
                  label="允许成员拖动进度条"
                  description="默认关闭；开启后成员可调节播放进度；房主与管理员始终可操作"
                />

                <Toggle
                  checked={draftSongRequest.memberPauseEnabled}
                  disabled={songRequestSaving}
                  onChange={(memberPauseEnabled) => setDraftSongRequest((prev) => ({ ...prev, memberPauseEnabled }))}
                  label="允许成员暂停/播放"
                  description="默认关闭；开启后成员可暂停或继续播放；房主与管理员始终可操作"
                />

                <Toggle
                  checked={draftSongRequest.systemMediaPlayBound}
                  disabled={songRequestSaving}
                  onChange={(systemMediaPlayBound) => setDraftSongRequest((prev) => ({ ...prev, systemMediaPlayBound }))}
                  label="系统播放键绑定"
                  description="绑定耳机键 / 锁屏 / 通知栏的播放暂停；关闭可防止摘耳机误触暂停房间"
                />

                <Toggle
                  checked={draftSongRequest.systemMediaSkipBound}
                  disabled={songRequestSaving}
                  onChange={(systemMediaSkipBound) => setDraftSongRequest((prev) => ({ ...prev, systemMediaSkipBound }))}
                  label="系统切歌键绑定"
                  description="绑定耳机键 / 锁屏 / 通知栏的下一首切歌；关闭可防止误触切歌"
                />

                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <label className="text-sm font-medium text-white">
                    踩歌切歌规则
                  </label>
                  <p className="mt-0.5 text-xs text-netease-muted">
                    正在播放的歌曲被踩满后自动切歌
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={songRequestSaving}
                      onClick={() => setDraftSongRequest((prev) => ({ ...prev, dislikeSkipMode: 'count' }))}
                      className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                        draftSongRequest.dislikeSkipMode === 'count'
                          ? 'bg-netease-red/20 text-white'
                          : 'bg-white/5 text-netease-muted hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      固定人数
                    </button>
                    <button
                      type="button"
                      disabled={songRequestSaving}
                      onClick={() => setDraftSongRequest((prev) => ({ ...prev, dislikeSkipMode: 'percent' }))}
                      className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                        draftSongRequest.dislikeSkipMode === 'percent'
                          ? 'bg-netease-red/20 text-white'
                          : 'bg-white/5 text-netease-muted hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      在线比例
                    </button>
                  </div>
                  {draftSongRequest.dislikeSkipMode === 'count' ? (
                    <NumberStepper
                      id="settings-dislike-threshold"
                      value={draftSongRequest.dislikeSkipThreshold}
                      min={1}
                      max={DISLIKE_SKIP_THRESHOLD_MAX}
                      disabled={songRequestSaving}
                      suffix="人"
                      onChange={(dislikeSkipThreshold) => setDraftSongRequest((prev) => ({ ...prev, dislikeSkipThreshold }))}
                    />
                  ) : (
                    <NumberStepper
                      id="settings-dislike-percent"
                      value={draftSongRequest.dislikeSkipPercent}
                      min={1}
                      max={100}
                      disabled={songRequestSaving}
                      suffix="%"
                      onChange={(dislikeSkipPercent) => setDraftSongRequest((prev) => ({ ...prev, dislikeSkipPercent }))}
                    />
                  )}
                </div>

                <Toggle
                  checked={draftSongRequest.clearSongsOnLeaveEnabled}
                  disabled={songRequestSaving}
                  onChange={(clearSongsOnLeaveEnabled) => setDraftSongRequest((prev) => ({ ...prev, clearSongsOnLeaveEnabled }))}
                  label="退出后清除已点歌曲"
                  description="成员离房后，在等待时间到期仍未回来则清除其待播点歌"
                />

                {draftSongRequest.clearSongsOnLeaveEnabled && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                    <label htmlFor="settings-clear-on-leave-delay" className="text-sm font-medium text-white">
                      退出清除等待时间
                    </label>
                    <p className="mt-0.5 text-xs text-netease-muted">
                      0 表示立即清除；期内重新进房会取消清除
                    </p>
                    <NumberStepper
                      id="settings-clear-on-leave-delay"
                      value={draftSongRequest.clearSongsOnLeaveDelayMinutes}
                      min={0}
                      max={CLEAR_ON_LEAVE_DELAY_MINUTES_MAX}
                      disabled={songRequestSaving}
                      suffix="分钟"
                      onChange={(clearSongsOnLeaveDelayMinutes) => setDraftSongRequest((prev) => ({
                        ...prev,
                        clearSongsOnLeaveDelayMinutes,
                      }))}
                    />
                  </div>
                )}

                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <label htmlFor="settings-min-stay" className="text-sm font-medium text-white">
                    进房等待时间
                  </label>
                  <p className="mt-0.5 text-xs text-netease-muted">
                    新成员需待在房间一定时间后才能点歌，0 表示不限制
                  </p>
                  <NumberStepper
                    id="settings-min-stay"
                    value={draftSongRequest.minStayMinutes}
                    min={0}
                    max={MIN_STAY_MINUTES_MAX}
                    disabled={songRequestSaving}
                    suffix="分钟"
                    onChange={(minStayMinutes) => setDraftSongRequest((prev) => ({ ...prev, minStayMinutes }))}
                  />
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <label htmlFor="settings-max-per-user" className="text-sm font-medium text-white">
                    每人最多点歌
                  </label>
                  <p className="mt-0.5 text-xs text-netease-muted">
                    队列中每人最多保留几首（含正在播放），0 表示不限制
                  </p>
                  <NumberStepper
                    id="settings-max-per-user"
                    value={draftSongRequest.maxPerUser}
                    min={0}
                    max={MAX_PER_USER_MAX}
                    disabled={songRequestSaving}
                    suffix="首"
                    onChange={(maxPerUser) => setDraftSongRequest((prev) => ({ ...prev, maxPerUser }))}
                  />
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <label className="text-sm font-medium text-white">
                    点歌冷却时间
                  </label>
                  <p className="mt-0.5 text-xs text-netease-muted">
                    每人每次点歌的最短间隔，防止连续刷屏占列表
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {COOLDOWN_OPTIONS.map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        disabled={songRequestSaving}
                        onClick={() => setDraftSongRequest((prev) => ({ ...prev, cooldownSec: sec }))}
                        className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                          draftSongRequest.cooldownSec === sec
                            ? 'bg-netease-red/20 text-white'
                            : 'bg-white/5 text-netease-muted hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {formatCooldownLabel(sec)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <label className="text-sm font-medium text-white">
                    队列长度上限
                  </label>
                  <p className="mt-0.5 text-xs text-netease-muted">
                    待播队列最多保留几首，超出后无法继续点歌
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {QUEUE_LIMIT_OPTIONS.map((limit) => (
                      <button
                        key={limit}
                        type="button"
                        disabled={songRequestSaving}
                        onClick={() => setDraftSongRequest((prev) => ({ ...prev, queueMaxLength: limit }))}
                        className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                          draftSongRequest.queueMaxLength === limit
                            ? 'bg-netease-red/20 text-white'
                            : 'bg-white/5 text-netease-muted hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {limit} 首
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-sm font-medium text-white">禁播歌曲</label>
                    <span className="text-[11px] text-netease-muted">{bannedSongs.length} 首</span>
                  </div>
                  <p className="mt-0.5 text-xs text-netease-muted">
                    可在播放队列中禁播某首歌；同名歌曲（任意平台）均无法点入
                  </p>
                  {bannedSongs.length > 0 ? (
                    <div className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-0.5">
                      {bannedSongs.map((song) => (
                        <div
                          key={`${song.name}:${song.bannedAt ?? ''}`}
                          className="flex items-center gap-2 rounded-lg bg-black/20 px-2 py-1.5"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs text-white/90">{song.name || '未知歌曲'}</p>
                            <p className="truncate text-[10px] text-netease-muted">{song.artist || '未知歌手'}</p>
                          </div>
                          <SourceBadge source={song.source} className="flex-shrink-0 rounded-full px-1.5 py-0 text-[9px]" />
                          <button
                            type="button"
                            disabled={songRequestSaving}
                            onClick={() => onUnbanSong?.(song.name)}
                            className="flex-shrink-0 rounded-md px-2 py-1 text-[10px] text-netease-muted transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                          >
                            解除
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-netease-muted/80">暂无禁播歌曲</p>
                  )}
                </div>

                {songRequestDirty && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={songRequestSaving}
                      onClick={() => onSaveSongRequest(draftSongRequest)}
                      className="rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-netease-red/90 disabled:opacity-50"
                    >
                      {songRequestSaving ? '保存中…' : '保存点歌规则'}
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body,
      )}
      {confirmTransfer && selectedTransferUser && (
        <ConfirmModal
          title="确认转让房主"
          message={(
            <>
              确定将房主转让给「{selectedTransferUser.nickname}」？
              <br />
              转让后对方成为房主，你将失去创建者权限（名额未满时自动变为管理员）。
            </>
          )}
          confirmLabel="确认转让"
          confirmVariant="danger"
          loading={transferSaving}
          onCancel={() => setConfirmTransfer(false)}
          onConfirm={() => {
            if (!selectedTransferUser || !onTransferOwner) return;
            void Promise.resolve(onTransferOwner(selectedTransferUser.id)).finally(() => {
              setConfirmTransfer(false);
            });
          }}
        />
      )}
    </>
  );
}
