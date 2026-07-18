import { customAlphabet } from 'nanoid';
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';
import { fetchMetingFmSong, normalizeFmMode, DEFAULT_FM_MODE, FM_MODE_OFF } from './metingFm.js';
import {
  initRoomStorage,
  isRedisEnabled,
  loadAllRoomsFromStorage,
  queueSaveRoomToStorage,
  deleteRoomFromStorage,
} from './roomStorage.js';
import {
  DEFAULT_MEMBER_SETTINGS,
  buildWelcomeText,
  normalizeIncomingMemberTier,
  normalizeMemberSettings,
  restoreMemberTiersFromStorage,
  serializeMemberSettings,
  serializeMemberTier,
  serializeMemberTiersMap,
} from './memberTier.js';
import { deleteRoomChatImages, validateChatImageForRoom, validateExternalChatImage } from './qiniuOss.js';
import { isLocalStickerImageKey, validateLocalStickerImage } from './localSticker.js';
import { collectDeviceIdsForUser, isAccessBanned } from './deviceIdentity.js';

const generateRoomId = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
const generateId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

const DEFAULT_ROOM_EMPTY_TTL_MS = 10 * 60 * 1000;
function parseEnvIntMs(name, fallbackMs) {
  const raw = process.env[name];
  if (raw == null) return fallbackMs;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallbackMs;
  // clamp to [0, 24h]
  return Math.max(0, Math.min(n, 24 * 60 * 60 * 1000));
}

// 房间无人时销毁延迟（毫秒），用于减少“退出再进设置丢失/房间被清理”的情况
const ROOM_EMPTY_TTL_MS = parseEnvIntMs('ROOM_EMPTY_TTL_MS', DEFAULT_ROOM_EMPTY_TTL_MS);
const DEFAULT_QUEUE_MAX_LENGTH = 200;
const ALLOWED_QUEUE_MAX_LENGTHS = [50, 100, 200];
const ALLOWED_SONG_REQUEST_COOLDOWNS_SEC = [0, 10, 30, 60, 120];
const DEFAULT_DISLIKE_SKIP_THRESHOLD = 5;
const DEFAULT_DISLIKE_SKIP_MODE = 'count';
const DEFAULT_DISLIKE_SKIP_PERCENT = 50;
const MAX_DISLIKE_SKIP_THRESHOLD = 50;
const DEFAULT_CLEAR_SONGS_ON_LEAVE_DELAY_SEC = 60;
const MAX_CLEAR_SONGS_ON_LEAVE_DELAY_SEC = 24 * 60 * 60;
const MAX_BANNED_SONGS = 100;
const MAX_CHAT_MESSAGES = 300;
const MAX_ACCOUNTS_PER_IP_PER_ROOM = 2;
const MAX_SONG_HISTORY = 150;
export const INITIAL_CHAT_LIMIT = 100;
export const CHAT_PAGE_LIMIT = 50;
const MAX_RANDOM_HISTORY = 200;
const MAX_RANDOM_PREFETCH_ATTEMPTS = 20;

/** @type {((roomId: string) => void) | null} */
let onRoomPrefetchReady = null;
/** @type {((roomId: string) => void) | null} */
let onRoomStructureChanged = null;

export function setOnRoomPrefetchReady(handler) {
  onRoomPrefetchReady = handler;
}

export function setOnRoomStructureChanged(handler) {
  onRoomStructureChanged = handler;
}

function notifyRoomPrefetchReady(room) {
  if (room?.nextRandom && onRoomPrefetchReady) {
    onRoomPrefetchReady(room.id);
  }
}

function notifyRoomStructureChanged(roomId) {
  if (onRoomStructureChanged) onRoomStructureChanged(roomId);
}

function skipRequestTimerKey(roomId, requestId) {
  return `${roomId}:${requestId}`;
}

function clearSkipRequestExpiryTimer(roomId, requestId) {
  const key = skipRequestTimerKey(roomId, requestId);
  const timer = skipRequestExpiryTimers.get(key);
  if (!timer) return;
  clearTimeout(timer);
  skipRequestExpiryTimers.delete(key);
}

function clearSkipRequestExpiryTimersForRoom(roomId) {
  const prefix = `${roomId}:`;
  for (const [key, timer] of skipRequestExpiryTimers) {
    if (!key.startsWith(prefix)) continue;
    clearTimeout(timer);
    skipRequestExpiryTimers.delete(key);
  }
}

function expireSkipRequest(roomId, requestId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const before = room.skipRequests.length;
  room.skipRequests = room.skipRequests.filter((r) => r.id !== requestId);
  if (room.skipRequests.length === before) return;
  persistRoom(room);
  notifyRoomStructureChanged(roomId);
}

function scheduleSkipRequestExpiry(roomId, requestId, requestedAt = Date.now()) {
  clearSkipRequestExpiryTimer(roomId, requestId);
  const remainingMs = Math.max(0, SKIP_REQUEST_TTL_MS - (Date.now() - requestedAt));
  const key = skipRequestTimerKey(roomId, requestId);
  const timer = setTimeout(() => {
    skipRequestExpiryTimers.delete(key);
    expireSkipRequest(roomId, requestId);
  }, remainingMs);
  skipRequestExpiryTimers.set(key, timer);
}

function syncSkipRequestExpiryTimers(room) {
  if (!room) return;
  clearSkipRequestExpiryTimersForRoom(room.id);
  room.skipRequests.forEach((request) => {
    scheduleSkipRequestExpiry(room.id, request.id, request.requestedAt);
  });
}

function purgeExpiredSkipRequests(room) {
  const now = Date.now();
  const before = room.skipRequests.length;
  room.skipRequests = room.skipRequests.filter((request) => {
    const expired = now - request.requestedAt >= SKIP_REQUEST_TTL_MS;
    if (expired) clearSkipRequestExpiryTimer(room.id, request.id);
    return !expired;
  });
  return before !== room.skipRequests.length;
}
const AUTO_ADVANCE_GRACE_SEC = 0.15;
const SKIP_REQUEST_TTL_MS = 10_000;
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const skipRequestExpiryTimers = new Map();
const NETEASE_CANONICAL = new Set(['standard', 'higher', 'exhigh', 'lossless', 'hires']);
const TENCENT_CANONICAL = new Set(['standard', 'exhigh', 'lossless']);
const QUALITY_ALIASES = {
  '128': 'standard',
  '320': 'exhigh',
  flac: 'lossless',
};

function normalizeRoomAudioQuality(input) {
  const rawNetease = String(input?.netease || 'hires');
  const rawTencent = String(input?.tencent || 'lossless');
  const netease = QUALITY_ALIASES[rawNetease] || rawNetease;
  const tencent = QUALITY_ALIASES[rawTencent] || rawTencent;
  return {
    netease: NETEASE_CANONICAL.has(netease) ? netease : 'lossless',
    tencent: TENCENT_CANONICAL.has(tencent) ? tencent : 'lossless',
  };
}

const rooms = new Map();
const ensurePlaybackInflight = new Map();

const MAX_ROOM_PASSWORD_LENGTH = 64;

function normalizeRoomPasswordInput(password) {
  return String(password || '').trim().slice(0, MAX_ROOM_PASSWORD_LENGTH);
}

function hashPassword(password) {
  const normalized = normalizeRoomPasswordInput(password);
  const salt = randomBytes(16);
  const hash = scryptSync(normalized, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored) return true;
  if (!password) return false;
  const normalized = normalizeRoomPasswordInput(password);
  if (!normalized) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(normalized, salt, 32);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function verifyRoomPassword(roomId, password, options = {}) {
  const room = rooms.get(roomId?.toUpperCase());
  if (!room) return { ok: false, error: '房间不存在' };

  const clientId = sanitizeCreatorId(options.clientId);
  // 原创建者始终可进：无密码上锁 / 有密码房均免密
  if (clientId && room.creatorId === clientId) {
    return { ok: true };
  }

  if (room.isLocked && !room.passwordHash) {
    return { ok: false, error: '房间已上锁，禁止进入' };
  }

  if (room.passwordHash) {
    const normalized = normalizeRoomPasswordInput(password);
    if (!normalized) {
      return { ok: false, error: '请输入房间密码', needsPassword: true };
    }
    if (!verifyPassword(password, room.passwordHash)) {
      return { ok: false, error: '密码错误', needsPassword: true };
    }
  }
  return { ok: true };
}

function cancelRoomDestroy(room) {
  if (room.destroyTimer) {
    clearTimeout(room.destroyTimer);
    room.destroyTimer = null;
  }
}

function scheduleRoomDestroy(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  cancelRoomDestroy(room);
  room.destroyTimer = setTimeout(() => {
    const current = rooms.get(roomId);
    if (current && current.users.size === 0) {
      clearAllPendingLeaveClears(current);
      clearSkipRequestExpiryTimersForRoom(roomId);
      void deleteRoomChatImages(roomId).finally(() => {
        rooms.delete(roomId);
        invalidateRoomsListCache();
        void deleteRoomFromStorage(roomId);
      });
    }
  }, ROOM_EMPTY_TTL_MS);
}

function snapshotRoomForStorage(room) {
  return {
    id: room.id,
    name: room.name,
    passwordHash: room.passwordHash,
    isLocked: Boolean(room.isLocked),
    muteAll: Boolean(room.muteAll),
    mutedUserIds: Array.from(room.mutedUserIds || []),
    creatorId: room.creatorId ?? null,
    bannedUserIds: Array.from(room.bannedUserIds || []),
    bannedDeviceIds: Array.from(room.bannedDeviceIds || []),
    queue: room.queue.map(serializeQueueItemForRoom).filter(Boolean),
    current: serializeQueueItemForRoom(room.current),
    isPlaying: room.isPlaying,
    currentTime: getPlaybackTime(room),
    playbackVersion: room.playbackVersion ?? 0,
    playbackUpdatedAt: room.playbackUpdatedAt ?? Date.now(),
    messages: room.messages.slice(-MAX_CHAT_MESSAGES).map(sanitizeMessageForStorage),
    knownUserIds: Array.from(room.knownUserIds || []),
    chatVisibleSinceByUserId: Object.fromEntries(room.chatVisibleSinceByUserId || []),
    songHistory: (room.songHistory || [])
      .slice(0, MAX_SONG_HISTORY)
      .map(serializeSongHistoryForClient)
      .filter(Boolean),
    jumpRequests: room.jumpRequests,
    skipRequests: room.skipRequests,
    randomPlayedKeys: Array.from(room.randomPlayedKeys),
    nextRandom: serializeSongMeta(room.nextRandom),
    adminIds: Array.from(room.adminIds || []),
    autoPromotedAdminIds: Array.from(room.autoPromotedAdminIds || []),
    userNicknames: Object.fromEntries(room.userNicknames || []),
    audioQuality: room.audioQuality ?? { netease: 'hires', tencent: 'lossless' },
    neteaseFmMode: normalizeFmMode(room.neteaseFmMode),
    fmModeBeforeOff: normalizeFmMode(room.fmModeBeforeOff),
    announcementEnabled: Boolean(room.announcementEnabled),
    announcementText: String(room.announcementText || '').slice(0, MAX_ANNOUNCEMENT_LENGTH),
    chatHistoryVisibleOnJoin: Boolean(room.chatHistoryVisibleOnJoin),
    songRequestEnabled: room.songRequestEnabled !== false,
    songRequestMinStaySec: normalizeSongRequestMinStaySec(room.songRequestMinStaySec),
    songRequestMaxPerUser: normalizeSongRequestMaxPerUser(room.songRequestMaxPerUser),
    songRequestCooldownSec: normalizeSongRequestCooldownSec(room.songRequestCooldownSec),
    queueMaxLength: normalizeQueueMaxLength(room.queueMaxLength),
    memberJumpEnabled: Boolean(room.memberJumpEnabled),
    memberSeekEnabled: Boolean(room.memberSeekEnabled),
    memberPauseEnabled: Boolean(room.memberPauseEnabled),
    systemMediaPlayBound: room.systemMediaPlayBound !== false,
    systemMediaSkipBound: room.systemMediaSkipBound !== false,
    dislikeSkipMode: normalizeDislikeSkipMode(room.dislikeSkipMode),
    dislikeSkipThreshold: normalizeDislikeSkipThreshold(room.dislikeSkipThreshold),
    dislikeSkipPercent: normalizeDislikeSkipPercent(room.dislikeSkipPercent),
    clearSongsOnLeaveEnabled: Boolean(room.clearSongsOnLeaveEnabled),
    clearSongsOnLeaveDelaySec: normalizeClearSongsOnLeaveDelaySec(room.clearSongsOnLeaveDelaySec),
    bannedSongs: serializeBannedSongs(room.bannedSongs),
    memberTiers: serializeMemberTiersMap(room.memberTiers),
    memberSettings: serializeMemberSettings(room.memberSettings),
    createdAt: room.createdAt,
  };
}

function restoreRoomFromStorage(data) {
  const room = createEmptyRoom(data.id, data.name, data.passwordHash ?? null);
  room.queue = (data.queue || []).map(serializeQueueItemForRoom).filter(Boolean);
  room.current = serializeQueueItemForRoom(data.current) ?? null;
  room.isPlaying = Boolean(data.isPlaying);
  room.currentTime = data.currentTime ?? 0;
  room.playbackVersion = data.playbackVersion ?? 0;
  room.playbackUpdatedAt = data.playbackUpdatedAt ?? Date.now();
  room.messages = data.messages || [];
  room.knownUserIds = new Set(data.knownUserIds || []);
  room.chatVisibleSinceByUserId = restoreChatVisibleSinceMap(data.chatVisibleSinceByUserId);
  room.songHistory = (Array.isArray(data.songHistory) ? data.songHistory : [])
    .slice(0, MAX_SONG_HISTORY)
    .map(serializeSongHistoryForClient)
    .filter(Boolean);
  room.jumpRequests = data.jumpRequests || [];
  room.skipRequests = data.skipRequests || [];
  purgeExpiredSkipRequests(room);
  syncSkipRequestExpiryTimers(room);
  room.randomPlayedKeys = new Set(data.randomPlayedKeys || []);
  room.nextRandom = serializeSongMeta(data.nextRandom);
  room.creatorId = data.creatorId ?? null;
  room.bannedUserIds = new Set(data.bannedUserIds || []);
  room.bannedDeviceIds = new Set(data.bannedDeviceIds || []);
  room.isLocked = Boolean(data.isLocked);
  room.muteAll = Boolean(data.muteAll);
  room.mutedUserIds = new Set(data.mutedUserIds || []);
  room.adminIds = new Set(Array.isArray(data.adminIds) ? data.adminIds : []);
  room.autoPromotedAdminIds = new Set(Array.isArray(data.autoPromotedAdminIds) ? data.autoPromotedAdminIds : []);
  room.userNicknames = new Map(Object.entries(data.userNicknames || {}));
  room.audioQuality = normalizeRoomAudioQuality(data.audioQuality);
  room.neteaseFmMode = normalizeFmMode(data.neteaseFmMode);
  const fmModeBeforeOff = normalizeFmMode(data.fmModeBeforeOff);
  room.fmModeBeforeOff = fmModeBeforeOff === FM_MODE_OFF ? DEFAULT_FM_MODE : fmModeBeforeOff;
  room.announcementEnabled = Boolean(data.announcementEnabled);
  room.announcementText = String(data.announcementText || '').slice(0, MAX_ANNOUNCEMENT_LENGTH);
  room.chatHistoryVisibleOnJoin = Boolean(data.chatHistoryVisibleOnJoin);
  room.songRequestEnabled = data.songRequestEnabled !== false;
  room.songRequestMinStaySec = normalizeSongRequestMinStaySec(data.songRequestMinStaySec);
  room.songRequestMaxPerUser = normalizeSongRequestMaxPerUser(data.songRequestMaxPerUser);
  room.songRequestCooldownSec = normalizeSongRequestCooldownSec(data.songRequestCooldownSec);
  room.queueMaxLength = normalizeQueueMaxLength(data.queueMaxLength);
  room.memberJumpEnabled = Boolean(data.memberJumpEnabled);
  room.memberSeekEnabled = Boolean(data.memberSeekEnabled);
  room.memberPauseEnabled = Boolean(data.memberPauseEnabled);
  room.systemMediaPlayBound = data.systemMediaPlayBound !== false;
  room.systemMediaSkipBound = data.systemMediaSkipBound !== false;
  room.dislikeSkipMode = normalizeDislikeSkipMode(data.dislikeSkipMode);
  room.dislikeSkipThreshold = normalizeDislikeSkipThreshold(data.dislikeSkipThreshold);
  room.dislikeSkipPercent = normalizeDislikeSkipPercent(data.dislikeSkipPercent);
  room.clearSongsOnLeaveEnabled = Boolean(data.clearSongsOnLeaveEnabled);
  room.clearSongsOnLeaveDelaySec = normalizeClearSongsOnLeaveDelaySec(
    data.clearSongsOnLeaveDelaySec ?? DEFAULT_CLEAR_SONGS_ON_LEAVE_DELAY_SEC,
  );
  room.bannedSongs = restoreBannedSongs(data.bannedSongs);
  room.memberTiers = restoreMemberTiersFromStorage(data.memberTiers);
  room.memberSettings = normalizeMemberSettings(data.memberSettings);
  room.createdAt = data.createdAt ?? Date.now();

  if (room.isPlaying && room.current) {
    room.startedAt = Date.now() - room.currentTime * 1000;
  }

  return room;
}

const pendingPersistRooms = new Map();
let persistFlushScheduled = false;

function flushPendingPersists() {
  persistFlushScheduled = false;
  const batch = new Map(pendingPersistRooms);
  pendingPersistRooms.clear();

  for (const room of batch.values()) {
    queueSaveRoomToStorage(snapshotRoomForStorage(room));
  }
}

function persistRoom(room) {
  if (!room) return;
  pendingPersistRooms.set(room.id, room);
  if (!persistFlushScheduled) {
    persistFlushScheduled = true;
    setImmediate(flushPendingPersists);
  }
}

let cachedListRooms = null;
let cachedListRoomsAt = 0;
const LIST_ROOMS_CACHE_MS = 1500;

function invalidateRoomsListCache() {
  cachedListRooms = null;
  cachedListRoomsAt = 0;
}

function isRoomVisibleInLobby(room) {
  if (room.users.size > 0) return true;
  if (room.current || room.isPlaying) return true;
  if (room.queue.length > 0) return true;
  return false;
}

export async function initRooms() {
  await initRoomStorage();
  const stored = await loadAllRoomsFromStorage();

  for (const data of stored) {
    const room = restoreRoomFromStorage(data);
    rooms.set(room.id, room);
    if (room.users.size === 0) {
      scheduleRoomDestroy(room.id);
    }
  }

  if (stored.length > 0) {
    console.log(`已从 Redis 恢复 ${stored.length} 个房间`);
  }

  if (isRedisEnabled()) {
    setInterval(() => {
      for (const room of rooms.values()) {
        if (room.isPlaying || room.users.size > 0 || room.queue.length > 0) {
          persistRoom(room);
        }
      }
    }, 30000);
  }
}

export { isRedisEnabled };

function normalizeRoomName(name, roomId) {
  const trimmed = String(name || '').trim();
  return trimmed.slice(0, 30) || `房间 ${roomId}`;
}

function bumpPlaybackState(room) {
  room.playbackVersion = (room.playbackVersion || 0) + 1;
  room.playbackUpdatedAt = Date.now();
}

export function buildPlaybackState(room) {
  if (!room) return null;
  repairPlaybackClock(room);
  const now = Date.now();
  const positionSec = getPlaybackTime(room);
  const durationSec = room.current ? getSongDurationSeconds(room.current) : 0;
  return {
    roomId: room.id,
    version: room.playbackVersion || 0,
    trackId: room.current?.queueId || '',
    status: room.isPlaying ? 'playing' : 'paused',
    positionSec,
    durationSec: durationSec > 0 ? durationSec : 0,
    serverNowMs: now,
    startedAt: room.isPlaying && room.startedAt ? room.startedAt : 0,
    currentTime: positionSec,
    updatedAt: room.playbackUpdatedAt || now,
  };
}

function createEmptyRoom(roomId, name, passwordHash = null) {
  return {
    id: roomId,
    name: normalizeRoomName(name, roomId),
    passwordHash,
    isLocked: false,
    muteAll: false,
    mutedUserIds: new Set(),
    creatorId: null,
    ownerId: null,
    bannedUserIds: new Set(),
    bannedDeviceIds: new Set(),
    queue: [],
    current: null,
    isPlaying: false,
    currentTime: 0,
    startedAt: null,
    playbackVersion: 0,
    playbackUpdatedAt: Date.now(),
    playbackDriftAnchored: false,
    playbackDriftAnchorCooldownUntil: 0,
    users: new Map(),
    ownerConnectionId: null,
    jumpRequests: [],
    skipRequests: [],
    messages: [],
    knownUserIds: new Set(),
    chatVisibleSinceByUserId: new Map(),
    songHistory: [],
    randomPlayedKeys: new Set(),
    nextRandom: null,
    nextRandomPromise: null,
    randomLoading: false,
    playbackLock: null,
    autoAdvancePromise: null,
    adminIds: new Set(),
    autoPromotedAdminIds: new Set(),
    userNicknames: new Map(),
    audioQuality: {
      netease: 'hires',
      tencent: 'lossless',
    },
    neteaseFmMode: DEFAULT_FM_MODE,
    fmModeBeforeOff: DEFAULT_FM_MODE,
    announcementEnabled: false,
    announcementText: '',
    /** 进房是否可查看历史聊天；默认关闭（仅看进房后的消息） */
    chatHistoryVisibleOnJoin: false,
    songRequestEnabled: true,
    songRequestMinStaySec: 0,
    songRequestMaxPerUser: 0,
    songRequestCooldownSec: 0,
    queueMaxLength: DEFAULT_QUEUE_MAX_LENGTH,
    memberJumpEnabled: false,
    /** 是否允许成员拖动进度条（默认关闭，房主/管理员始终可） */
    memberSeekEnabled: false,
    /** 是否允许成员暂停/播放（默认关闭，房主/管理员始终可） */
    memberPauseEnabled: false,
    systemMediaPlayBound: true,
    systemMediaSkipBound: true,
    dislikeSkipMode: DEFAULT_DISLIKE_SKIP_MODE,
    dislikeSkipThreshold: DEFAULT_DISLIKE_SKIP_THRESHOLD,
    dislikeSkipPercent: DEFAULT_DISLIKE_SKIP_PERCENT,
    clearSongsOnLeaveEnabled: false,
    clearSongsOnLeaveDelaySec: DEFAULT_CLEAR_SONGS_ON_LEAVE_DELAY_SEC,
    pendingLeaveClears: new Map(),
    bannedSongs: [],
    lastSongRequestAt: new Map(),
    memberTiers: new Map(),
    memberSettings: { ...DEFAULT_MEMBER_SETTINGS },
    createdAt: Date.now(),
    destroyTimer: null,
  };
}

const MAX_ADMINS = 3;

function getNextOwnerId(room) {
  return Array.from(room.users.values())
    .filter((user) => !user.readOnly)
    .sort((a, b) => a.joinedAt - b.joinedAt)[0]?.id || null;
}

function isEligibleOwner(user) {
  return Boolean(user && !user.readOnly);
}

function ensureAdminIds(room) {
  if (!room.adminIds) room.adminIds = new Set();
  return room.adminIds;
}

function ensureAutoPromotedAdminIds(room) {
  if (!room.autoPromotedAdminIds) room.autoPromotedAdminIds = new Set();
  return room.autoPromotedAdminIds;
}

function revokeAutoPromotedAdmins(room) {
  const admins = ensureAdminIds(room);
  const auto = ensureAutoPromotedAdminIds(room);
  let changed = false;
  for (const id of auto) {
    if (admins.delete(id)) changed = true;
  }
  if (auto.size > 0) {
    auto.clear();
    changed = true;
  }
  return changed;
}

/** 自动提升管理最多 1 人：只保留 keepId，其余全部收回 */
function ensureSingleAutoPromotedAdmin(room, keepId) {
  const admins = ensureAdminIds(room);
  const auto = ensureAutoPromotedAdminIds(room);
  const keep = keepId && admins.has(keepId) ? keepId : null;

  for (const id of [...auto]) {
    if (id === keep) continue;
    admins.delete(id);
    auto.delete(id);
  }

  if (keep) {
    auto.clear();
    auto.add(keep);
    admins.add(keep);
  } else if (auto.size > 0) {
    for (const id of [...auto]) {
      admins.delete(id);
    }
    auto.clear();
  }
}

function pruneAdminIds(room) {
  const admins = ensureAdminIds(room);
  const auto = ensureAutoPromotedAdminIds(room);
  for (const id of [...admins]) {
    const user = room.users.get(id);
    // 离线指定管理保留身份；仅清掉不可控的 TV/只读在线用户
    if (user && !isEligibleOwner(user)) {
      admins.delete(id);
      auto.delete(id);
    }
  }
  // 自动提升残留：人不在 adminIds 里则清理标记
  for (const id of [...auto]) {
    if (!admins.has(id)) auto.delete(id);
  }
  // 持久化脏数据兜底：自动提升最多保留 1 人（优先在线、否则最早进房记录）
  if (auto.size > 1) {
    const ordered = Array.from(auto).sort((a, b) => {
      const aOnline = isEligibleOwner(room.users.get(a)) ? 0 : 1;
      const bOnline = isEligibleOwner(room.users.get(b)) ? 0 : 1;
      if (aOnline !== bOnline) return aOnline - bOnline;
      return (room.users.get(a)?.joinedAt || 0) - (room.users.get(b)?.joinedAt || 0);
    });
    ensureSingleAutoPromotedAdmin(room, ordered[0]);
  }
}

/** 房主指定的正式管理（不含自动提升） */
function getAppointedAdminIds(room) {
  pruneAdminIds(room);
  const auto = ensureAutoPromotedAdminIds(room);
  return Array.from(ensureAdminIds(room))
    .filter((id) => !auto.has(id))
    .sort((a, b) => (room.users.get(a)?.joinedAt || 0) - (room.users.get(b)?.joinedAt || 0));
}

function getOnlineAppointedAdminIds(room) {
  return getAppointedAdminIds(room).filter((id) => isEligibleOwner(room.users.get(id)));
}

function isAppointedAdmin(room, userId) {
  if (!userId) return false;
  pruneAdminIds(room);
  if (!ensureAdminIds(room).has(userId)) return false;
  return !ensureAutoPromotedAdminIds(room).has(userId);
}

function isAutoPromotedAdmin(room, userId) {
  if (!userId) return false;
  return ensureAutoPromotedAdminIds(room).has(userId) && ensureAdminIds(room).has(userId);
}

function rememberUserNickname(room, userId, nickname) {
  const nick = normalizeNickname(nickname);
  if (!userId || !nick) return;
  if (!room.userNicknames) room.userNicknames = new Map();
  room.userNicknames.set(userId, nick);
}

/** 管理端广播/进房 ACK 仅需当前相关用户昵称，避免历史访客 Map（可上千条）撑爆载荷 */
function serializeUserNicknamesForViewer(room) {
  const map = room.userNicknames;
  if (!map?.size) return undefined;

  const needed = new Set();
  for (const user of room.users.values()) {
    if (user?.id) needed.add(user.id);
  }
  for (const id of getOrderedAdminIds(room)) needed.add(id);
  if (room.creatorId) needed.add(room.creatorId);
  if (room.ownerId) needed.add(room.ownerId);
  for (const id of room.mutedUserIds || []) needed.add(id);
  if (room.memberTiers && typeof room.memberTiers === 'object') {
    for (const id of Object.keys(room.memberTiers)) needed.add(id);
  }
  for (const item of room.queue || []) {
    if (item?.requestedById) needed.add(item.requestedById);
  }
  if (room.current?.requestedById) needed.add(room.current.requestedById);

  const out = {};
  for (const id of needed) {
    const nick = map.get(id);
    if (nick) out[id] = nick;
  }
  return Object.keys(out).length ? out : undefined;
}

function resolveStoredNickname(room, userId) {
  const online = room.users.get(userId);
  if (online?.nickname) return online.nickname;
  const stored = room.userNicknames?.get(userId);
  if (stored) return stored;
  for (let i = room.messages.length - 1; i >= 0; i -= 1) {
    const message = room.messages[i];
    if (message.userId === userId && message.nickname) return message.nickname;
  }
  return '用户';
}

function getOnlineAdminIds(room) {
  return getOrderedAdminIds(room).filter((id) => isEligibleOwner(room.users.get(id)));
}

/** 对外 adminIds：仅房主指定的正式管理（不含自动提升） */
function getOrderedAdminIds(room) {
  return getAppointedAdminIds(room);
}

function getOrderedAutoPromotedAdminIds(room) {
  pruneAdminIds(room);
  const admins = ensureAdminIds(room);
  return Array.from(ensureAutoPromotedAdminIds(room))
    .filter((id) => admins.has(id))
    .sort((a, b) => (room.users.get(a)?.joinedAt || 0) - (room.users.get(b)?.joinedAt || 0));
}

function isAdminUser(room, userId) {
  if (!userId) return false;
  pruneAdminIds(room);
  return room.adminIds.has(userId);
}

function canControlPlayback(room, userId) {
  if (!room || !userId) return false;
  const user = room.users.get(userId);
  if (!isEligibleOwner(user)) return false;
  if (isRoomCreator(room, userId)) return true;
  return isAdminUser(room, userId);
}

/** 管理权（踢人/禁言/公告等）：仅创建者与正式指定管理；临时自动提升只有播放控制权 */
function canModerate(room, userId) {
  if (!room || !userId) return false;
  const user = room.users.get(userId);
  if (!isEligibleOwner(user)) return false;
  if (isRoomCreator(room, userId)) return true;
  return isAppointedAdmin(room, userId);
}

/** 操作者必须在线且 connectionId 属于本人，防止串连接提权（connectionId 必填） */
function isActorConnection(room, userId, connectionId = null) {
  const user = room.users.get(userId);
  if (!isEligibleOwner(user)) return false;
  if (connectionId == null || connectionId === '') return false;
  const ids = user.connectionIds;
  return Boolean((ids && ids.has(connectionId)) || user.connectionId === connectionId);
}

function requireModerator(room, actorId, connectionId = null) {
  if (!canModerate(room, actorId)) return { error: '仅房主或管理员可操作' };
  if (!isActorConnection(room, actorId, connectionId)) return { error: '会话无效，请刷新后重试' };
  return null;
}

function requireCreator(room, actorId, connectionId = null) {
  if (!isCreatorConnection(room, actorId, connectionId)) {
    return { error: '仅房间创建者可操作' };
  }
  return null;
}

function canUserRequestSong(room, userId) {
  if (!room || !userId) return false;
  if (room.songRequestEnabled !== false) return true;
  return canControlPlayback(room, userId);
}

const MAX_ANNOUNCEMENT_LENGTH = 2000;
const MAX_SONG_REQUEST_MIN_STAY_SEC = 24 * 60 * 60;
const MAX_SONG_REQUEST_PER_USER = 50;

function normalizeSongRequestMinStaySec(value) {
  const sec = Math.floor(Number(value) || 0);
  if (!Number.isFinite(sec) || sec < 0) return 0;
  return Math.min(sec, MAX_SONG_REQUEST_MIN_STAY_SEC);
}

function normalizeSongRequestMaxPerUser(value) {
  const count = Math.floor(Number(value) || 0);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(count, MAX_SONG_REQUEST_PER_USER);
}

function normalizeSongRequestCooldownSec(value) {
  const sec = Math.floor(Number(value) || 0);
  if (!ALLOWED_SONG_REQUEST_COOLDOWNS_SEC.includes(sec)) return 0;
  return sec;
}

function normalizeQueueMaxLength(value) {
  const length = Math.floor(Number(value) || DEFAULT_QUEUE_MAX_LENGTH);
  if (!ALLOWED_QUEUE_MAX_LENGTHS.includes(length)) return DEFAULT_QUEUE_MAX_LENGTH;
  return length;
}

function normalizeDislikeSkipThreshold(value) {
  const count = Math.floor(Number(value));
  if (!Number.isFinite(count) || count < 1) return DEFAULT_DISLIKE_SKIP_THRESHOLD;
  return Math.min(count, MAX_DISLIKE_SKIP_THRESHOLD);
}

function normalizeDislikeSkipMode(value) {
  return value === 'percent' ? 'percent' : 'count';
}

function normalizeDislikeSkipPercent(value) {
  const pct = Math.floor(Number(value));
  if (!Number.isFinite(pct) || pct < 1) return DEFAULT_DISLIKE_SKIP_PERCENT;
  return Math.min(pct, 100);
}

function resolveDislikeSkipThreshold(room) {
  const mode = normalizeDislikeSkipMode(room?.dislikeSkipMode);
  if (mode === 'percent') {
    const userCount = Math.max(1, room.users?.size ?? 0);
    const percent = normalizeDislikeSkipPercent(room.dislikeSkipPercent);
    return Math.max(1, Math.ceil(userCount * percent / 100));
  }
  return normalizeDislikeSkipThreshold(room.dislikeSkipThreshold);
}

function normalizeClearSongsOnLeaveDelaySec(value) {
  const sec = Math.floor(Number(value));
  if (!Number.isFinite(sec) || sec < 0) return DEFAULT_CLEAR_SONGS_ON_LEAVE_DELAY_SEC;
  return Math.min(sec, MAX_CLEAR_SONGS_ON_LEAVE_DELAY_SEC);
}

function ensurePendingLeaveClears(room) {
  if (!room.pendingLeaveClears) room.pendingLeaveClears = new Map();
  return room.pendingLeaveClears;
}

function cancelPendingLeaveClear(room, userId) {
  const pending = ensurePendingLeaveClears(room);
  const timer = pending.get(userId);
  if (timer) {
    clearTimeout(timer);
    pending.delete(userId);
  }
}

function clearAllPendingLeaveClears(room) {
  const pending = ensurePendingLeaveClears(room);
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
}

function removeUserSongsFromQueue(room, userId) {
  if (!room || !userId) return false;
  const removedIds = new Set();
  for (const item of room.queue) {
    if (item.requestedById === userId) removedIds.add(item.queueId);
  }
  if (removedIds.size === 0) return false;
  room.queue = room.queue.filter((item) => item.requestedById !== userId);
  room.jumpRequests = room.jumpRequests.filter((r) => !removedIds.has(r.queueId));
  return true;
}

function scheduleClearUserSongsOnLeave(room, userId) {
  if (!room?.clearSongsOnLeaveEnabled || !userId) return;
  cancelPendingLeaveClear(room, userId);
  const delayMs = normalizeClearSongsOnLeaveDelaySec(room.clearSongsOnLeaveDelaySec) * 1000;
  const pending = ensurePendingLeaveClears(room);
  const timer = setTimeout(() => {
    pending.delete(userId);
    const current = rooms.get(room.id);
    if (!current || current.users.has(userId)) return;
    if (!removeUserSongsFromQueue(current, userId)) return;
    persistRoom(current);
    notifyRoomStructureChanged(current.id);
  }, delayMs);
  pending.set(userId, timer);
}

function getRoomQueueMaxLength(room) {
  return normalizeQueueMaxLength(room?.queueMaxLength);
}

function ensureLastSongRequestAt(room) {
  if (!room.lastSongRequestAt) room.lastSongRequestAt = new Map();
  return room.lastSongRequestAt;
}

function ensureBannedSongs(room) {
  if (!Array.isArray(room.bannedSongs)) room.bannedSongs = [];
  return room.bannedSongs;
}

function normalizeBannedSongName(name) {
  return String(name || '').trim().toLowerCase();
}

function serializeBannedSong(entry) {
  const name = String(entry?.name || '').trim().slice(0, 120);
  if (!name) return null;
  return {
    source: String(entry.source || 'netease'),
    id: String(entry.id || name),
    name,
    artist: String(entry.artist || '').slice(0, 120),
    bannedAt: Number(entry.bannedAt) || Date.now(),
  };
}

function serializeBannedSongs(list) {
  return ensureBannedSongs({ bannedSongs: list })
    .map(serializeBannedSong)
    .filter(Boolean)
    .slice(0, MAX_BANNED_SONGS);
}

function restoreBannedSongs(list) {
  return serializeBannedSongs(Array.isArray(list) ? list : []);
}

function isSongBanned(room, song) {
  const name = normalizeBannedSongName(song?.name);
  if (!name) return false;
  return ensureBannedSongs(room).some(
    (entry) => normalizeBannedSongName(entry.name) === name,
  );
}

function formatSongRequestCooldownError(remainSec) {
  const sec = Math.ceil(Math.max(1, remainSec));
  return `点歌冷却中，还需等待 ${sec} 秒`;
}

function trimQueueToMaxLength(room) {
  const maxLength = getRoomQueueMaxLength(room);
  if (room.queue.length <= maxLength) return;
  sortQueueByPriority(room);
  room.queue.splice(maxLength);
}

function countUserRequestedSongs(room, userId) {
  const user = room.users.get(userId);
  let count = 0;
  if (room.current && isQueueRequester(room.current, userId, user)) count += 1;
  for (const item of room.queue) {
    if (isQueueRequester(item, userId, user)) count += 1;
  }
  return count;
}

function formatSongRequestMinStayError(remainSec) {
  const sec = Math.ceil(Math.max(1, remainSec));
  if (sec < 60) return `还需等待 ${sec} 秒才能点歌`;
  const minutes = Math.ceil(sec / 60);
  return minutes <= 1 ? '还需等待 1 分钟才能点歌' : `还需等待 ${minutes} 分钟才能点歌`;
}

function removeUserFromAdmins(room, userId) {
  if (!userId) return;
  ensureAdminIds(room).delete(userId);
  ensureAutoPromotedAdminIds(room).delete(userId);
}

function sanitizeCreatorId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{8,64}$/.test(id) ? id : '';
}

/** 记录房间创建者（首个可操控的非只读用户，或由创建房间 API 指定，持久保留；不可被后续请求覆盖） */
function ensureCreatorId(room, userId) {
  if (room.creatorId) return;
  const safeId = sanitizeCreatorId(userId);
  if (!safeId) return;
  const user = room.users.get(safeId);
  if (isEligibleOwner(user)) {
    room.creatorId = safeId;
  }
}

/**
 * 刷新播放主控：初创房主在线时由其驱动；离线时由正式指定管理接管。
 * 指定管理回到房间时，立刻收回自动提升的临时管理。
 * 仅当房主与正式管理都不在时，才临时提升最早进房的成员（播放控制 + 管理角标）。
 */
function refreshRoomOwner(room, options = {}) {
  const { preferCreator = false } = options;

  const creator = room.creatorId ? room.users.get(room.creatorId) : null;
  const creatorOnline = isEligibleOwner(creator);

  if ((preferCreator || creatorOnline) && creatorOnline) {
    revokeAutoPromotedAdmins(room);
    room.ownerId = room.creatorId;
    refreshOwnerConnection(room);
    return;
  }

  const onlineAppointed = getOnlineAppointedAdminIds(room);
  if (onlineAppointed.length > 0) {
    // 指定管理已在场：收回所有临时自动提升
    revokeAutoPromotedAdmins(room);
    room.ownerId = onlineAppointed[0];
    refreshOwnerConnection(room);
    return;
  }

  // 仍有在线临时管理时只保留最早一人，其余收回
  const onlineTemps = getOrderedAutoPromotedAdminIds(room)
    .filter((id) => isEligibleOwner(room.users.get(id)));
  if (onlineTemps.length > 0) {
    const keepId = onlineTemps[0];
    ensureSingleAutoPromotedAdmin(room, keepId);
    room.ownerId = keepId;
    refreshOwnerConnection(room);
    return;
  }

  const nextId = getNextOwnerId(room);
  if (nextId) {
    // 先清空旧临时管理，再只提升一人
    revokeAutoPromotedAdmins(room);
    ensureAdminIds(room).add(nextId);
    ensureAutoPromotedAdminIds(room).add(nextId);
    room.ownerId = nextId;
  } else {
    revokeAutoPromotedAdmins(room);
    room.ownerId = null;
  }
  refreshOwnerConnection(room);

  // 兜底：主控离线或未设置时，强制从在线成员提升（防止房间无主控）
  if (!isEligibleOwner(room.users.get(room.ownerId))) {
    const fallbackId = getNextOwnerId(room);
    if (fallbackId) {
      revokeAutoPromotedAdmins(room);
      if (fallbackId !== room.creatorId && !isAppointedAdmin(room, fallbackId)) {
        ensureAdminIds(room).add(fallbackId);
        ensureAutoPromotedAdminIds(room).add(fallbackId);
      }
      room.ownerId = fallbackId;
      refreshOwnerConnection(room);
    }
  }
}

function getDefaultNickname(room) {
  const used = new Set(Array.from(room.users.values()).map((user) => user.nickname));
  for (let i = 1; i <= room.users.size + 100; i++) {
    const nickname = `听众${i}`;
    if (!used.has(nickname)) return nickname;
  }
  return `听众${Date.now().toString(36).slice(-4)}`;
}

function getOwnerConnectionId(room) {
  const owner = room.ownerId ? room.users.get(room.ownerId) : null;
  return owner?.connectionIds?.values().next().value || owner?.connectionId || null;
}

function refreshOwnerConnection(room) {
  room.ownerConnectionId = getOwnerConnectionId(room);
}

function normalizeConnectionIds(existing, connectionId) {
  const ids = new Set(existing?.connectionIds || []);
  if (existing?.connectionId) ids.add(existing.connectionId);
  if (connectionId) ids.add(connectionId);
  return ids;
}

function freezePlayback(room) {
  if (!room?.current || !room.isPlaying) return;
  room.currentTime = getPlaybackTime(room);
  room.isPlaying = false;
  room.startedAt = null;
  bumpPlaybackState(room);
}

function getSongDurationSeconds(song) {
  const durationMs = Number(song?.duration || 0);
  if (Number.isFinite(durationMs) && durationMs > 0) return durationMs / 1000;
  return 0;
}

export function createRoom({ name, password, creatorId } = {}) {
  let roomId;
  do {
    roomId = generateRoomId();
  } while (rooms.has(roomId));

  const trimmed = normalizeRoomPasswordInput(password);
  const passwordHash = trimmed ? hashPassword(trimmed) : null;
  const room = createEmptyRoom(roomId, name, passwordHash);
  const reservedCreator = sanitizeCreatorId(creatorId);
  if (reservedCreator) {
    room.creatorId = reservedCreator;
  }
  rooms.set(roomId, room);
  persistRoom(room);
  invalidateRoomsListCache();
  return serializeRoom(room);
}

export function listRooms() {
  const now = Date.now();
  if (cachedListRooms && now - cachedListRoomsAt < LIST_ROOMS_CACHE_MS) {
    return cachedListRooms;
  }

  cachedListRooms = Array.from(rooms.values())
    .filter(isRoomVisibleInLobby)
    .map(serializeRoomSummary)
    .sort((a, b) => b.userCount - a.userCount || b.createdAt - a.createdAt);
  cachedListRoomsAt = now;
  return cachedListRooms;
}

export function listRoomIds() {
  return Array.from(rooms.keys());
}

// 管理后台：全量房间列表（不过滤大厅隐藏房间，附带成员昵称）
export function listRoomsForAdmin() {
  return Array.from(rooms.values())
    .map((room) => ({
      id: room.id,
      name: room.name,
      userCount: room.users.size,
      users: Array.from(room.users.values()).map((u) => ({ id: u.id, nickname: u.nickname })),
      hasPassword: Boolean(room.passwordHash),
      isLocked: Boolean(room.isLocked),
      isPlaying: room.isPlaying,
      currentSong: room.current
        ? { name: room.current.name, artist: room.current.artist }
        : null,
      queueLength: room.queue.length,
      createdAt: room.createdAt,
    }))
    .sort((a, b) => b.userCount - a.userCount || b.createdAt - a.createdAt);
}

// 管理后台：立即解散房间（调用方负责先踢出房内 socket）
export function adminDestroyRoom(roomId) {
  const id = roomId?.toUpperCase();
  const room = rooms.get(id);
  if (!room) return { success: false, error: '房间不存在' };
  const name = room.name;
  cancelRoomDestroy(room);
  clearAllPendingLeaveClears(room);
  clearSkipRequestExpiryTimersForRoom(id);
  rooms.delete(id);
  invalidateRoomsListCache();
  void deleteRoomChatImages(id).finally(() => {
    void deleteRoomFromStorage(id);
  });
  return { success: true, name };
}

export function getRoomPublic(roomId) {
  const room = rooms.get(roomId?.toUpperCase());
  if (!room) return null;
  return {
    id: room.id,
    name: room.name,
    hasPassword: Boolean(room.passwordHash),
    isLocked: Boolean(room.isLocked),
    userCount: room.users.size,
    isPlaying: room.isPlaying,
    currentSong: room.current
      ? { name: room.current.name, artist: room.current.artist }
      : null,
    queueLength: room.queue.length,
    createdAt: room.createdAt,
  };
}

export function getRoom(roomId) {
  const room = rooms.get(roomId?.toUpperCase());
  return room ? serializeRoom(room) : null;
}

export function roomExists(roomId) {
  return rooms.has(roomId?.toUpperCase());
}

export function isUserBanned(roomId, userId, deviceId = null) {
  const room = rooms.get(roomId?.toUpperCase());
  if (!room || !userId) return false;
  return isAccessBanned(room, userId, deviceId);
}

function restoreChatVisibleSinceMap(raw) {
  const map = new Map();
  if (!raw || typeof raw !== 'object') return map;
  for (const [userId, value] of Object.entries(raw)) {
    const ts = Number(value);
    if (userId && Number.isFinite(ts) && ts > 0) map.set(userId, ts);
  }
  return map;
}

/** 新用户首进时间戳：默认只看进房之后的消息；房间开启「历史可见」时不截断 */
function resolveChatVisibleSince(room, userId, existingUser) {
  if (!room.chatVisibleSinceByUserId) room.chatVisibleSinceByUserId = new Map();

  if (room.chatHistoryVisibleOnJoin) {
    room.chatVisibleSinceByUserId.delete(userId);
    return 0;
  }

  const stored = room.chatVisibleSinceByUserId.get(userId);
  if (Number.isFinite(stored) && stored > 0) return stored;
  if (Number.isFinite(existingUser?.chatVisibleSince) && existingUser.chatVisibleSince > 0) {
    room.chatVisibleSinceByUserId.set(userId, existingUser.chatVisibleSince);
    return existingUser.chatVisibleSince;
  }
  const since = Date.now();
  room.chatVisibleSinceByUserId.set(userId, since);
  return since;
}

function countActiveUsersByIp(room, clientIp, excludeUserId = null) {
  if (!room || !clientIp) return 0;
  let count = 0;
  for (const [userId, user] of room.users) {
    if (excludeUserId && userId === excludeUserId) continue;
    if (user.readOnly) continue;
    if (user.clientIp === clientIp) count += 1;
  }
  return count;
}

export function addUser(roomId, userId, nickname, options = {}) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const deviceId = options.deviceId || null;
  if (isAccessBanned(room, userId, deviceId)) {
    return { error: '你已被移出该房间，无法再次进入' };
  }

  cancelRoomDestroy(room);
  cancelPendingLeaveClear(room, userId);

  const existing = room.users.get(userId);
  const clientIp = String(options.clientIp || existing?.clientIp || '').trim() || null;
  if (clientIp && !options.readOnly) {
    const othersFromSameIp = countActiveUsersByIp(room, clientIp, userId);
    if (othersFromSameIp >= MAX_ACCOUNTS_PER_IP_PER_ROOM) {
      return { error: '同一网络下最多 2 个账号同时在房间内，请先退出其他窗口后再试' };
    }
  }

  const connectionIds = normalizeConnectionIds(existing, options.connectionId || null);
  if (!room.knownUserIds) room.knownUserIds = new Set();
  room.knownUserIds.add(userId);

  const resolvedNickname = ensureUniqueNickname(
    room,
    userId,
    normalizeNickname(nickname) || existing?.nickname || getDefaultNickname(room),
  );

  const readOnly = Boolean(options.readOnly);
  const chatVisibleSince = resolveChatVisibleSince(room, userId, existing);

  room.users.set(userId, {
    id: userId,
    nickname: resolvedNickname,
    readOnly,
    joinedAt: existing?.joinedAt || Date.now(),
    connectionId: options.connectionId || null,
    connectionIds,
    location: String(options.location || existing?.location || '').trim().slice(0, 12),
    clientIp,
    chatVisibleSince,
  });
  rememberUserNickname(room, userId, resolvedNickname);

  reassignOrphanQueueOwnership(room, userId, resolvedNickname);

  ensureCreatorId(room, userId);
  refreshRoomOwner(room, { preferCreator: room.creatorId === userId });
  if (room.creatorId === userId) {
    refreshOwnerConnection(room);
  }
  if (room.isPlaying && room.current && !room.startedAt) {
    room.startedAt = Date.now() - (room.currentTime || 0) * 1000;
  }

  persistRoom(room);
  invalidateRoomsListCache();
  return serializeRoom(room, { forUserId: userId });
}

function normalizeNickname(nickname) {
  return String(nickname || '').trim().slice(0, 20);
}

function getUsedNicknames(room, excludeUserId = null) {
  const used = new Set();
  for (const user of room.users.values()) {
    if (excludeUserId && user.id === excludeUserId) continue;
    if (user.nickname) used.add(user.nickname);
  }
  return used;
}

/** 房间内昵称唯一；重名时后进入者在原名后追加 1、2、3… */
function ensureUniqueNickname(room, userId, preferred) {
  const base = normalizeNickname(preferred);
  if (!base) return getDefaultNickname(room);

  const used = getUsedNicknames(room, userId);
  if (!used.has(base)) return base;

  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const candidate = `${base}${suffix}`.slice(0, 20);
    if (!used.has(candidate)) return candidate;
  }

  return `${base.slice(0, 14)}${Date.now().toString(36).slice(-5)}`.slice(0, 20);
}

function updateRequesterNickname(item, socketId, nickname) {
  if (item?.requestedById === socketId) {
    item.requestedBy = nickname;
  }
}

function reassignOrphanQueueOwnership(room, userId, nickname) {
  const normalizedNick = normalizeNickname(nickname);
  if (!normalizedNick) return;

  const reclaim = (item) => {
    if (!item) return;
    if (item.requestedById === userId) {
      item.requestedBy = normalizedNick;
      return;
    }
    if (item.requestedById) return;
    if (item.requestedBy !== normalizedNick) return;
    const owners = Array.from(room.users.values()).filter((user) => user.nickname === normalizedNick);
    if (owners.length === 1 && owners[0].id === userId) {
      item.requestedById = userId;
    }
  };

  reclaim(room.current);
  room.queue.forEach(reclaim);
}

function isQueueRequester(item, socketId, user) {
  if (!item) return false;
  if (item.requestedById) return item.requestedById === socketId;
  return item.requestedBy === user?.nickname;
}

function isRoomCreator(room, userId) {
  return Boolean(room?.creatorId && userId === room.creatorId);
}

export function renameRoom(roomId, actorId, name, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  const denied = requireCreator(room, actorId, connectionId);
  if (denied) return denied;

  room.name = normalizeRoomName(name, room.id);
  persistRoom(room);
  invalidateRoomsListCache();
  return { room: serializeRoom(room) };
}

export function setRoomLock(roomId, actorId, options = {}, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  const denied = requireCreator(room, actorId, connectionId);
  if (denied) return denied;

  const locked = Boolean(options.locked);
  if (!locked) {
    room.isLocked = false;
    room.passwordHash = null;
  } else {
    room.isLocked = true;
    const trimmed = normalizeRoomPasswordInput(options.password);
    room.passwordHash = trimmed ? hashPassword(trimmed) : null;
  }

  persistRoom(room);
  invalidateRoomsListCache();
  return { room: serializeRoom(room) };
}

export function setRoomAdmin(roomId, actorId, targetUserId, admin = true, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  // 仅房间创建者可任免管理员；临时主控 / 自动提升不可升权
  if (!isCreatorConnection(room, actorId, connectionId)) {
    return { error: '仅房间创建者可设置管理员' };
  }

  const targetId = sanitizeCreatorId(targetUserId) || String(targetUserId || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(targetId)) return { error: '无效用户' };
  if (targetId === actorId) return { error: '不能修改自己的管理员状态' };
  if (targetId === room.creatorId) return { error: '房主无需设为管理员' };

  const admins = ensureAdminIds(room);
  const auto = ensureAutoPromotedAdminIds(room);
  const target = room.users.get(targetId);
  const targetLabel = resolveStoredNickname(room, targetId);
  const appointedCount = getAppointedAdminIds(room).length;

  if (admin) {
    if (!target) return { error: '用户不在房间中' };
    if (!isEligibleOwner(target)) return { error: '不能设置 TV 用户为管理员' };
    if (isAppointedAdmin(room, targetId)) {
      return { room: serializeRoom(room) };
    }
    if (appointedCount >= MAX_ADMINS) return { error: '管理员最多 3 人' };
    admins.add(targetId);
    auto.delete(targetId);
    if (room.memberTiers?.has(targetId)) {
      room.memberTiers.delete(targetId);
    }
  } else {
    if (!admins.has(targetId) && !auto.has(targetId)) {
      return { room: serializeRoom(room) };
    }
    admins.delete(targetId);
    auto.delete(targetId);
  }

  refreshRoomOwner(room);
  persistRoom(room);
  invalidateRoomsListCache();
  return {
    room: serializeRoom(room),
    message: admin ? `已将「${targetLabel}」设为管理员` : `已取消「${targetLabel}」的管理员`,
  };
}

export function setRoomFmMode(roomId, actorId, mode, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  if (!isOwnerConnection(room, actorId, connectionId)) return { error: '仅房主可调整漫游模式' };

  const nextMode = normalizeFmMode(mode);
  if (room.neteaseFmMode === nextMode) {
    return { room: serializeRoom(room) };
  }

  // 记住关闭前的模式，重新开启时恢复
  if (nextMode === FM_MODE_OFF && room.neteaseFmMode !== FM_MODE_OFF) {
    room.fmModeBeforeOff = normalizeFmMode(room.neteaseFmMode);
  }
  room.neteaseFmMode = nextMode;
  clearNextRandom(room);
  persistRoom(room);
  invalidateRoomsListCache();

  if (!room.current && room.queue.length === 0) {
    void ensureNextRandom(room);
  }

  return { room: serializeRoom(room) };
}

export function setRoomAudioQuality(roomId, actorId, quality = {}, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  if (!isOwnerConnection(room, actorId, connectionId)) return { error: '仅房主可调整音质' };

  const current = normalizeRoomAudioQuality(room.audioQuality);
  room.audioQuality = normalizeRoomAudioQuality({
    netease: quality.netease ?? current.netease,
    tencent: quality.tencent ?? current.tencent,
  });
  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function setRoomMemberTier(roomId, actorId, targetUserId, payload = {}, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  if (!isOwnerConnection(room, actorId, connectionId)) return { error: '仅房主可设置贵宾角标' };

  const userId = String(targetUserId || '').trim();
  if (!userId) return { error: '无效用户' };
  if (userId === room.creatorId) return { error: '房主无需设置贵宾角标' };

  if (!room.memberTiers) room.memberTiers = new Map();
  const normalized = normalizeIncomingMemberTier(payload);
  room.memberTiers.set(userId, serializeMemberTier(userId, {
    ...normalized,
    assignedAt: Date.now(),
  }));

  persistRoom(room);
  invalidateRoomsListCache();
  return { room: serializeRoom(room) };
}

export function removeRoomMemberTier(roomId, actorId, targetUserId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  if (!isOwnerConnection(room, actorId, connectionId)) return { error: '仅房主可移除贵宾角标' };

  const userId = String(targetUserId || '').trim();
  if (!userId) return { error: '无效用户' };
  if (!room.memberTiers?.has(userId)) return { error: '该用户不是贵宾' };

  room.memberTiers.delete(userId);
  persistRoom(room);
  invalidateRoomsListCache();
  return { room: serializeRoom(room) };
}

export function setRoomMemberSettings(roomId, actorId, settings = {}, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  if (!isOwnerConnection(room, actorId, connectionId)) return { error: '仅房主可调整贵宾设置' };

  room.memberSettings = normalizeMemberSettings({
    ...normalizeMemberSettings(room.memberSettings),
    ...settings,
  });
  persistRoom(room);
  return { room: serializeRoom(room) };
}

const MEMBER_WELCOME_COOLDOWN_MS = 5 * 60 * 1000;

function hasRecentMemberWelcome(room, userId) {
  if (!room?.messages?.length || !userId) return false;
  const now = Date.now();
  for (let i = room.messages.length - 1; i >= 0; i -= 1) {
    const message = room.messages[i];
    if (message.kind !== 'welcome' || message.targetUserId !== userId) continue;
    return now - message.timestamp < MEMBER_WELCOME_COOLDOWN_MS;
  }
  return false;
}

export function postMemberWelcomeMessage(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room || !userId) return null;

  const tier = room.memberTiers?.get(userId);
  if (!tier) return null;

  const settings = normalizeMemberSettings(room.memberSettings);
  if (!settings.welcomeEnabled) return null;

  if (hasRecentMemberWelcome(room, userId)) return null;

  const user = room.users.get(userId);
  const nickname = user?.nickname || room.userNicknames?.get(userId) || '贵宾';
  const message = {
    id: generateId(),
    userId: 'system',
    nickname: '房间迎宾',
    text: buildWelcomeText(settings, tier, nickname),
    kind: 'welcome',
    mentions: [],
    replyTo: null,
    timestamp: Date.now(),
    memberTier: {
      badgeLabel: tier.badgeLabel,
      badgeColor: tier.badgeColor,
      borderStyleId: tier.borderStyleId,
      borderColor: tier.borderColor,
    },
    targetUserId: userId,
    targetNickname: nickname,
  };

  room.messages.push(message);
  if (room.messages.length > MAX_CHAT_MESSAGES) {
    room.messages.splice(0, room.messages.length - MAX_CHAT_MESSAGES);
  }
  persistRoom(room);
  return serializeChatMessage(message);
}

function formatSongTitle(song) {
  const name = String(song?.name || '').trim() || '未知歌曲';
  return `《${name.slice(0, 40)}》`;
}

function formatActorName(user) {
  return String(user?.nickname || '匿名').trim().slice(0, 20) || '匿名';
}

/** 聊天室顶部短暂系统提示（点歌/点赞等，不落盘、不进消息列表） */
function appendSystemChatMessage(room, text) {
  if (!room) return null;
  const content = String(text || '').trim().slice(0, 200);
  if (!content) return null;

  const message = {
    id: generateId(),
    userId: 'system',
    nickname: '系统',
    text: content,
    kind: 'system',
    mentions: [],
    replyTo: null,
    timestamp: Date.now(),
  };

  return serializeChatMessage(message);
}

/** 撤回提示：落盘并常驻聊天列表 */
function appendRecallChatMessage(room, text) {
  if (!room) return null;
  const content = String(text || '').trim().slice(0, 200);
  if (!content) return null;

  const message = {
    id: generateId(),
    userId: 'system',
    nickname: '系统',
    text: content,
    kind: 'recall',
    mentions: [],
    replyTo: null,
    timestamp: Date.now(),
  };

  room.messages.push(message);
  if (room.messages.length > MAX_CHAT_MESSAGES) {
    room.messages.splice(0, room.messages.length - MAX_CHAT_MESSAGES);
  }
  persistRoom(room);
  return serializeChatMessage(message);
}

function isUserChatMuted(room, userId) {
  if (!room || !userId) return false;
  if (isRoomCreator(room, userId)) return false;
  if (room.muteAll) return true;
  return room.mutedUserIds?.has(userId) ?? false;
}

const MENTION_ALL_LABEL = '全体成员';

function hasMentionAllInText(text) {
  return new RegExp(`@${MENTION_ALL_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(String(text || ''));
}

function buildMentionAllTargets(room, senderId) {
  return [...room.users.values()]
    .filter((user) => user.id !== senderId && !user.readOnly)
    .map((user) => ({ id: user.id, nickname: user.nickname || '匿名' }));
}

export function setChatMute(roomId, actorId, options = {}, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  if (!room.mutedUserIds) room.mutedUserIds = new Set();

  if (options.muteAll !== undefined) {
    // 全体禁言：仅创建者；指定管理不可借此锁死房间
    if (!isRoomCreator(room, actorId)) {
      return { error: '仅房间创建者可设置全体禁言' };
    }
    room.muteAll = Boolean(options.muteAll);
  }

  if (options.userId && options.muted !== undefined) {
    const targetId = String(options.userId).trim();
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(targetId)) return { error: '无效用户' };
    if (isRoomCreator(room, targetId)) {
      return { error: '不能禁言房间创建者' };
    }
    if (isAppointedAdmin(room, targetId) || isAutoPromotedAdmin(room, targetId)) {
      if (!isRoomCreator(room, actorId)) {
        return { error: '仅房主可禁言管理员' };
      }
    }
    // 解禁：仅创建者可解，防止管理撤销房主禁言实现「变相提权」
    if (!options.muted && !isRoomCreator(room, actorId)) {
      return { error: '仅房主可解除禁言' };
    }
    if (options.muted) {
      room.mutedUserIds.add(targetId);
    } else {
      room.mutedUserIds.delete(targetId);
    }
  }

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function setRoomAnnouncement(roomId, actorId, options = {}, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  if (options.enabled !== undefined) {
    room.announcementEnabled = Boolean(options.enabled);
  }
  if (options.text !== undefined) {
    room.announcementText = String(options.text || '').trim().slice(0, MAX_ANNOUNCEMENT_LENGTH);
  }

  persistRoom(room);
  return { room: serializeRoom(room) };
}

/** 进房是否可查看聊天历史 */
export function setChatHistoryVisibleOnJoin(roomId, actorId, enabled, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  const next = Boolean(enabled);
  room.chatHistoryVisibleOnJoin = next;

  if (next) {
    // 开启后清除进房截断，当前在房成员也可立刻看到历史
    room.chatVisibleSinceByUserId = new Map();
    for (const user of room.users.values()) {
      user.chatVisibleSince = 0;
    }
  }

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function setSongRequestEnabled(roomId, actorId, options = {}, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  if (options.enabled !== undefined) {
    room.songRequestEnabled = Boolean(options.enabled);
  }
  if (options.minStaySec !== undefined) {
    room.songRequestMinStaySec = normalizeSongRequestMinStaySec(options.minStaySec);
  }
  if (options.maxPerUser !== undefined) {
    room.songRequestMaxPerUser = normalizeSongRequestMaxPerUser(options.maxPerUser);
  }
  if (options.cooldownSec !== undefined) {
    room.songRequestCooldownSec = normalizeSongRequestCooldownSec(options.cooldownSec);
  }
  if (options.queueMaxLength !== undefined) {
    room.queueMaxLength = normalizeQueueMaxLength(options.queueMaxLength);
    trimQueueToMaxLength(room);
  }
  if (options.memberJumpEnabled !== undefined) {
    room.memberJumpEnabled = Boolean(options.memberJumpEnabled);
  }
  if (options.memberSeekEnabled !== undefined) {
    room.memberSeekEnabled = Boolean(options.memberSeekEnabled);
  }
  if (options.memberPauseEnabled !== undefined) {
    room.memberPauseEnabled = Boolean(options.memberPauseEnabled);
  }
  if (options.systemMediaPlayBound !== undefined) {
    room.systemMediaPlayBound = Boolean(options.systemMediaPlayBound);
  }
  if (options.systemMediaSkipBound !== undefined) {
    room.systemMediaSkipBound = Boolean(options.systemMediaSkipBound);
  }
  if (options.dislikeSkipMode !== undefined) {
    room.dislikeSkipMode = normalizeDislikeSkipMode(options.dislikeSkipMode);
  }
  if (options.dislikeSkipThreshold !== undefined) {
    room.dislikeSkipThreshold = normalizeDislikeSkipThreshold(options.dislikeSkipThreshold);
  }
  if (options.dislikeSkipPercent !== undefined) {
    room.dislikeSkipPercent = normalizeDislikeSkipPercent(options.dislikeSkipPercent);
  }
  if (options.clearSongsOnLeaveEnabled !== undefined) {
    room.clearSongsOnLeaveEnabled = Boolean(options.clearSongsOnLeaveEnabled);
  }
  if (options.clearSongsOnLeaveDelaySec !== undefined) {
    room.clearSongsOnLeaveDelaySec = normalizeClearSongsOnLeaveDelaySec(options.clearSongsOnLeaveDelaySec);
  }

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function banRoomSong(roomId, actorId, song, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  const entry = serializeBannedSong({
    source: song?.source,
    id: song?.id,
    name: song?.name,
    artist: song?.artist,
    bannedAt: Date.now(),
  });
  if (!entry) return { error: '歌曲信息无效' };

  const bannedSongs = ensureBannedSongs(room);
  if (!isSongBanned(room, entry)) {
    if (bannedSongs.length >= MAX_BANNED_SONGS) {
      return { error: `禁播列表最多 ${MAX_BANNED_SONGS} 首` };
    }
    bannedSongs.push(entry);
  }

  const bannedName = normalizeBannedSongName(entry.name);
  room.queue = room.queue.filter(
    (item) => normalizeBannedSongName(item.name) !== bannedName,
  );

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function unbanRoomSong(roomId, actorId, name, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;

  const normalized = normalizeBannedSongName(name);
  if (!normalized) return { error: '歌曲信息无效' };

  const before = ensureBannedSongs(room).length;
  room.bannedSongs = ensureBannedSongs(room).filter(
    (entry) => normalizeBannedSongName(entry.name) !== normalized,
  );
  if (room.bannedSongs.length === before) {
    return { error: '歌曲不在禁播列表中' };
  }

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function renameUser(roomId, socketId, nickname) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };

  const user = room.users.get(socketId);
  if (!user) return { error: '未加入房间' };

  const nextNickname = ensureUniqueNickname(room, socketId, nickname);
  if (!nextNickname) return { error: '昵称不能为空' };

  user.nickname = nextNickname;
  rememberUserNickname(room, socketId, nextNickname);
  updateRequesterNickname(room.current, socketId, nextNickname);
  room.queue.forEach((item) => updateRequesterNickname(item, socketId, nextNickname));
  room.jumpRequests.forEach((request) => {
    if (request.requestedBy === socketId) request.nickname = nextNickname;
  });
  room.skipRequests.forEach((request) => {
    if (request.requestedBy === socketId) request.nickname = nextNickname;
  });
  room.messages.forEach((message) => {
    if (message.userId === socketId) {
      message.userId = socketId;
      message.nickname = nextNickname;
    }
    if (message.reactions) {
      for (const users of Object.values(message.reactions)) {
        for (const entry of users) {
          if (entry.userId === socketId) entry.nickname = nextNickname;
        }
      }
    }
  });

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export async function kickUser(roomId, actorId, targetUserId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  const denied = requireModerator(room, actorId, connectionId);
  if (denied) return denied;
  const targetId = String(targetUserId || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(targetId)) return { error: '无效用户' };
  if (targetId === actorId) return { error: '不能踢出自己' };
  if (targetId === room.creatorId) return { error: '不能踢出房间创建者' };
  // 正式/临时管理均不可被普通管理员互踢；仅创建者可踢管理
  if (
    (isAppointedAdmin(room, targetId) || isAutoPromotedAdmin(room, targetId))
    && !isRoomCreator(room, actorId)
  ) {
    return { error: '仅房主可踢出管理员' };
  }

  const target = room.users.get(targetId);
  if (!target) return { error: '用户不在房间中' };

  if (!room.bannedUserIds) room.bannedUserIds = new Set();
  if (!room.bannedDeviceIds) room.bannedDeviceIds = new Set();
  room.bannedUserIds.add(targetId);

  const deviceIds = await collectDeviceIdsForUser(targetId);
  for (const did of deviceIds) {
    room.bannedDeviceIds.add(did);
  }

  room.users.delete(targetId);
  removeUserFromAdmins(room, targetId);

  if (room.users.size === 0) {
    clearAllPendingLeaveClears(room);
    if (room.isPlaying && room.current) {
      room.currentTime = getPlaybackTime(room);
      room.startedAt = null;
      bumpPlaybackState(room);
    } else {
      freezePlayback(room);
    }
    room.ownerId = null;
    room.ownerConnectionId = null;
    persistRoom(room);
    scheduleRoomDestroy(roomId);
    invalidateRoomsListCache();
    return {
      room: serializeRoom(room),
      kickedUserId: targetId,
      kickedNickname: target.nickname,
    };
  }

  refreshRoomOwner(room);
  if (!room.ownerId) {
    freezePlayback(room);
  }

  room.jumpRequests = room.jumpRequests.filter((r) => room.users.has(r.requestedBy));
  room.skipRequests = room.skipRequests.filter((r) => room.users.has(r.requestedBy));
  syncSkipRequestExpiryTimers(room);

  scheduleClearUserSongsOnLeave(room, targetId);

  persistRoom(room);
  invalidateRoomsListCache();
  return {
    room: serializeRoom(room),
    kickedUserId: targetId,
    kickedNickname: target.nickname,
  };
}

export function transferOwner(roomId, actorId, targetUserId, connectionId = null) {
  void roomId;
  void actorId;
  void targetUserId;
  void connectionId;
  return { error: '房主为房间初创者，不可转让' };
}

export function removeUser(roomId, userId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const user = room.users.get(userId);
  if (connectionId && user?.connectionIds?.size && !user.connectionIds.has(connectionId)) {
    return { unchanged: true };
  }

  if (connectionId && user?.connectionIds) {
    user.connectionIds.delete(connectionId);
    if (user.connectionIds.size > 0) {
      if (user.connectionId === connectionId) {
        user.connectionId = user.connectionIds.values().next().value || null;
      }
      refreshOwnerConnection(room);
      persistRoom(room);
      invalidateRoomsListCache();
      // 用户仍在房内，仅少了一条连接：不触发全房 users 风暴
      return { unchanged: true };
    }
  }

  if (!user) return { unchanged: true };

  room.users.delete(userId);
  // 管理员身份在主动离房时保留，重进后恢复；仅踢人时清除（见 kickUser）

  if (room.users.size === 0) {
    clearAllPendingLeaveClears(room);
    // 刷新/断线时房间会短暂无人：保留 isPlaying，仅冻结进度，便于重新进入后继续播放
    if (room.isPlaying && room.current) {
      room.currentTime = getPlaybackTime(room);
      room.startedAt = null;
      bumpPlaybackState(room);
    } else {
      freezePlayback(room);
    }
    room.ownerId = null;
    room.ownerConnectionId = null;
    persistRoom(room);
    scheduleRoomDestroy(roomId);
    invalidateRoomsListCache();
    return { empty: true, userRemoved: true };
  }

  refreshRoomOwner(room);
  if (!room.ownerId) {
    freezePlayback(room);
  }

  room.jumpRequests = room.jumpRequests.filter((r) => room.users.has(r.requestedBy));
  room.skipRequests = room.skipRequests.filter((r) => room.users.has(r.requestedBy));
  syncSkipRequestExpiryTimers(room);

  scheduleClearUserSongsOnLeave(room, userId);

  persistRoom(room);
  invalidateRoomsListCache();
  return { userRemoved: true, room: serializeRoom(room) };
}


export function updateUserLocation(roomId, userId, location) {
  const room = rooms.get(roomId);
  const user = room?.users.get(userId);
  if (!room || !user) return null;

  const nextLocation = String(location || '').trim().slice(0, 12);
  if (user.location === nextLocation) return null;

  user.location = nextLocation;
  // 定位不必立刻落盘，随下一次结构变更 persist 即可
  return true;
}

export function canUserMutate(roomId, userId) {
  const room = rooms.get(roomId);
  const user = room?.users.get(userId);
  return Boolean(room && user && !user.readOnly);
}

function isCreatorConnection(room, userId, connectionId = null) {
  if (!isRoomCreator(room, userId)) return false;
  // connectionId 必填：禁止仅凭 userId / 响应里的 creatorId 冒充房主操作
  return isActorConnection(room, userId, connectionId);
}

function isOwnerConnection(room, userId, connectionId = null) {
  return isCreatorConnection(room, userId, connectionId);
}

function isControllerConnection(room, userId, connectionId = null) {
  if (!canControlPlayback(room, userId)) return false;
  if (!isActorConnection(room, userId, connectionId)) return false;
  return true;
}

/** 房主/管理员始终可；开启 memberSeekEnabled 后普通成员也可调进度 */
function canSeekPlayback(room, userId, connectionId = null) {
  if (isControllerConnection(room, userId, connectionId)) return true;
  if (!room.memberSeekEnabled) return false;
  return isActorConnection(room, userId, connectionId);
}

/** 房主/管理员始终可；开启 memberPauseEnabled 后普通成员也可暂停/播放 */
function canPausePlayback(room, userId, connectionId = null) {
  if (isControllerConnection(room, userId, connectionId)) return true;
  if (!room.memberPauseEnabled) return false;
  return isActorConnection(room, userId, connectionId);
}

function songIdentity(source, id) {
  return `${source || 'netease'}:${id}`;
}

function isSongInPlaylist(room, song) {
  const key = songIdentity(song.source, song.id);
  if (room.current && songIdentity(room.current.source, room.current.id) === key) {
    return true;
  }
  return room.queue.some((item) => songIdentity(item.source, item.id) === key);
}

function getQueueLikes(item) {
  return Array.isArray(item?.likedByIds) ? item.likedByIds.length : 0;
}

function queueHasManualOrder(room) {
  return (room.queue || []).some((song) => Number.isFinite(song?.manualOrder));
}

function reindexManualOrder(room) {
  room.queue.forEach((song, index) => {
    song.manualOrder = index;
  });
}

function sortQueueByPriority(room) {
  const lockedByDrag = queueHasManualOrder(room);
  room.queue.sort((a, b) => {
    // 拖拽排序锁定整队相对顺序，优先于点赞（点赞仍可点，只不再改序）
    if (lockedByDrag) {
      const aOrder = Number.isFinite(a.manualOrder) ? a.manualOrder : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(b.manualOrder) ? b.manualOrder : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
    }
    // 插队 / 单曲拖动标记，优先于点赞
    const priorityDiff = (b.ownerPriority || 0) - (a.ownerPriority || 0);
    if (priorityDiff !== 0) return priorityDiff;
    if (!lockedByDrag) {
      const likeDiff = getQueueLikes(b) - getQueueLikes(a);
      if (likeDiff !== 0) return likeDiff;
    }
    return (a.addedAt || 0) - (b.addedAt || 0);
  });
}

export async function addToQueue(roomId, song, requestedByUser) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };

  const requestedBy = {
    id: requestedByUser?.id || '',
    nickname: requestedByUser?.nickname || '匿名',
  };

  if (!canUserRequestSong(room, requestedBy.id)) {
    return { error: '房主已禁止点歌' };
  }

  if (!canControlPlayback(room, requestedBy.id)) {
    const user = room.users.get(requestedBy.id);
    const minStaySec = normalizeSongRequestMinStaySec(room.songRequestMinStaySec);
    if (minStaySec > 0 && user) {
      const stayedSec = (Date.now() - user.joinedAt) / 1000;
      if (stayedSec < minStaySec) {
        return { error: formatSongRequestMinStayError(minStaySec - stayedSec) };
      }
    }

    const maxPerUser = normalizeSongRequestMaxPerUser(room.songRequestMaxPerUser);
    if (maxPerUser > 0) {
      const count = countUserRequestedSongs(room, requestedBy.id);
      if (count >= maxPerUser) {
        return { error: `每人最多 ${maxPerUser} 首待播，你已达上限` };
      }
    }

    const cooldownSec = normalizeSongRequestCooldownSec(room.songRequestCooldownSec);
    if (cooldownSec > 0) {
      const lastAt = ensureLastSongRequestAt(room).get(requestedBy.id) || 0;
      const elapsedSec = (Date.now() - lastAt) / 1000;
      if (lastAt > 0 && elapsedSec < cooldownSec) {
        return { error: formatSongRequestCooldownError(cooldownSec - elapsedSec) };
      }
    }
  }

  if (isSongBanned(room, song)) {
    return { error: '该歌曲已被禁播' };
  }

  if (isSongInPlaylist(room, song)) {
    return { error: '这首歌已经在歌单里啦' };
  }

  const queueMaxLength = getRoomQueueMaxLength(room);
  if (room.queue.length >= queueMaxLength) {
    return { error: `队列最多保留 ${queueMaxLength} 首歌` };
  }

  const hadManualOrder = queueHasManualOrder(room);
  const item = serializeQueueItemForRoom({
    queueId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...song,
    requestedBy: requestedBy.nickname,
    requestedById: requestedBy.id,
    addedAt: Date.now(),
    likedByIds: [],
    ownerPriority: 0,
  });

  room.queue.push(item);
  if (hadManualOrder) {
    item.manualOrder = room.queue.length - 1;
  }

  if (!canControlPlayback(room, requestedBy.id)) {
    const cooldownSec = normalizeSongRequestCooldownSec(room.songRequestCooldownSec);
    if (cooldownSec > 0) {
      ensureLastSongRequestAt(room).set(requestedBy.id, Date.now());
    }
  }

  if (!room.current) {
    await withPlaybackLock(room, async () => {
      if (!room.current) await playNextUnlocked(room, { allowFetchRandom: true });
    });
  }

  const systemMessage = appendSystemChatMessage(
    room,
    `${formatActorName(requestedBy)} 点了 ${formatSongTitle(item)}`,
  );
  persistRoom(room);
  return { room: serializeRoom(room), systemMessage };
}

export function toggleQueueLike(roomId, userId, queueId) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  const user = room.users.get(userId);
  if (!user) return { error: '未加入房间' };

  const item = room.queue.find((s) => s.queueId === queueId);
  if (!item) return { error: '只能点赞待播放歌曲' };

  const likedByIds = Array.isArray(item.likedByIds) ? item.likedByIds : [];
  const nextLiked = !likedByIds.includes(userId);
  if (nextLiked && isQueueRequester(item, userId, user)) {
    return { error: '不能给自己的歌点赞' };
  }
  item.likedByIds = nextLiked ? [...likedByIds, userId] : likedByIds.filter((id) => id !== userId);
  sortQueueByPriority(room);
  const systemMessage = nextLiked
    ? appendSystemChatMessage(room, `${formatActorName(user)} 点赞了 ${formatSongTitle(item)}`)
    : null;
  persistRoom(room);
  return {
    liked: nextLiked,
    queue: room.queue.map(serializeQueueItemForRoom).filter(Boolean),
    current: serializeQueueItemForRoom(room.current),
    systemMessage,
  };
}

export async function toggleCurrentDislike(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  const user = room.users.get(userId);
  if (!user) return { error: '未加入房间' };
  if (!room.current) return { error: '当前没有正在播放的歌曲' };

  const dislikedByIds = Array.isArray(room.current.dislikedByIds) ? room.current.dislikedByIds : [];
  const nextDisliked = !dislikedByIds.includes(userId);
  room.current.dislikedByIds = nextDisliked
    ? [...dislikedByIds, userId]
    : dislikedByIds.filter((id) => id !== userId);

  const songTitle = formatSongTitle(room.current);
  const mode = normalizeDislikeSkipMode(room.dislikeSkipMode);
  const threshold = resolveDislikeSkipThreshold(room);
  const dislikeCount = room.current.dislikedByIds.length;
  let skipped = false;
  let systemMessage = null;
  if (dislikeCount >= threshold) {
    await playNext(room, { allowFetchRandom: false });
    skipped = true;
    systemMessage = appendSystemChatMessage(
      room,
      `踩歌达到人数，已切掉 ${songTitle}`,
    );
  }

  persistRoom(room);
  return {
    disliked: nextDisliked,
    skipped,
    dislikeCount: skipped ? 0 : dislikeCount,
    threshold,
    dislikeSkipMode: mode,
    dislikeSkipPercent: normalizeDislikeSkipPercent(room.dislikeSkipPercent),
    roomUserCount: room.users.size,
    room: serializeRoom(room),
    systemMessage,
  };
}

export function removeFromQueue(roomId, socketId, queueId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };

  const item = room.queue.find((s) => s.queueId === queueId);
  if (!item) return { error: '歌曲不在队列中' };

  const user = room.users.get(socketId);
  if (!isActorConnection(room, socketId, connectionId)) {
    return { error: '会话无效，请刷新后重试' };
  }
  const canManage = isControllerConnection(room, socketId, connectionId);
  const isRequester = isQueueRequester(item, socketId, user);
  if (!canManage && !isRequester) {
    return { error: '只能删除自己点的歌' };
  }

  const songTitle = formatSongTitle(item);
  room.queue = room.queue.filter((s) => s.queueId !== queueId);
  room.jumpRequests = room.jumpRequests.filter((r) => r.queueId !== queueId);
  if (queueHasManualOrder(room)) {
    reindexManualOrder(room);
  }
  const systemMessage = appendSystemChatMessage(
    room,
    `${formatActorName(user)} 移除了 ${songTitle}`,
  );
  persistRoom(room);
  return { room: serializeRoom(room), systemMessage };
}

export function clearQueue(roomId, userId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };

  if (!isControllerConnection(room, userId, connectionId)) {
    return { error: '仅房主或管理员可清空队列' };
  }

  room.queue = [];
  room.jumpRequests = room.current
    ? room.jumpRequests.filter((r) => r.queueId === room.current.queueId)
    : [];
  clearNextRandom(room);
  persistRoom(room);
  return { room: serializeRoom(room) };
}

// function trimRandomHistory(room) {
//   if (room.randomPlayedKeys.size <= MAX_RANDOM_HISTORY) return;
//   const excess = room.randomPlayedKeys.size - MAX_RANDOM_HISTORY;
//   const iter = room.randomPlayedKeys.values();
//   for (let i = 0; i < excess; i++) {
//     const key = iter.next().value;
//     if (key) room.randomPlayedKeys.delete(key);
//   }
// }

// function recordRandomPlayed(room, song) {
//   room.randomPlayedKeys.add(songIdentity(song.source, song.id));
//   trimRandomHistory(room);
// }

// function getRandomExcludeKeys(room) {
//   const exclude = new Set(room.randomPlayedKeys);
//   if (room.current?.requestedBy === '随机推荐') {
//     exclude.add(songIdentity(room.current.source, room.current.id));
//   }
//   if (room.nextRandom) {
//     exclude.add(songIdentity(room.nextRandom.source, room.nextRandom.id));
//   }
//   return exclude;
// }

function clearNextRandom(room) {
  room.nextRandom = null;
  room.nextRandomPromise = null;
}

// function trimRandomPlayedKeys(room, removeCount) {
//   if (room.randomPlayedKeys.size === 0) return;
//   const keys = Array.from(room.randomPlayedKeys);
//   const count = removeCount ?? Math.max(50, Math.ceil(keys.length / 2));
//   for (let i = 0; i < Math.min(count, keys.length); i++) {
//     room.randomPlayedKeys.delete(keys[i]);
//   }
// }

async function fetchRandomForRoom(room) {
  return fetchMetingFmSong(room.neteaseFmMode || DEFAULT_FM_MODE);
}

async function ensureNextRandom(room) {
  if (room.queue.length > 0) {
    clearNextRandom(room);
    return;
  }
  // 漫游已关闭：不预取，队列放空后自然停止
  if ((room.neteaseFmMode || DEFAULT_FM_MODE) === FM_MODE_OFF) {
    clearNextRandom(room);
    return;
  }
  if (room.nextRandom || room.nextRandomPromise) return;

  room.nextRandomPromise = (async () => {
    try {
      for (let i = 0; i < MAX_RANDOM_PREFETCH_ATTEMPTS && room.queue.length === 0; i++) {
        const song = await fetchRandomForRoom(room);
        if (!song) break;

        // const key = songIdentity(song.source, song.id);
        // if (room.randomPlayedKeys.has(key)) continue;

        room.nextRandom = buildPendingRandomItem(song);
        break;
      }
      persistRoom(room);
      notifyRoomPrefetchReady(room);
    } finally {
      room.nextRandomPromise = null;
    }
  })();

  await room.nextRandomPromise;
}

async function withPlaybackLock(room, task) {
  const previous = room.playbackLock || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  room.playbackLock = current;
  try {
    return await current;
  } finally {
    if (room.playbackLock === current) {
      room.playbackLock = null;
    }
  }
}

function recordSongPlayHistory(room, song) {
  if (!song?.id || !song?.name) return;
  const playedAt = Date.now();
  room.songHistory = [
    serializeSongHistoryForClient({
      id: song.id,
      source: song.source,
      name: song.name,
      artist: song.artist,
      album: song.album,
      pic: song.pic,
      duration: song.duration,
      requestedBy: song.requestedBy || '私人漫游',
      requestedById: song.requestedById || '',
      requestedAt: playedAt,
    }),
    ...(room.songHistory || []),
  ].slice(0, MAX_SONG_HISTORY);
}

function setCurrentSong(room, song) {
  room.randomLoading = false;
  const next = serializeQueueItemForRoom(song);
  if (next) next.dislikedByIds = [];
  room.current = next;
  room.isPlaying = true;
  room.currentTime = 0;
  room.startedAt = Date.now();
  recordSongPlayHistory(room, song);
  bumpPlaybackState(room);
  if (room.queue.length === 0) void ensureNextRandom(room);
}

async function playNextUnlocked(room, options = {}) {
  const { allowFetchRandom = false } = options;
  room.skipRequests = [];

  if (room.queue.length > 0) {
    clearNextRandom(room);
    setCurrentSong(room, room.queue.shift());
    return;
  }

  // 队列为空时先等待预取，避免切歌/自然结束因 nextRandom 尚未就绪而反复进入 loading
  if (room.nextRandomPromise) {
    await room.nextRandomPromise;
  }

  let random = room.nextRandom;
  room.nextRandom = null;

  // if (random && room.randomPlayedKeys.has(songIdentity(random.source, random.id))) {
  //   random = null;
  // }

  const shouldFetchRandom = !random && (allowFetchRandom || room.queue.length === 0);
  if (shouldFetchRandom) {
    room.randomLoading = true;
    bumpPlaybackState(room);
    random = await fetchRandomForRoom(room);
    if (random && !random.queueId) {
      random = buildPendingRandomItem(random);
    }
  }

  if (room.queue.length > 0) {
    if (random) {
      const pending = buildPendingRandomItem(random);
      if (pending && !room.nextRandom) room.nextRandom = pending;
      notifyRoomPrefetchReady(room);
    }
    setCurrentSong(room, room.queue.shift());
    return;
  }

  if (random) {
    const item = random.queueId
      ? serializeQueueItemForRoom({
        ...random,
        requestedBy: '私人漫游',
        addedAt: random.addedAt || Date.now(),
      })
      : buildPendingRandomItem(random);
    if (!item) {
      clearNextRandom(room);
      room.current = null;
      room.isPlaying = false;
      room.currentTime = 0;
      room.startedAt = null;
      room.randomLoading = true;
      bumpPlaybackState(room);
      return;
    }
    setCurrentSong(room, item);
    return;
  }

  clearNextRandom(room);
  room.current = null;
  room.isPlaying = false;
  room.currentTime = 0;
  room.startedAt = null;
  // 漫游关闭时干净停机，不进入"漫游加载中"重试
  room.randomLoading = (room.neteaseFmMode || DEFAULT_FM_MODE) !== FM_MODE_OFF;
  bumpPlaybackState(room);
}

async function playNext(room, options = {}) {
  return withPlaybackLock(room, () => playNextUnlocked(room, options));
}

async function runEnsurePlayback(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (room.current) {
    room.randomLoading = false;
    return serializeRoom(room);
  }

  if (!room.randomLoading) room.randomLoading = true;
  try {
    await withPlaybackLock(room, async () => {
      if (!room.current) await playNextUnlocked(room, { allowFetchRandom: true });
    });
  } finally {
    if (room.current) room.randomLoading = false;
  }
  persistRoom(room);
  return serializeRoom(room);
}

export async function ensurePlayback(roomId) {
  const inflight = ensurePlaybackInflight.get(roomId);
  if (inflight) return inflight;

  const task = runEnsurePlayback(roomId);
  ensurePlaybackInflight.set(roomId, task);
  try {
    return await task;
  } finally {
    ensurePlaybackInflight.delete(roomId);
  }
}

const RANDOM_RETRY_COOLDOWN_MS = 2000;

/** 房间卡在 randomLoading 时由定时任务触发重试 */
export async function retryStuckRandomLoading(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.current || !room.randomLoading || room.users.size === 0) return null;

  const now = Date.now();
  if (room.lastRandomRetryAt && now - room.lastRandomRetryAt < RANDOM_RETRY_COOLDOWN_MS) {
    return null;
  }
  room.lastRandomRetryAt = now;

  return ensurePlayback(roomId);
}

/** 标记房间正在拉取随机歌曲（用于加入后立即向客户端反馈"加载中"） */
export function markRandomLoading(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (!room.current && room.queue.length === 0) {
    room.randomLoading = true;
  }
  return serializeRoom(room);
}

export async function skipSong(roomId, socketId, connectionId = null, options = {}) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  if (!isControllerConnection(room, socketId, connectionId)) return { error: '仅房主或管理员可切歌' };

  const user = room.users.get(socketId);
  const songTitle = room.current ? formatSongTitle(room.current) : '';
  const reason = String(options.reason || 'manual');
  await playNext(room, { allowFetchRandom: false });

  let systemMessage = null;
  if (songTitle) {
    if (reason === 'source_error') {
      systemMessage = appendSystemChatMessage(room, `因歌曲源异常，已跳过 ${songTitle}`);
    } else if (reason === 'system') {
      systemMessage = appendSystemChatMessage(room, `系统已跳过 ${songTitle}`);
    } else {
      systemMessage = appendSystemChatMessage(room, `${formatActorName(user)} 切了 ${songTitle}`);
    }
  }

  persistRoom(room);
  return { room: serializeRoom(room), systemMessage };
}

export async function finishCurrentSong(roomId, socketId, connectionId, queueId) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  if (!isControllerConnection(room, socketId, connectionId)) return { error: '仅房主或管理员可结束歌曲' };
  if (!room.current) return { error: '当前没有正在播放的歌曲' };
  if (queueId && room.current.queueId !== queueId) return { room: serializeRoom(room) };

  await withPlaybackLock(room, async () => {
    if (!room.current) return;
    if (queueId && room.current.queueId !== queueId) return;
    await playNextUnlocked(room, { allowFetchRandom: false });
  });
  persistRoom(room);
  return { room: serializeRoom(room) };
}

export async function advancePlaybackIfEnded(roomId, options = {}) {
  const room = rooms.get(roomId);
  if (!room?.current || !room.isPlaying) return null;

  const { force = false, expectedQueueId = '' } = options;
  if (expectedQueueId && room.current.queueId !== expectedQueueId) return null;

  const durationSec = getSongDurationSeconds(room.current);
  if (durationSec <= 0 && !force) return null;
  if (!force && getPlaybackTime(room) < durationSec + AUTO_ADVANCE_GRACE_SEC) return null;

  if (room.autoAdvancePromise) return null;

  room.autoAdvancePromise = withPlaybackLock(room, async () => {
    if (!room.current || !room.isPlaying) return null;
    if (expectedQueueId && room.current.queueId !== expectedQueueId) return null;

    const lockedDurationSec = getSongDurationSeconds(room.current);
    if (!force && (lockedDurationSec <= 0 || getPlaybackTime(room) < lockedDurationSec + AUTO_ADVANCE_GRACE_SEC)) {
      return null;
    }
    await playNextUnlocked(room, { allowFetchRandom: false });
    persistRoom(room);
    return serializeRoom(room);
  });

  try {
    return await room.autoAdvancePromise;
  } finally {
    room.autoAdvancePromise = null;
  }
}

export function setPlaying(roomId, socketId, isPlaying, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room || !room.current) return null;
  if (!canPausePlayback(room, socketId, connectionId)) return null;

  room.isPlaying = isPlaying;
  if (isPlaying) {
    const now = Date.now();
    const currentTime = calculatePlaybackTime(room, now);
    room.currentTime = currentTime;
    room.startedAt = now - currentTime * 1000;
  } else {
    room.currentTime = calculatePlaybackTime(room);
    room.startedAt = null;
  }
  bumpPlaybackState(room);

  persistRoom(room);
  return serializeRoom(room);
}

export function seekTo(roomId, socketId, time, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room || !room.current) return null;
  if (!canSeekPlayback(room, socketId, connectionId)) return null;

  const nextTime = Number(time);
  if (!Number.isFinite(nextTime) || nextTime < 0) return null;

  room.currentTime = nextTime;
  room.startedAt = room.isPlaying ? Date.now() - room.currentTime * 1000 : null;
  bumpPlaybackState(room);
  persistRoom(room);
  return serializeRoom(room);
}

async function applyJumpToFront(room, queueId, options = {}) {
  const { ownerPriority = false, priorityBy = '' } = options;
  const qIdx = room.queue.findIndex((s) => s.queueId === queueId);
  if (qIdx === -1) return false;

  const [song] = room.queue.splice(qIdx, 1);
  if (ownerPriority) {
    song.ownerPriority = Date.now();
    if (priorityBy) {
      song.priorityBy = priorityBy;
    } else {
      delete song.priorityBy;
    }
  }
  room.queue.unshift(song);
  if (queueHasManualOrder(room) || Number.isFinite(song.manualOrder)) {
    reindexManualOrder(room);
  }
  if (!room.current) {
    await withPlaybackLock(room, async () => {
      if (!room.current) await playNextUnlocked(room, { allowFetchRandom: true });
    });
  }
  return true;
}

export async function requestJump(roomId, socketId, queueId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };

  const user = room.users.get(socketId);
  if (!user) return { error: '未加入房间' };
  if (!isActorConnection(room, socketId, connectionId)) {
    return { error: '会话无效，请刷新后重试' };
  }

  const item = room.queue.find((s) => s.queueId === queueId);
  if (!item) return { error: '歌曲不在队列中' };
  const isController = isControllerConnection(room, socketId, connectionId);
  const isRequester = isQueueRequester(item, socketId, user);
  if (!isController && !isRequester) return { error: '只能为自己点的歌插队' };
  if (!isController && !room.memberJumpEnabled) {
    return { error: '房间未开启成员插队' };
  }

  const jumped = await applyJumpToFront(room, queueId, {
    ownerPriority: isController,
    priorityBy: isController && !isRoomCreator(room, socketId) ? user.nickname : '',
  });
  if (!jumped) return { error: '歌曲不在队列中' };

  room.jumpRequests = room.jumpRequests.filter((r) => r.queueId !== queueId);
  const systemMessage = appendSystemChatMessage(
    room,
    `${formatActorName(user)} 将 ${formatSongTitle(item)} 插到下一首`,
  );
  persistRoom(room);
  return { room: serializeRoom(room), systemMessage };
}

/**
 * 房主/管理员拖拽重排待播队列。
 * 仅被拖动的歌曲写入 ownerPriority（边框与插队一致），不改动点歌人。
 * 全队写入 manualOrder 以锁定顺序。
 */
export function reorderQueue(roomId, actorId, orderedQueueIds, movedQueueId = null, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  if (!isControllerConnection(room, actorId, connectionId)) {
    return { error: '仅房主或管理员可排序播放列表' };
  }

  if (!Array.isArray(orderedQueueIds) || orderedQueueIds.length === 0) {
    return { error: '排序参数无效' };
  }

  const byId = new Map(room.queue.map((song) => [song.queueId, song]));
  if (orderedQueueIds.length !== room.queue.length) {
    return { error: '排序与当前队列不匹配' };
  }
  const seen = new Set();
  for (const queueId of orderedQueueIds) {
    if (!byId.has(queueId) || seen.has(queueId)) {
      return { error: '排序与当前队列不匹配' };
    }
    seen.add(queueId);
  }

  const actor = room.users.get(actorId);
  const isAdminReorder = actor && !isRoomCreator(room, actorId);
  const movedId = movedQueueId && byId.has(movedQueueId) ? movedQueueId : null;

  room.queue = orderedQueueIds.map((queueId, index) => {
    const song = byId.get(queueId);
    song.manualOrder = index;
    return song;
  });

  // 只给真正被拖动的那首加优先级边框，且绝不改写 requestedBy
  if (movedId) {
    const moved = byId.get(movedId);
    moved.ownerPriority = Date.now();
    if (isAdminReorder) {
      moved.priorityBy = actor.nickname;
    } else {
      delete moved.priorityBy;
    }
  }

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export async function approveJump(roomId, socketId, requestId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  if (!isControllerConnection(room, socketId, connectionId)) return { error: '仅房主或管理员可审批' };

  const reqIdx = room.jumpRequests.findIndex((r) => r.id === requestId);
  if (reqIdx === -1) return { error: '申请不存在' };

  const req = room.jumpRequests[reqIdx];
  room.jumpRequests.splice(reqIdx, 1);

  const approver = room.users.get(socketId);
  const isAdminJump = approver && !isRoomCreator(room, socketId);
  await applyJumpToFront(room, req.queueId, {
    ownerPriority: true,
    priorityBy: isAdminJump ? approver.nickname : '',
  });

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function rejectJump(roomId, socketId, requestId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  if (!isControllerConnection(room, socketId, connectionId)) return { error: '仅房主或管理员可审批' };

  const before = room.jumpRequests.length;
  room.jumpRequests = room.jumpRequests.filter((r) => r.id !== requestId);
  if (room.jumpRequests.length === before) return { error: '申请不存在' };

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function requestSkip(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  if (!room.current) return { error: '当前没有正在播放的歌曲' };
  if (canControlPlayback(room, socketId)) return { error: '可直接切歌' };

  const user = room.users.get(socketId);
  if (room.skipRequests.some((r) => r.requestedBy === socketId)) {
    return { error: '已提交过切歌申请' };
  }

  room.skipRequests.push({
    id: generateId(),
    songName: room.current.name,
    nickname: user?.nickname || '匿名',
    requestedBy: socketId,
    requestedAt: Date.now(),
  });

  const created = room.skipRequests[room.skipRequests.length - 1];
  scheduleSkipRequestExpiry(roomId, created.id, created.requestedAt);

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export async function approveSkip(roomId, socketId, requestId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  if (!isControllerConnection(room, socketId, connectionId)) return { error: '仅房主或管理员可审批' };

  const reqIdx = room.skipRequests.findIndex((r) => r.id === requestId);
  if (reqIdx === -1) return { error: '申请不存在' };

  clearSkipRequestExpiryTimer(roomId, requestId);
  room.skipRequests.splice(reqIdx, 1);
  await playNext(room, { allowFetchRandom: false });

  persistRoom(room);
  return { room: serializeRoom(room) };
}

export function rejectSkip(roomId, socketId, requestId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  if (!isControllerConnection(room, socketId, connectionId)) return { error: '仅房主或管理员可审批' };

  const before = room.skipRequests.length;
  room.skipRequests = room.skipRequests.filter((r) => r.id !== requestId);
  if (room.skipRequests.length === before) return { error: '申请不存在' };

  clearSkipRequestExpiryTimer(roomId, requestId);

  persistRoom(room);
  return { room: serializeRoom(room) };
}

const MAX_REACTION_EMOJI_LEN = 32;
const QQFACE_REACTION_RE = /^\[qqface:[^\]]+\]$/;

function sanitizeReactionEmoji(emoji) {
  const text = String(emoji || '').trim();
  if (!text || text.length > MAX_REACTION_EMOJI_LEN) return '';
  if (QQFACE_REACTION_RE.test(text)) return text;
  if ([...text].length <= 4) return text;
  return '';
}

function serializeReactions(reactions) {
  if (!reactions || typeof reactions !== 'object') return [];
  return Object.entries(reactions)
    .map(([emoji, users]) => ({
      emoji,
      users: Array.isArray(users) ? users : [],
    }))
    .filter((group) => group.users.length > 0);
}

function serializeChatMessage(message, options = {}) {
  const allowLargeDataUrl = Boolean(options.allowLargeDataUrl);
  const imageUrl = String(message.imageUrl || '').trim() || null;
  const replyTo = sanitizeReplyImageForWire(message.replyTo, allowLargeDataUrl);

  let safeImageUrl = imageUrl;
  if (!allowLargeDataUrl && isOversizedDataUrl(imageUrl)) {
    safeImageUrl = null;
  }

  return {
    id: message.id,
    userId: message.userId,
    nickname: message.nickname,
    text: message.text,
    imageUrl: safeImageUrl,
    imageKey: message.imageKey || null,
    asSticker: Boolean(message.asSticker),
    kind: message.kind || 'chat',
    mentions: message.mentions || [],
    replyTo,
    timestamp: message.timestamp,
    reactions: serializeReactions(message.reactions),
    memberTier: message.memberTier || null,
    targetUserId: message.targetUserId || null,
    targetNickname: message.targetNickname || null,
  };
}

function isOversizedDataUrl(imageUrl) {
  const url = String(imageUrl || '');
  return url.startsWith('data:') && url.length > 8 * 1024;
}

function sanitizeReplyImageForWire(replyTo, allowLargeDataUrl) {
  if (!replyTo) return null;
  if (allowLargeDataUrl || !isOversizedDataUrl(replyTo.imageUrl)) return replyTo;
  return {
    ...replyTo,
    imageUrl: null,
  };
}

function sanitizeMessageForStorage(message) {
  if (!message) return message;
  const imageUrl = message.imageUrl;
  const replyTo = message.replyTo;
  const needsStrip = isOversizedDataUrl(imageUrl)
    || (replyTo && isOversizedDataUrl(replyTo.imageUrl));
  if (!needsStrip) return message;

  return {
    ...message,
    imageUrl: isOversizedDataUrl(imageUrl) ? undefined : imageUrl,
    replyTo: replyTo && isOversizedDataUrl(replyTo.imageUrl)
      ? { ...replyTo, imageUrl: undefined }
      : replyTo,
  };
}

export function toggleChatReaction(roomId, userId, messageId, emoji) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };

  const emojiKey = sanitizeReactionEmoji(emoji);
  if (!emojiKey) return { error: '无效表情' };

  const message = room.messages.find((entry) => entry.id === messageId);
  if (!message) return { error: '消息不存在' };

  if (isUserChatMuted(room, userId)) {
    return { error: room.muteAll ? '当前房间已全体禁言' : '你已被禁言' };
  }

  const user = room.users.get(userId);
  if (!user) return { error: '未加入房间' };

  if (!message.reactions) message.reactions = {};
  if (!message.reactions[emojiKey]) message.reactions[emojiKey] = [];

  const list = message.reactions[emojiKey];
  const index = list.findIndex((entry) => entry.userId === userId);
  if (index >= 0) {
    list.splice(index, 1);
    if (list.length === 0) delete message.reactions[emojiKey];
  } else {
    list.push({ userId, nickname: user.nickname || '匿名' });
  }

  persistRoom(room);
  return {
    messageId,
    reactions: serializeReactions(message.reactions),
  };
}

function sanitizeChatReplyRef(replyTo, roomId) {
  if (!replyTo || typeof replyTo !== 'object') return null;
  const id = String(replyTo.id || '').trim();
  const userId = String(replyTo.userId || '').trim();
  const nickname = String(replyTo.nickname || '').trim().slice(0, 32);
  const text = String(replyTo.text || '').trim().slice(0, 48);
  if (!id || !userId || !nickname) return null;

  const imageUrl = String(replyTo.imageUrl || '').trim();
  const imageKey = String(replyTo.imageKey || '').trim();
  const asSticker = Boolean(replyTo.asSticker);
  const result = { id, userId, nickname, text };
  if (asSticker) result.asSticker = true;

  if (imageUrl && !imageUrl.startsWith('data:')) {
    const imageCheck = imageKey
      ? (isLocalStickerImageKey(imageKey)
        ? validateLocalStickerImage(imageUrl, imageKey)
        : validateChatImageForRoom(roomId, imageUrl, imageKey))
      : validateExternalChatImage(imageUrl);
    if (!imageCheck.error) {
      result.imageUrl = imageUrl;
      if (imageKey) result.imageKey = imageKey;
    }
  } else if (imageKey && isLocalStickerImageKey(imageKey)) {
    // 回复引用不内联 data URL，避免历史/广播膨胀
    result.imageKey = imageKey;
  }
  return result;
}

export function addChatMessage(roomId, userId, text, options = {}) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };

  const content = String(text || '').trim();
  const imageUrl = String(options.imageUrl || '').trim();
  const imageKey = String(options.imageKey || '').trim();
  const asSticker = Boolean(options.asSticker) || isLocalStickerImageKey(imageKey);

  if (!content && !imageUrl) return { error: '消息不能为空' };
  if (content.length > 500) return { error: '消息过长' };

  const user = room.users.get(userId);
  if (isUserChatMuted(room, userId)) {
    return { error: room.muteAll ? '当前房间已全体禁言' : '你已被禁言' };
  }

  if (imageUrl) {
    const imageCheck = imageKey
      ? (isLocalStickerImageKey(imageKey)
        ? validateLocalStickerImage(imageUrl, imageKey)
        : validateChatImageForRoom(roomId, imageUrl, imageKey))
      : validateExternalChatImage(imageUrl);
    if (imageCheck.error) return imageCheck;
  }

  if (hasMentionAllInText(content) && !canControlPlayback(room, userId)) {
    return { error: '仅房主或管理员可使用 @全体成员' };
  }

  let mentions = Array.isArray(options.mentions) ? options.mentions.slice(0, 10) : [];
  if (hasMentionAllInText(content)) {
    mentions = buildMentionAllTargets(room, userId);
  }

  const message = {
    id: generateId(),
    userId,
    nickname: user?.nickname || '匿名',
    text: content,
    imageUrl: imageUrl || undefined,
    imageKey: imageKey || undefined,
    asSticker: asSticker || undefined,
    mentions,
    replyTo: sanitizeChatReplyRef(options.replyTo, roomId),
    timestamp: Date.now(),
  };

  room.messages.push(message);
  if (room.messages.length > MAX_CHAT_MESSAGES) {
    room.messages.splice(0, room.messages.length - MAX_CHAT_MESSAGES);
  }

  // 内存里也不长期保留超大 data URL，实时广播后即可压缩历史体积
  if (isOversizedDataUrl(message.imageUrl)) {
    setImmediate(() => {
      if (message.imageUrl && isOversizedDataUrl(message.imageUrl)) {
        message.imageUrl = undefined;
        persistRoom(room);
      }
    });
  }

  persistRoom(room);
  return { message: serializeChatMessage(message, { allowLargeDataUrl: true }) };
}

const CHAT_RECALL_WINDOW_MS = 2 * 60 * 1000;

export function recallChatMessage(roomId, userId, messageId, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };

  const id = String(messageId || '').trim();
  if (!id) return { error: '消息不存在' };

  const index = room.messages.findIndex((entry) => entry.id === id);
  if (index === -1) return { error: '消息不存在' };

  const message = room.messages[index];
  if (message.kind && message.kind !== 'chat') return { error: '该消息无法撤回' };

  const isSelf = message.userId === userId;
  const isModerator = canModerate(room, userId);
  if (!isSelf && !isModerator) return { error: '只能撤回自己的消息' };
  if (!isSelf) {
    const denied = requireModerator(room, userId, connectionId);
    if (denied) return denied;
    // 管理不可撤回房主消息；管理之间也不可互撤，仅房主可撤回他人管理消息
    if (isRoomCreator(room, message.userId)) {
      return { error: '不能撤回房主的消息' };
    }
    if (
      (isAppointedAdmin(room, message.userId) || isAutoPromotedAdmin(room, message.userId))
      && !isRoomCreator(room, userId)
    ) {
      return { error: '仅房主可撤回管理员的消息' };
    }
  }
  if (isSelf && !isModerator && Date.now() - (message.timestamp || 0) > CHAT_RECALL_WINDOW_MS) {
    return { error: '已超过可撤回时间' };
  }

  const authorName = String(message.nickname || '匿名').trim().slice(0, 20) || '匿名';
  const actor = room.users.get(userId);
  const actorName = formatActorName(actor);
  room.messages.splice(index, 1);

  const noticeText = isSelf
    ? `${authorName} 撤回了一条消息`
    : `${actorName} 撤回了 ${authorName} 的一条消息`;
  const recallMessage = appendRecallChatMessage(room, noticeText);
  return { recalledMessageId: id, recallMessage };
}

export function getPlaybackTime(room) {
  if (!room.current) return 0;
  if (room.isPlaying && room.current && !room.startedAt) {
    room.startedAt = Date.now() - (room.currentTime || 0) * 1000;
  }
  return calculatePlaybackTime(room);
}

const PLAYBACK_DRIFT_ANCHOR_ENTER_SEC = 3.5;
const PLAYBACK_DRIFT_ANCHOR_EXIT_SEC = 2.5;
const PLAYBACK_DRIFT_ANCHOR_COOLDOWN_MS = 5000;

function applyPlaybackDriftAnchor(room, serverTime, now = Date.now()) {
  if (room.playbackDriftAnchorCooldownUntil && now < room.playbackDriftAnchorCooldownUntil) {
    if (room.playbackDriftAnchored) {
      room.currentTime = serverTime;
    }
    return;
  }

  const stored = room.currentTime || 0;
  const diff = Math.abs(serverTime - stored);
  let toggled = false;

  if (!room.playbackDriftAnchored && diff > PLAYBACK_DRIFT_ANCHOR_ENTER_SEC) {
    room.playbackDriftAnchored = true;
    toggled = true;
  } else if (room.playbackDriftAnchored && diff < PLAYBACK_DRIFT_ANCHOR_EXIT_SEC) {
    room.playbackDriftAnchored = false;
    toggled = true;
  }

  if (toggled) {
    room.playbackDriftAnchorCooldownUntil = now + PLAYBACK_DRIFT_ANCHOR_COOLDOWN_MS;
  }

  if (room.playbackDriftAnchored) {
    room.currentTime = serverTime;
  }
}

function calculatePlaybackTime(room, now = Date.now()) {
  if (!room?.current) return 0;
  if (room.isPlaying && room.startedAt) {
    const serverTime = (now - room.startedAt) / 1000;
    applyPlaybackDriftAnchor(room, serverTime, now);
    return serverTime;
  }
  return room.currentTime || 0;
}

function serializeRoomSummary(room) {
  return {
    id: room.id,
    name: room.name,
    userCount: room.users.size,
    hasPassword: Boolean(room.passwordHash),
    isLocked: Boolean(room.isLocked),
    isPlaying: room.isPlaying,
    currentSong: room.current
      ? { name: room.current.name, artist: room.current.artist }
      : null,
    queueLength: room.queue.length,
    createdAt: room.createdAt,
  };
}

function repairPlaybackClock(room) {
  if (room.isPlaying && room.current && !room.startedAt) {
    const now = Date.now();
    room.startedAt = now - (room.currentTime || 0) * 1000;
  }
}

function serializeUser(user, options = {}) {
  const payload = {
    id: user.id,
    nickname: user.nickname,
    readOnly: user.readOnly,
    joinedAt: user.joinedAt,
  };
  // 广播包省略 location，缩小人多时的 users 体积；进房 ACK 仍带完整字段
  if (options.includeLocation !== false) {
    payload.location = user.location || '';
  }
  return payload;
}

/** 队列/当前歌曲广播字段：不含 url/lrc，歌词与播放地址由客户端按需拉取 */
function serializeQueueItemForRoom(item) {
  if (!item) return null;
  return {
    queueId: item.queueId,
    id: item.id,
    source: item.source || 'netease',
    name: item.name,
    artist: item.artist,
    album: item.album,
    pic: item.pic,
    duration: item.duration,
    requestedBy: item.requestedBy,
    requestedById: item.requestedById,
    addedAt: item.addedAt,
    likedByIds: Array.isArray(item.likedByIds) ? item.likedByIds : [],
    dislikedByIds: Array.isArray(item.dislikedByIds) ? item.dislikedByIds : [],
    ownerPriority: item.ownerPriority || 0,
    priorityBy: item.priorityBy || '',
    ...(Number.isFinite(item.manualOrder) ? { manualOrder: item.manualOrder } : {}),
  };
}

/** 私人漫游预取曲目：分配稳定 queueId，播放与客户端 URL 缓存可复用 */
function buildPendingRandomItem(song) {
  if (!song?.id) return null;
  return serializeQueueItemForRoom({
    queueId: song.queueId || `random-${generateId()}`,
    id: song.id,
    source: song.source || 'netease',
    name: song.name,
    artist: song.artist,
    album: song.album,
    pic: song.pic,
    duration: song.duration,
    requestedBy: '私人漫游',
    requestedById: '',
    addedAt: song.addedAt || Date.now(),
  });
}

/** 随机预取等待歌曲等无 queueId 的元数据（不含 url/lrc/raw） */
function serializeSongMeta(item) {
  if (!item) return null;
  if (item.queueId) return serializeQueueItemForRoom(item);
  return {
    id: item.id,
    source: item.source || 'netease',
    name: item.name,
    artist: item.artist,
    album: item.album,
    pic: item.pic,
    duration: item.duration,
  };
}

function serializeSongHistoryForClient(item) {
  if (!item) return null;
  return {
    id: item.id,
    source: item.source || 'netease',
    name: item.name,
    artist: item.artist,
    album: item.album,
    pic: item.pic,
    duration: item.duration,
    requestedBy: item.requestedBy,
    requestedById: item.requestedById,
    requestedAt: item.requestedAt,
  };
}

function getMessagesForUser(room, userId) {
  if (!userId) return room.messages;
  const user = room.users.get(userId);
  if (user?.chatVisibleSince) {
    return room.messages.filter((message) => message.timestamp >= user.chatVisibleSince);
  }
  return room.messages;
}

/** 分页拉取聊天历史（join 初始 100 条，上滑每次 50 条） */
export function getChatHistoryForUser(roomId, userId, options = {}) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };

  const limit = Math.min(Math.max(Number(options.limit) || CHAT_PAGE_LIMIT, 1), INITIAL_CHAT_LIMIT);
  const beforeTimestamp = Number(options.before) || 0;
  const beforeId = String(options.beforeId || '').trim();
  const all = getMessagesForUser(room, userId);

  if (beforeTimestamp > 0 || beforeId) {
    let endIndex = all.length;
    if (beforeId) {
      const idx = all.findIndex((message) => message.id === beforeId);
      if (idx >= 0) endIndex = idx;
    } else {
      const idx = all.findIndex((message) => message.timestamp >= beforeTimestamp);
      if (idx >= 0) endIndex = idx;
    }

    const older = all.slice(0, endIndex);
    const messages = older.slice(-limit).map((message) => serializeChatMessage(message));
    return { messages, hasMore: older.length > limit };
  }

  const messages = all.slice(-limit).map((message) => serializeChatMessage(message));
  return { messages, hasMore: all.length > limit };
}

/** 按需拉取播放历史（不随 room_update 广播，不含 url/lrc） */
export function getSongHistory(roomId, options = {}) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };

  const limit = Math.min(Math.max(Number(options.limit) || MAX_SONG_HISTORY, 1), MAX_SONG_HISTORY);
  const songs = (room.songHistory || [])
    .slice(0, limit)
    .map(serializeSongHistoryForClient)
    .filter(Boolean);
  return { songs };
}

/** 上报音频/元数据时长，供服务端自动切歌（不广播 room_update） */
export function reportTrackDuration(roomId, userId, queueId, durationMs, connectionId = null) {
  const room = rooms.get(roomId);
  if (!room?.current) return { error: '无当前歌曲' };

  const expectedQueueId = String(queueId || '');
  if (expectedQueueId && room.current.queueId !== expectedQueueId) {
    return { success: true, skipped: true };
  }

  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms <= 0) return { error: '时长无效' };

  const existing = Number(room.current.duration || 0);
  const isController = isControllerConnection(room, userId, connectionId);
  // 控制者可更新；其他人仅在缺失时长时补种（避免文件已结束但服务端永不 advance）
  if (!isController && existing > 0) return { error: '仅房主或管理员可上报时长' };
  // 允许缩短：CDN 截断预览时长常短于元数据，否则服务端永不 auto-advance
  if (existing > 0 && Math.abs(ms - existing) < 50) return { success: true, skipped: true };

  room.current.duration = Math.round(ms);
  persistRoom(room);
  return { success: true };
}

function serializeRoom(room, options = {}) {
  repairPlaybackClock(room);
  const forUserId = options.forUserId || null;
  const forUser = forUserId ? room.users.get(forUserId) : null;
  // 敏感管理字段仅对正式管理权可见；临时播放主控不可窥探禁言名单等
  const viewerCanModerate = forUserId ? canModerate(room, forUserId) : false;
  return {
    id: room.id,
    name: room.name,
    hasPassword: Boolean(room.passwordHash),
    isLocked: Boolean(room.isLocked),
    muteAll: Boolean(room.muteAll),
    mutedUserIds: viewerCanModerate ? Array.from(room.mutedUserIds || []) : undefined,
    chatMuted: forUserId ? isUserChatMuted(room, forUserId) : false,
    ownerId: room.ownerId,
    creatorId: room.creatorId ?? null,
    adminIds: getOrderedAdminIds(room),
    autoPromotedAdminIds: getOrderedAutoPromotedAdminIds(room),
    userNicknames: viewerCanModerate ? serializeUserNicknamesForViewer(room) : undefined,
    queue: room.queue.map(serializeQueueItemForRoom).filter(Boolean),
    current: serializeQueueItemForRoom(room.current),
    isPlaying: room.isPlaying,
    currentTime: getPlaybackTime(room),
    users: Array.from(room.users.values()).map(serializeUser),
    userCount: room.users.size,
    jumpRequests: room.jumpRequests,
    skipRequests: room.skipRequests,
    chatVisibleSince: forUser?.chatVisibleSince ?? null,
    nextRandom: serializeQueueItemForRoom(room.nextRandom),
    randomLoading: Boolean(room.randomLoading),
    audioQuality: normalizeRoomAudioQuality(room.audioQuality),
    neteaseFmMode: normalizeFmMode(room.neteaseFmMode),
    fmModeBeforeOff: normalizeFmMode(room.fmModeBeforeOff),
    announcementEnabled: Boolean(room.announcementEnabled),
    announcementText: String(room.announcementText || '').slice(0, MAX_ANNOUNCEMENT_LENGTH),
    chatHistoryVisibleOnJoin: Boolean(room.chatHistoryVisibleOnJoin),
    songRequestEnabled: room.songRequestEnabled !== false,
    songRequestMinStaySec: normalizeSongRequestMinStaySec(room.songRequestMinStaySec),
    songRequestMaxPerUser: normalizeSongRequestMaxPerUser(room.songRequestMaxPerUser),
    songRequestCooldownSec: normalizeSongRequestCooldownSec(room.songRequestCooldownSec),
    queueMaxLength: normalizeQueueMaxLength(room.queueMaxLength),
    memberJumpEnabled: Boolean(room.memberJumpEnabled),
    memberSeekEnabled: Boolean(room.memberSeekEnabled),
    memberPauseEnabled: Boolean(room.memberPauseEnabled),
    systemMediaPlayBound: room.systemMediaPlayBound !== false,
    systemMediaSkipBound: room.systemMediaSkipBound !== false,
    dislikeSkipMode: normalizeDislikeSkipMode(room.dislikeSkipMode),
    dislikeSkipThreshold: normalizeDislikeSkipThreshold(room.dislikeSkipThreshold),
    dislikeSkipPercent: normalizeDislikeSkipPercent(room.dislikeSkipPercent),
    clearSongsOnLeaveEnabled: Boolean(room.clearSongsOnLeaveEnabled),
    clearSongsOnLeaveDelaySec: normalizeClearSongsOnLeaveDelaySec(room.clearSongsOnLeaveDelaySec),
    bannedSongs: viewerCanModerate ? serializeBannedSongs(room.bannedSongs) : undefined,
    memberTiers: serializeMemberTiersMap(room.memberTiers),
    memberSettings: serializeMemberSettings(room.memberSettings),
  };
}

/**
 * 预先序列化广播共用载荷，避免人数多时对每个连接重复 map queue/users。
 */
export function prepareRoomBroadcast(roomId) {
  const room = rooms.get(roomId?.toUpperCase());
  if (!room) return null;
  repairPlaybackClock(room);

  const shared = {
    id: room.id,
    name: room.name,
    hasPassword: Boolean(room.passwordHash),
    isLocked: Boolean(room.isLocked),
    muteAll: Boolean(room.muteAll),
    ownerId: room.ownerId,
    creatorId: room.creatorId ?? null,
    adminIds: getOrderedAdminIds(room),
    autoPromotedAdminIds: getOrderedAutoPromotedAdminIds(room),
    queue: room.queue.map(serializeQueueItemForRoom).filter(Boolean),
    current: serializeQueueItemForRoom(room.current),
    isPlaying: room.isPlaying,
    currentTime: getPlaybackTime(room),
    users: Array.from(room.users.values()).map((user) => serializeUser(user, { includeLocation: false })),
    userCount: room.users.size,
    jumpRequests: room.jumpRequests,
    skipRequests: room.skipRequests,
    nextRandom: serializeQueueItemForRoom(room.nextRandom),
    randomLoading: Boolean(room.randomLoading),
    audioQuality: normalizeRoomAudioQuality(room.audioQuality),
    neteaseFmMode: normalizeFmMode(room.neteaseFmMode),
    fmModeBeforeOff: normalizeFmMode(room.fmModeBeforeOff),
    announcementEnabled: Boolean(room.announcementEnabled),
    announcementText: String(room.announcementText || '').slice(0, MAX_ANNOUNCEMENT_LENGTH),
    chatHistoryVisibleOnJoin: Boolean(room.chatHistoryVisibleOnJoin),
    songRequestEnabled: room.songRequestEnabled !== false,
    songRequestMinStaySec: normalizeSongRequestMinStaySec(room.songRequestMinStaySec),
    songRequestMaxPerUser: normalizeSongRequestMaxPerUser(room.songRequestMaxPerUser),
    songRequestCooldownSec: normalizeSongRequestCooldownSec(room.songRequestCooldownSec),
    queueMaxLength: normalizeQueueMaxLength(room.queueMaxLength),
    memberJumpEnabled: Boolean(room.memberJumpEnabled),
    memberSeekEnabled: Boolean(room.memberSeekEnabled),
    memberPauseEnabled: Boolean(room.memberPauseEnabled),
    systemMediaPlayBound: room.systemMediaPlayBound !== false,
    systemMediaSkipBound: room.systemMediaSkipBound !== false,
    dislikeSkipMode: normalizeDislikeSkipMode(room.dislikeSkipMode),
    dislikeSkipThreshold: normalizeDislikeSkipThreshold(room.dislikeSkipThreshold),
    dislikeSkipPercent: normalizeDislikeSkipPercent(room.dislikeSkipPercent),
    clearSongsOnLeaveEnabled: Boolean(room.clearSongsOnLeaveEnabled),
    clearSongsOnLeaveDelaySec: normalizeClearSongsOnLeaveDelaySec(room.clearSongsOnLeaveDelaySec),
    memberTiers: serializeMemberTiersMap(room.memberTiers),
    memberSettings: serializeMemberSettings(room.memberSettings),
  };

  const moderatorExtras = {
    mutedUserIds: Array.from(room.mutedUserIds || []),
    userNicknames: serializeUserNicknamesForViewer(room),
    bannedSongs: serializeBannedSongs(room.bannedSongs),
  };

  return { room, shared, moderatorExtras };
}

export function roomUpdateForViewer(prepared, viewerUserId = null) {
  if (!prepared) return null;
  const { room, shared, moderatorExtras } = prepared;
  const viewerCanModerate = viewerUserId ? canModerate(room, viewerUserId) : false;
  return {
    ...shared,
    ...(viewerCanModerate ? moderatorExtras : {}),
    chatMuted: viewerUserId ? isUserChatMuted(room, viewerUserId) : false,
    // chatVisibleSince 仅进房 ACK 下发，后续广播省略以缩小载荷并便于整房共享
  };
}

/** 按观众身份序列化房间（隐藏禁言名单、离线昵称映射等管理字段） */
export function serializeRoomForViewer(roomId, viewerUserId = null) {
  const room = rooms.get(roomId?.toUpperCase());
  if (!room) return null;
  return serializeRoom(room, { forUserId: viewerUserId || null });
}

export function getRoomInternal(roomId) {
  return rooms.get(roomId);
}

export function persistRoomById(roomId) {
  const room = rooms.get(roomId);
  if (room) persistRoom(room);
}
