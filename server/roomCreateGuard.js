/**
 * 建房限流 + 疑似自动建房检测。
 * - 硬限流：同一 IP / 设备 每 5 分钟最多创建 1 次
 * - 软检测：按节奏、同名、空房堆积等打分，超阈值自动全站封禁
 */

import { addSiteBan, isSiteBanned } from './siteBan.js';

const CREATE_COOLDOWN_MS = 5 * 60 * 1000;
const HISTORY_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_HISTORY_PER_KEY = 40;
const MAX_KEYS = 8_000;
const AUTO_BAN_SCORE = 70;

/** @type {Map<string, number>} key -> nextAllowedAt */
const cooldownUntil = new Map();
/** @type {Map<string, Array<{ at: number, name: string, roomId: string }>>} */
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

function guardKeys({ ip, deviceId }) {
  const keys = [];
  if (ip) keys.push({ type: 'ip', value: ip, historyKey: `ip:${ip}` });
  if (deviceId) keys.push({ type: 'device', value: deviceId, historyKey: `did:${deviceId}` });
  return keys;
}

/**
 * @returns {{ allowed: true } | { allowed: false, error: string, retryAfterSec: number }}
 */
export function checkRoomCreateCooldown({ ip, deviceId } = {}) {
  const now = Date.now();
  sweep(now);
  const keys = guardKeys({ ip, deviceId });
  if (keys.length === 0) {
    return { allowed: true };
  }

  let blockedUntil = 0;
  for (const { historyKey } of keys) {
    const until = cooldownUntil.get(historyKey) || 0;
    if (until > now) blockedUntil = Math.max(blockedUntil, until);
  }

  if (blockedUntil > now) {
    for (const { historyKey } of keys) {
      pushTimed(rejectHistory, historyKey, now);
    }
    const retryAfterSec = Math.max(1, Math.ceil((blockedUntil - now) / 1000));
    return {
      allowed: false,
      error: `创建房间过于频繁，请 ${retryAfterSec} 秒后再试`,
      retryAfterSec,
    };
  }
  return { allowed: true };
}

function markCooldown({ ip, deviceId }, now) {
  const until = now + CREATE_COOLDOWN_MS;
  for (const { historyKey } of guardKeys({ ip, deviceId })) {
    rememberMapEntry(cooldownUntil, historyKey, until, MAX_KEYS);
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

/**
 * 打分：越高越像脚本。
 * @param {Array<{ at: number, name: string, roomId: string }>} events 已按时间升序
 * @param {number[]} rejects
 * @param {number} emptyOwnedRooms 该来源当前仍存在的空闲房数量
 */
function scoreAutomation(events, rejects, emptyOwnedRooms) {
  const now = Date.now();
  const recent1h = events.filter((e) => now - e.at <= 60 * 60 * 1000);
  const recent2h = events.filter((e) => now - e.at <= 2 * 60 * 60 * 1000);
  const rejects30m = rejects.filter((at) => now - at <= 30 * 60 * 1000);

  let score = 0;
  const reasons = [];

  if (recent1h.length >= 5) {
    score += 40;
    reasons.push(`1小时内创建${recent1h.length}次`);
  } else if (recent1h.length >= 4) {
    score += 25;
    reasons.push(`1小时内创建${recent1h.length}次`);
  } else if (recent2h.length >= 8) {
    score += 35;
    reasons.push(`2小时内创建${recent2h.length}次`);
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

  if (emptyOwnedRooms >= 4) {
    score += 30;
    reasons.push(`空闲房堆积${emptyOwnedRooms}个`);
  } else if (emptyOwnedRooms >= 3) {
    score += 18;
    reasons.push(`空闲房堆积${emptyOwnedRooms}个`);
  }

  if (rejects30m.length >= 8) {
    score += 35;
    reasons.push(`半小时内撞限流${rejects30m.length}次`);
  } else if (rejects30m.length >= 4) {
    score += 20;
    reasons.push(`半小时内撞限流${rejects30m.length}次`);
  }

  return { score, reasons };
}

function countEmptyOwnedRooms({ ip, deviceId }, listRoomsFn) {
  if (typeof listRoomsFn !== 'function') return 0;
  const rooms = listRoomsFn();
  if (!Array.isArray(rooms)) return 0;
  return rooms.filter((room) => {
    if (!room) return false;
    const matchIp = ip && room.creatorIp && room.creatorIp === ip;
    const matchDid = deviceId && room.creatorDeviceId && room.creatorDeviceId === deviceId;
    if (!matchIp && !matchDid) return false;
    const userCount = Number(room.userCount ?? room.users?.size ?? 0);
    const queueLength = Number(room.queueLength ?? room.queue?.length ?? 0);
    const idle = !room.currentSong && !room.current && !room.isPlaying && queueLength === 0;
    return userCount === 0 && idle;
  }).length;
}

async function maybeAutoBanKeys({ ip, deviceId, listRoomsForGuard }) {
  const emptyOwnedRooms = countEmptyOwnedRooms({ ip, deviceId }, listRoomsForGuard);
  const bans = [];

  for (const { type, value, historyKey } of guardKeys({ ip, deviceId })) {
    if (!value) continue;
    if (isSiteBanned(type === 'ip' ? { ip: value } : { deviceId: value })) continue;

    const events = (createHistory.get(historyKey) || []).slice().sort((a, b) => a.at - b.at);
    const rejects = rejectHistory.get(historyKey) || [];
    const { score, reasons } = scoreAutomation(events, rejects, emptyOwnedRooms);
    if (score < AUTO_BAN_SCORE || reasons.length === 0) continue;

    const reason = `疑似自动建房：${reasons.join('；')}`.slice(0, 120);
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
  listRoomsForGuard,
} = {}) {
  try {
    const bans = await maybeAutoBanKeys({ ip, deviceId, listRoomsForGuard });
    return { bans };
  } catch (err) {
    console.error('room-create reject auto-ban failed:', err?.message || err);
    return { bans: [] };
  }
}

/**
 * 记录一次成功建房，并在疑似脚本时自动封禁。
 * @returns {Promise<{ bans: object[] }>}
 */
export async function recordRoomCreateAndMaybeAutoBan({
  ip,
  deviceId,
  name,
  roomId,
  listRoomsForGuard,
} = {}) {
  const now = Date.now();
  sweep(now);
  markCooldown({ ip, deviceId }, now);

  const event = {
    at: now,
    name: normalizeName(name),
    roomId: String(roomId || '').toUpperCase(),
  };

  for (const { historyKey } of guardKeys({ ip, deviceId })) {
    const list = createHistory.get(historyKey) || [];
    list.push(event);
    const trimmed = list.filter((item) => now - item.at <= HISTORY_TTL_MS);
    while (trimmed.length > MAX_HISTORY_PER_KEY) trimmed.shift();
    rememberMapEntry(createHistory, historyKey, trimmed, MAX_KEYS);
  }

  const bans = await maybeAutoBanKeys({ ip, deviceId, listRoomsForGuard });
  return { bans };
}

/** 测试/运维用：清空进程内状态 */
export function _resetRoomCreateGuardForTests() {
  cooldownUntil.clear();
  createHistory.clear();
  rejectHistory.clear();
  lastSweepAt = 0;
}
