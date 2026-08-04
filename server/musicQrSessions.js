import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { createMusicQrSession, checkMusicQrSession } from './metingAdmin.js';
import { getRedisClient } from './roomStorage.js';
import { decryptSensitiveValue, encryptSensitiveValue } from './roomCredentialCrypto.js';

const SESSION_TTL_MS = 10 * 60 * 1000;
const CONFIRMED_TTL_MS = 2 * 60 * 1000;
const BINDING_LOCK_MS = 30 * 1000;
const sessions = new Map();
const REDIS_PREFIX = 'openmusic:music-qr:';

function redisKey(id) { return `${REDIS_PREFIX}${id}`; }

async function persistSession(id, session) {
  const redis = getRedisClient();
  if (!redis) return true;
  const encrypted = encryptSensitiveValue(JSON.stringify(session), id);
  if (!encrypted) throw new Error('房间凭证加密密钥不可用，无法保存扫码会话');
  await redis.set(redisKey(id), encrypted, { PX: Math.max(1000, session.expiresAt - Date.now()) });
  return true;
}

async function loadSession(id) {
  const local = sessions.get(id);
  if (local) return local;
  const redis = getRedisClient();
  if (!redis) return null;
  const encrypted = await redis.get(redisKey(id));
  if (!encrypted) return null;
  const raw = decryptSensitiveValue(encrypted, id);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (session.expiresAt <= Date.now()) {
      await redis.del(redisKey(id));
      return null;
    }
    sessions.set(id, session);
    return session;
  } catch { return null; }
}

async function removeSession(id) {
  sessions.delete(id);
  const redis = getRedisClient();
  if (redis) await redis.del(redisKey(id));
}

function text(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function unwrap(value) {
  let current = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  for (let i = 0; i < 2; i += 1) {
    const nested = current.data || current.result;
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) break;
    current = nested;
  }
  return current;
}

function normalizeStatus(value) {
  const raw = text(value).toLowerCase();
  if (['0', 'waiting', 'wait', 'pending', 'new'].includes(raw)) return 'waiting';
  if (['1', 'scanned', 'scan', '已扫码'].includes(raw)) return 'scanned';
  if (['2', 'confirmed', 'confirm', 'success', 'authorized'].includes(raw)) return 'confirmed';
  if (['3', 'expired', 'expire', 'timeout'].includes(raw)) return 'expired';
  if (['error', 'failed', 'fail'].includes(raw)) return 'error';
  return raw || 'waiting';
}

function extractCookie(value) {
  const raw = unwrap(value);
  for (const candidate of [raw.cookie, raw.cookies, raw.credential, raw.token]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  const object = raw.cookie && typeof raw.cookie === 'object' && !Array.isArray(raw.cookie)
    ? raw.cookie
    : null;
  if (!object) return '';
  return Object.entries(object)
    .map(([key, item]) => `${key}=${text(item)}`)
    .filter((pair) => !pair.endsWith('='))
    .join('; ');
}

function normalizeQrImage(value) {
  const raw = text(value);
  if (raw.startsWith('data:image/')) return raw;
  if (/^[a-z\d+/]+=*$/i.test(raw) && raw.length > 100) return `data:image/png;base64,${raw}`;
  return '';
}

function cleanExpired() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

async function requireOwnedSession({ sessionId, ownerId, purpose, roomId = '' }) {
  cleanExpired();
  const session = await loadSession(text(sessionId));
  if (!session || session.ownerId !== text(ownerId) || session.purpose !== purpose) return null;
  if (purpose === 'room' && session.roomId !== text(roomId).toUpperCase()) return null;
  return session;
}

export async function createManagedMusicQrSession({ ownerId, platform, purpose, roomId = '' }) {
  cleanExpired();
  const result = await createMusicQrSession(platform);
  if (!result.ok) return result;
  const raw = unwrap(result.data);
  const key = text(raw.key || raw.uuid || raw.unikey || raw.qrKey);
  const qrsig = text(raw.qrsig || raw.qr_sig || raw.qrSig || raw.key || raw.uuid);
  if (platform === 'tencent' ? !qrsig : !key) {
    return { ok: false, error: '上游未返回有效扫码会话' };
  }
  const sessionId = randomBytes(32).toString('base64url');
  const qrUrl = text(raw.qrurl || raw.qrUrl || raw.url || raw.loginUrl);
  let qrImage = normalizeQrImage(raw.qrimg || raw.qrImage || raw.image || raw.base64);
  if (!qrImage && qrUrl) qrImage = await QRCode.toDataURL(qrUrl, { width: 320, margin: 1 });
  const session = {
    ownerId: text(ownerId),
    roomId: text(roomId).toUpperCase(),
    platform,
    purpose,
    upstream: { platform, key, qrsig, ptqrtoken: text(raw.ptqrtoken || raw.ptqrToken) },
    credential: '',
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(sessionId, session);
  try { await persistSession(sessionId, session); } catch (err) {
    sessions.delete(sessionId);
    return { ok: false, error: `扫码会话保存失败：${err.message}` };
  }
  return {
    ok: true,
    data: {
      sessionId,
      platform,
      qrimg: qrImage || undefined,
      message: text(raw.message || raw.msg) || undefined,
    },
  };
}

export async function checkManagedMusicQrSession(context) {
  const session = await requireOwnedSession(context);
  if (!session) return { ok: false, status: 404, error: '扫码会话无效或已过期' };
  if (session.credential) return { ok: true, data: { status: 'confirmed' } };
  const result = await checkMusicQrSession(session.upstream);
  if (!result.ok) return result;
  const raw = unwrap(result.data);
  const status = normalizeStatus(raw.status ?? raw.code ?? raw.state);
  if (status === 'confirmed') {
    const credential = extractCookie(raw);
    if (!credential) return { ok: false, error: '登录成功但上游未返回有效凭证' };
    session.credential = credential;
    session.bindingUntil = 0;
    session.expiresAt = Date.now() + CONFIRMED_TTL_MS;
    try {
      await persistSession(text(context.sessionId), session);
    } catch (err) {
      session.credential = '';
      return { ok: false, error: `扫码凭证保存失败：${err.message}` };
    }
  }
  if (status === 'expired' || status === 'error') await removeSession(text(context.sessionId));
  return {
    ok: true,
    data: {
      status,
      message: text(raw.message || raw.msg) || undefined,
    },
  };
}

export async function getManagedMusicQrCredential(context) {
  const session = await requireOwnedSession(context);
  if (!session?.credential) return { ok: false, error: '扫码尚未确认或会话已过期' };
  if (Number(session.bindingUntil) > Date.now()) return { ok: false, error: '该扫码凭证正在绑定，请稍候重试' };
  session.bindingUntil = Date.now() + BINDING_LOCK_MS;
  try {
    await persistSession(text(context.sessionId), session);
  } catch (err) {
    session.bindingUntil = 0;
    return { ok: false, error: `扫码凭证锁定失败：${err.message}` };
  }
  return { ok: true, platform: session.platform, cookie: session.credential };
}

export async function releaseManagedMusicQrCredential(context) {
  const session = await requireOwnedSession(context);
  if (!session?.credential) return false;
  session.bindingUntil = 0;
  try {
    await persistSession(text(context.sessionId), session);
    return true;
  } catch {
    return false;
  }
}

export async function finalizeManagedMusicQrCredential(context) {
  const session = await requireOwnedSession(context);
  if (!session?.credential || Number(session.bindingUntil) <= 0) return false;
  await removeSession(text(context.sessionId));
  return true;
}

// 兼容旧调用方；新的绑定流程必须使用 get + finalize/release。
export function consumeManagedMusicQrCredential(context) {
  cleanExpired();
  const session = sessions.get(text(context.sessionId));
  if (!session || session.ownerId !== text(context.ownerId) || session.purpose !== context.purpose
    || (context.purpose === 'room' && session.roomId !== text(context.roomId).toUpperCase())
    || !session.credential) return { ok: false, error: '扫码尚未确认或会话已过期' };
  sessions.delete(text(context.sessionId));
  return { ok: true, platform: session.platform, cookie: session.credential };
}

export const __test = { sessions, extractCookie, normalizeStatus };
