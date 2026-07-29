/**
 * 建房限流 + 疑似自动建房检测。
 * - 硬限流：同一设备 / 用户 每 5 分钟最多创建 1 次（不含 IP，避免公司 NAT 误伤）
 * - 空闲自建房复用（见 index.js findIdleOwnedRoom）堵住刷房号
 * - 软检测：按节奏、同名、空房堆积等打分，超阈值自动全站封禁（可含 IP）
 */

import { addSiteBan, isSiteBanned } from './siteBan.js';

const CREATE_COOLDOWN_MS = 5 * 60 * 1000;
const HISTORY_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_HISTORY_PER_KEY = 40;
const MAX_KEYS = 8_000;
const AUTO_BAN_SCORE = 55;

/** @type {Map<string, number>} key -> nextAllowedAt */
const cooldownUntil = new Map();
/** @type {Map<string, Array<{ at: number, name: string, roomId: string, reused?: boolean }>>} */
const createHistory = new Map();
/** @type {Map<string, number[]>} 被限流拒绝的时间戳 */
const rejectHistory = new Map();

let lastSweepAt = 0;

function sweep(now) {
  if (now - lastSweepAt < 60_000) return;
  lastSweepAt = now;
  for (const [key, until] of cooldownUntil) {
    if (until <= now) cooldownUntil.delete(key);
  }
  for (const [key, list] of createHistory) {
    const next = list.filter((item) => now - item.at <= HISTORY_TTL_MS);
    if (next.length === 0) createHistory.delete(key);
    else createHistory.set(key, next);
  }
  for (const [key, list] of rejectHistory) {
    const next = list.filter((at) => now - at <= HISTORY_TTL_MS);
    if (next.length === 0) rejectHistory.delete(key);
    else rejectHistory.set(key, next);
  }
}

function rememberMapEntry(map, key, value, maxKeys) {
  if (!map.has(key) && map.size >= maxKeys) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

function pushTimed(map, key, itemOrAt) {
  const list = map.get(key) || [];
  list.push(itemOrAt);
  while (list.length > MAX_HISTORY_PER_KEY) list.shift();
  rememberMapEntry(map, key, list, MAX_KEYS);
}

function normalizeName(name) {
  return String(name || '').trim().slice(0, 40);
}

function sanitizeId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{8,64}$/.test(id) ? id : '';
}

/** 硬限流桶：仅 userId / deviceId（不用 IP，避免公司 NAT 误伤） */
function cooldownKeys({ deviceId, userId }) {
  const keys = [];
  const did = sanitizeId(deviceId);
  if (did) keys.push(`did:${did}`);
  const uid = sanitizeId(userId);
  if (uid) keys.push(`uid:${uid}`);
  return keys;
}

/** 行为历史桶：含 IP，仅用于自动拉黑打分 */
function historyKeys({ ip, deviceId, userId }) {
  const keys = cooldownKeys({ deviceId, userId });
  if (ip) keys.push(`ip:${ip}`);
  return keys;
}

/** 可写入全站封禁的目标 */
function banTargets({ ip, deviceId }) {
  const keys = [];
  if (ip) keys.push({ type: 'ip', value: ip, historyKey: `ip:${ip}` });
  const did = sanitizeId(deviceId);
  if (did) keys.push({ type: 'device', value: did, historyKey: `did:${did}` });
  return keys;
}

/**
 * @returns {{ allowed: true } | { allowed: false, error: string, retryAfterSec: number }}
 */
export function checkRoomCreateCooldown({ ip, deviceId, userId } = {}) {
  const now = Date.now();
  sweep(now);
  const keys = cooldownKeys({ deviceId, userId });
  if (keys.length === 0) {
    // 无设备/用户标识时退化为按 IP 宽松限流（防裸刷），阈值单独更大
    if (ip) {
      const ipKey = `ip-loose:${ip}`;
      const until = cooldownUntil.get(ipKey) || 0;
      if (until > now) {
        pushTimed(rejectHistory, `ip:${ip}`, now);
        const retryAfterSec = Math.max(1, Math.ceil((until - now) / 1000));
        return {
          allowed: false,
          error: '系统开小差了，请稍后再试',
          retryAfterSec,
        };
      }
    }
    return { allowed: true };
  }

  let blockedUntil = 0;
  for (const key of keys) {
    const until = cooldownUntil.get(key) || 0;
    if (until > now) blockedUntil = Math.max(blockedUntil, until);
  }

  if (blockedUntil > now) {
    for (const key of keys) {
      pushTimed(rejectHistory, key, now);
    }
    if (ip) pushTimed(rejectHistory, `ip:${ip}`, now);
    const retryAfterSec = Math.max(1, Math.ceil((blockedUntil - now) / 1000));
    return {
      allowed: false,
      error: '系统开小差了，请稍后再试',
      retryAfterSec,
    };
  }
  return { allowed: true };
}

function markCooldown({ ip, deviceId, userId }, now) {
  const until = now + CREATE_COOLDOWN_MS;
  const keys = cooldownKeys({ deviceId, userId });
  if (keys.length > 0) {
    for (const key of keys) {
      rememberMapEntry(cooldownUntil, key, until, MAX_KEYS);
    }
  } else if (ip) {
    // 无 did/uid：IP 用更短冷却，降低 NAT 误伤面
    rememberMapEntry(cooldownUntil, `ip-loose:${ip}`, now + 60_000, MAX_KEYS);
  }
}

function intervalsMs(events) {
  const gaps = [];
  for (let i = 1; i < events.length; i += 1) {
    gaps.push(events[i].at - events[i - 1].at);
  }
  return gaps;
}

function mean(nums) {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stddev(nums) {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const v = nums.reduce((acc, n) => acc + (n - m) ** 2, 0) / nums.length;
  return Math.sqrt(v);
}

function mergeEvents(keys) {
  const byAt = new Map();
  for (const key of keys) {
    for (const item of createHistory.get(key) || []) {
      const k = `${item.at}:${item.roomId}:${item.name}`;
      if (!byAt.has(k)) byAt.set(k, item);
    }
  }
  return Array.from(byAt.values()).sort((a, b) => a.at - b.at);
}

function mergeRejects(keys) {
  const all = [];
  for (const key of keys) {
    all.push(...(rejectHistory.get(key) || []));
  }
  return all.sort((a, b) => a - b);
}

/**
 * 打分：越高越像脚本。
 */
function scoreAutomation(events, rejects, emptyOwnedRooms) {
  const now = Date.now();
  const recent1h = events.filter((e) => now - e.at <= 60 * 60 * 1000);
  const recent2h = events.filter((e) => now - e.at <= 2 * 60 * 60 * 1000);
  const rejects30m = rejects.filter((at) => now - at <= 30 * 60 * 1000);
  const reused1h = recent1h.filter((e) => e.reused).length;

  let score = 0;
  const reasons = [];

  if (recent1h.length >= 5) {
    score += 40;
    reasons.push(`1小时内创建${recent1h.length}次`);
  } else if (recent1h.length >= 4) {
    score += 28;
    reasons.push(`1小时内创建${recent1h.length}次`);
  } else if (recent1h.length >= 3) {
    score += 15;
    reasons.push(`1小时内创建${recent1h.length}次`);
  } else if (recent2h.length >= 8) {
    score += 35;
    reasons.push(`2小时内创建${recent2h.length}次`);
  }

  if (reused1h >= 3) {
    score += 25;
    reasons.push(`反复撞空闲房复用${reused1h}次`);
  }

  if (recent1h.length >= 3) {
    const counts = new Map();
    for (const e of recent1h) {
      const n = normalizeName(e.name) || '(空)';
      counts.set(n, (counts.get(n) || 0) + 1);
    }
    let topName = '';
    let topCount = 0;
    for (const [n, c] of counts) {
      if (c > topCount) {
        topName = n;
        topCount = c;
      }
    }
    const ratio = topCount / recent1h.length;
    if (topCount >= 3 && ratio >= 0.75) {
      score += 35;
      reasons.push(`房间名多为「${topName.slice(0, 12)}」`);
    }
  }

  const sample = recent2h.length >= 4 ? recent2h : recent1h;
  if (sample.length >= 4) {
    const gaps = intervalsMs(sample);
    const m = mean(gaps);
    const sd = stddev(gaps);
    const cv = m > 0 ? sd / m : 1;
    const nearCooldown = Math.abs(m - CREATE_COOLDOWN_MS) <= 90_000;
    if (nearCooldown && cv <= 0.28) {
      score += 40;
      reasons.push('创建间隔高度规律');
    } else if (cv <= 0.18 && sample.length >= 5) {
      score += 30;
      reasons.push('创建节奏过于均匀');
    }
  }

  if (emptyOwnedRooms >= 3) {
    score += 35;
    reasons.push(`空闲房堆积${emptyOwnedRooms}个`);
  } else if (emptyOwnedRooms >= 2) {
    score += 22;
    reasons.push(`空闲房堆积${emptyOwnedRooms}个`);
  }

  if (rejects30m.length >= 8) {
    score += 35;
    reasons.push(`半小时内撞限流${rejects30m.length}次`);
  } else if (rejects30m.length >= 4) {
    score += 22;
    reasons.push(`半小时内撞限流${rejects30m.length}次`);
  }

  return { score, reasons };
}

function countEmptyOwnedRooms({ ip, deviceId, userId }, listRoomsFn) {
  if (typeof listRoomsFn !== 'function') return 0;
  const rooms = listRoomsFn();
  if (!Array.isArray(rooms)) return 0;
  const uid = sanitizeId(userId);
  const did = sanitizeId(deviceId);
  return rooms.filter((room) => {
    if (!room) return false;
    const matchIp = ip && room.creatorIp && room.creatorIp === ip;
    const matchDid = did && room.creatorDeviceId && room.creatorDeviceId === did;
    const matchUid = uid && room.creatorId && room.creatorId === uid;
    if (!matchIp && !matchDid && !matchUid) return false;
    const userCount = Number(room.userCount ?? room.users?.size ?? 0);
    const queueLength = Number(room.queueLength ?? room.queue?.length ?? 0);
    const idle = !room.currentSong && !room.current && !room.isPlaying && queueLength === 0;
    return userCount === 0 && idle;
  }).length;
}

async function maybeAutoBanKeys({ ip, deviceId, userId, listRoomsForGuard }) {
  const emptyOwnedRooms = countEmptyOwnedRooms({ ip, deviceId, userId }, listRoomsForGuard);
  const relatedKeys = historyKeys({ ip, deviceId, userId });
  const events = mergeEvents(relatedKeys);
  const rejects = mergeRejects(relatedKeys);
  const { score, reasons } = scoreAutomation(events, rejects, emptyOwnedRooms);
  if (score < AUTO_BAN_SCORE || reasons.length === 0) return [];

  const reason = `疑似自动建房：${reasons.join('；')}`.slice(0, 120);
  const bans = [];
  for (const { type, value } of banTargets({ ip, deviceId })) {
    if (!value) continue;
    if (isSiteBanned(type === 'ip' ? { ip: value } : { deviceId: value })) continue;
    const result = await addSiteBan({
      type,
      value,
      reason,
      source: 'auto',
    });
    if (result.success && result.ban) bans.push(result.ban);
  }
  return bans;
}

/**
 * 限流拒绝后也可触发自动拉黑（持续撞墙的脚本）。
 * @returns {Promise<{ bans: object[] }>}
 */
export async function evaluateRoomCreateRejectAutoBan({
  ip,
  deviceId,
  userId,
  listRoomsForGuard,
} = {}) {
  try {
    const bans = await maybeAutoBanKeys({ ip, deviceId, userId, listRoomsForGuard });
    return { bans };
  } catch (err) {
    console.error('room-create reject auto-ban failed:', err?.message || err);
    return { bans: [] };
  }
}

/**
 * 记录一次成功建房（含空房复用），并在疑似脚本时自动封禁。
 * @returns {Promise<{ bans: object[] }>}
 */
export async function recordRoomCreateAndMaybeAutoBan({
  ip,
  deviceId,
  userId,
  name,
  roomId,
  reused = false,
  listRoomsForGuard,
} = {}) {
  const now = Date.now();
  sweep(now);
  markCooldown({ ip, deviceId, userId }, now);

  const event = {
    at: now,
    name: normalizeName(name),
    roomId: String(roomId || '').toUpperCase(),
    reused: Boolean(reused),
  };

  for (const key of historyKeys({ ip, deviceId, userId })) {
    const list = createHistory.get(key) || [];
    list.push(event);
    const trimmed = list.filter((item) => now - item.at <= HISTORY_TTL_MS);
    while (trimmed.length > MAX_HISTORY_PER_KEY) trimmed.shift();
    rememberMapEntry(createHistory, key, trimmed, MAX_KEYS);
  }

  const bans = await maybeAutoBanKeys({ ip, deviceId, userId, listRoomsForGuard });
  return { bans };
}

/** 测试/运维用：清空进程内状态 */
export function _resetRoomCreateGuardForTests() {
  cooldownUntil.clear();
  createHistory.clear();
  rejectHistory.clear();
  lastSweepAt = 0;
}
