import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { listRoomsForAdmin, adminDestroyRoom, isRedisEnabled } from './roomManager.js';
import { getMetingUpstreamStatus } from './metingUpstream.js';
import {
  getAdminEntryPath,
  setAdminEntryPath,
  createRandomAdminEntryPath,
  sanitizeAdminEntryPath,
} from './adminConfig.js';

const ADMIN_KEY = String(process.env.ADMIN_KEY || '').trim();
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 小时
const ADMIN_COOKIE = 'om_admin_sid';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// 进程内会话表：重启后全部失效；logout / 吊销可立即生效（不依赖前端清存储）
const activeSessions = new Map();
const AUDIT_MAX = 100;
const auditEntries = [];

export function isAdminEnabled() {
  return ADMIN_KEY.length >= 8;
}

function hmac(input) {
  // 仅用于密钥比对的等长时间摘要，不参与会话签发
  return createHmac('sha256', 'om-admin-eq').update(input).digest();
}

function safeEqual(a, b) {
  const ha = hmac(`eq:${a}`);
  const hb = hmac(`eq:${b}`);
  return timingSafeEqual(ha, hb);
}

function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    try {
      out[decodeURIComponent(key)] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function createSession() {
  const sid = randomBytes(24).toString('base64url');
  const exp = Date.now() + ADMIN_SESSION_TTL_MS;
  activeSessions.set(sid, { exp, createdAt: Date.now() });
  return { sid, exp };
}

function revokeSession(sid) {
  if (sid) activeSessions.delete(sid);
}

function getSessionIdFromRequest(req) {
  const cookies = parseCookieHeader(req.headers?.cookie || '');
  return String(cookies[ADMIN_COOKIE] || '').trim();
}

function verifySession(req) {
  const sid = getSessionIdFromRequest(req);
  if (!sid) return null;
  const session = activeSessions.get(sid);
  if (!session) return null;
  if (Date.now() > session.exp) {
    activeSessions.delete(sid);
    return null;
  }
  return { sid, ...session };
}

function adminCookieFlags(maxAgeSec) {
  const secure = IS_PRODUCTION ? '; Secure' : '';
  // Path 限定管理 API，降低被同站其它路径带出的面；Strict 降低 CSRF 风险
  return `Path=/api/admin; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Strict${secure}`;
}

function setAdminSessionCookie(res, sid) {
  const maxAgeSec = Math.floor(ADMIN_SESSION_TTL_MS / 1000);
  res.append('Set-Cookie', `${ADMIN_COOKIE}=${encodeURIComponent(sid)}; ${adminCookieFlags(maxAgeSec)}`);
}

function clearAdminSessionCookie(res) {
  res.append('Set-Cookie', `${ADMIN_COOKIE}=; ${adminCookieFlags(0)}`);
}

function audit(action, detail = {}, ip = '') {
  const entry = {
    at: Date.now(),
    action,
    ip: String(ip || ''),
    ...detail,
  };
  auditEntries.unshift(entry);
  if (auditEntries.length > AUDIT_MAX) auditEntries.length = AUDIT_MAX;
  const extra = Object.entries(detail)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');
  console.info(
    `[admin-audit] ${new Date(entry.at).toISOString()} action=${action} ip=${entry.ip || '-'} ${extra}`.trim(),
  );
}

// 登录限流：短窗次数限制 + 连续失败逐步加长锁定（缓解撞库 / 分布式试探）
const loginGuard = new Map();
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_WINDOW_MAX = 5;
const LOCK_BASE_MS = 60_000;
const LOCK_MAX_MS = 60 * 60 * 1000;

function getLoginGuard(ip) {
  const key = ip || 'unknown';
  let entry = loginGuard.get(key);
  if (!entry) {
    entry = { windowStart: Date.now(), windowCount: 0, failCount: 0, lockedUntil: 0 };
    loginGuard.set(key, entry);
  }
  return entry;
}

function getLoginBlock(ip) {
  const now = Date.now();
  const entry = getLoginGuard(ip);
  if (entry.lockedUntil > now) {
    return {
      blocked: true,
      retryAfterSec: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)),
      reason: 'locked',
    };
  }
  if (now - entry.windowStart > LOGIN_WINDOW_MS) {
    entry.windowStart = now;
    entry.windowCount = 0;
  }
  if (entry.windowCount >= LOGIN_WINDOW_MAX) {
    return {
      blocked: true,
      retryAfterSec: Math.max(1, Math.ceil((entry.windowStart + LOGIN_WINDOW_MS - now) / 1000)),
      reason: 'rate',
    };
  }
  return { blocked: false };
}

function noteLoginAttempt(ip) {
  const entry = getLoginGuard(ip);
  const now = Date.now();
  if (now - entry.windowStart > LOGIN_WINDOW_MS) {
    entry.windowStart = now;
    entry.windowCount = 0;
  }
  entry.windowCount += 1;
}

function noteLoginFailure(ip) {
  const entry = getLoginGuard(ip);
  entry.failCount += 1;
  // 每累计 5 次失败锁定一次，时长 1m → 2m → 4m … 封顶 1h
  if (entry.failCount % 5 === 0) {
    const tier = Math.max(0, Math.floor(entry.failCount / 5) - 1);
    const lockMs = Math.min(LOCK_MAX_MS, LOCK_BASE_MS * (2 ** tier));
    entry.lockedUntil = Date.now() + lockMs;
  }
}

function noteLoginSuccess(ip) {
  const entry = getLoginGuard(ip);
  entry.failCount = 0;
  entry.lockedUntil = 0;
  entry.windowCount = 0;
  entry.windowStart = Date.now();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginGuard.entries()) {
    if (entry.lockedUntil < now && now - entry.windowStart > 120_000 && entry.failCount === 0) {
      loginGuard.delete(ip);
    }
  }
  for (const [sid, session] of activeSessions.entries()) {
    if (session.exp <= now) activeSessions.delete(sid);
  }
}, 300_000).unref();

// 入口路径探测限流（防枚举）
const gateAttempts = new Map();
function isGateRateLimited(ip) {
  const now = Date.now();
  const entry = gateAttempts.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    gateAttempts.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > 30;
}

function pathsEqual(a, b) {
  return safeEqual(String(a || ''), String(b || ''));
}

export function mountAdminApi(app, { io, socketToRoom, socketToUserId, getClientIp }) {
  // 校验当前前端路径是否为管理入口（不返回真实路径，避免泄露）
  app.post('/api/admin/gate', (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    if (isGateRateLimited(ip)) {
      return res.status(429).json({ match: false, error: '尝试过于频繁' });
    }
    if (!isAdminEnabled()) {
      return res.json({ match: false });
    }
    const candidate = sanitizeAdminEntryPath(req.body?.path);
    const configured = getAdminEntryPath();
    res.json({ match: Boolean(candidate && pathsEqual(candidate, configured)) });
  });

  // 会话探测：未登录与未启用一律 401，避免公开探测「是否配置了 ADMIN_KEY」
  app.get('/api/admin/session', (req, res) => {
    if (!isAdminEnabled() || !verifySession(req)) {
      clearAdminSessionCookie(res);
      return res.status(401).json({ error: '未登录或登录已过期' });
    }
    res.json({ ok: true, expiresInMs: ADMIN_SESSION_TTL_MS, entryPath: getAdminEntryPath() });
  });

  app.post('/api/admin/login', (req, res) => {
    if (!isAdminEnabled()) {
      return res.status(503).json({ error: '管理后台未启用（需配置 ADMIN_KEY，至少 8 位）' });
    }
    const ip = getClientIp?.(req) || req.ip || '';
    const block = getLoginBlock(ip);
    if (block.blocked) {
      res.setHeader('Retry-After', String(block.retryAfterSec));
      return res.status(429).json({
        error: block.reason === 'locked'
          ? `登录已锁定，请 ${block.retryAfterSec} 秒后再试`
          : '尝试过于频繁，请稍后再试',
        retryAfterSec: block.retryAfterSec,
      });
    }
    noteLoginAttempt(ip);

    const key = String(req.body?.key || '');
    if (!key || !safeEqual(key, ADMIN_KEY)) {
      noteLoginFailure(ip);
      audit('login_fail', {}, ip);
      const after = getLoginBlock(ip);
      if (after.blocked && after.reason === 'locked') {
        res.setHeader('Retry-After', String(after.retryAfterSec));
        return res.status(429).json({
          error: `密钥错误，登录已锁定 ${after.retryAfterSec} 秒`,
          retryAfterSec: after.retryAfterSec,
        });
      }
      return res.status(403).json({ error: '密钥错误' });
    }

    noteLoginSuccess(ip);
    const { sid } = createSession();
    setAdminSessionCookie(res, sid);
    audit('login_ok', {}, ip);
    res.json({ ok: true, expiresInMs: ADMIN_SESSION_TTL_MS });
  });

  app.post('/api/admin/logout', (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const sid = getSessionIdFromRequest(req);
    if (sid) {
      revokeSession(sid);
      audit('logout', {}, ip);
    }
    clearAdminSessionCookie(res);
    res.json({ ok: true });
  });

  function requireAdmin(req, res, next) {
    if (!isAdminEnabled()) {
      clearAdminSessionCookie(res);
      return res.status(503).json({ error: '管理后台未启用' });
    }
    const session = verifySession(req);
    if (!session) {
      clearAdminSessionCookie(res);
      return res.status(401).json({ error: '未登录或登录已过期' });
    }
    req.adminSession = session;
    next();
  }

  app.get('/api/admin/overview', requireAdmin, (_req, res) => {
    const rooms = listRoomsForAdmin();
    const mem = process.memoryUsage();
    res.json({
      roomCount: rooms.length,
      onlineUsers: rooms.reduce((sum, r) => sum + r.userCount, 0),
      playingRooms: rooms.filter((r) => r.isPlaying).length,
      connectedSockets: io.engine?.clientsCount ?? 0,
      uptimeSec: Math.floor(process.uptime()),
      memoryRssMb: Math.round(mem.rss / 1024 / 1024),
      redisEnabled: isRedisEnabled(),
      metingUpstreams: getMetingUpstreamStatus(),
      entryPath: getAdminEntryPath(),
      auditLog: auditEntries.slice(0, 50),
    });
  });

  app.put('/api/admin/entry-path', requireAdmin, (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = setAdminEntryPath(req.body?.path);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    audit('set_entry_path', { path: result.entryPath }, ip);
    res.json({ ok: true, entryPath: result.entryPath });
  });

  app.post('/api/admin/entry-path/random', requireAdmin, (_req, res) => {
    res.json({ path: createRandomAdminEntryPath() });
  });

  app.get('/api/admin/rooms', requireAdmin, (_req, res) => {
    res.json({ rooms: listRoomsForAdmin() });
  });

  app.delete('/api/admin/rooms/:id', requireAdmin, (req, res) => {
    const roomId = String(req.params.id || '').toUpperCase();
    const ip = getClientIp?.(req) || req.ip || '';
    // 先把房内连接踢出，避免解散后客户端仍持有旧状态
    // 先收集再删除，避免在遍历 Map 的同时修改它
    const sidsToKick = [];
    for (const [sid, rid] of socketToRoom.entries()) {
      if (rid === roomId) sidsToKick.push(sid);
    }
    for (const sid of sidsToKick) {
      const s = io.sockets.sockets.get(sid);
      socketToRoom.delete(sid);
      socketToUserId.delete(sid);
      s?.leave(roomId);
      s?.emit('kicked', { message: '房间已被站点管理员解散' });
    }
    const result = adminDestroyRoom(roomId);
    if (!result.success) {
      audit('destroy_room_fail', { roomId, error: result.error }, ip);
      return res.status(404).json({ error: result.error });
    }
    audit('destroy_room', { roomId, name: result.name, kicked: sidsToKick.length }, ip);
    res.json({ success: true, name: result.name });
  });
}
