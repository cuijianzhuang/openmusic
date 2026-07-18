import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  listRoomsForAdmin,
  adminDestroyRoom,
  isRedisEnabled,
  setRoomProtectedFromDestroy,
  broadcastAdminSystemMessage,
  getRoomInternal,
  removeUser,
  prepareRoomBroadcast,
  roomUpdateForViewer,
} from './roomManager.js';
import { getRedisClient } from './roomStorage.js';
import {
  getMetingUpstreamStatus,
  resetMetingUpstreamCooldown,
  setMetingUpstreamDisabled,
} from './metingUpstream.js';
import { getLrcapiUpstreamStatus } from './lrcapiUpstream.js';
import {
  getAdminEntryPath,
  setAdminEntryPath,
  createRandomAdminEntryPath,
  sanitizeAdminEntryPath,
  mustChangeAdminEntryPath,
} from './adminConfig.js';
import { getSiteAnnouncementForAdmin, setSiteAnnouncement } from './siteAnnouncement.js';
import { listSiteBans, addSiteBan, removeSiteBan } from './siteBan.js';
import {
  listErrorReports,
  getErrorReport,
  updateErrorReport,
  deleteErrorReport,
} from './errorReports.js';
import { sanitizeDeviceId } from './deviceIdentity.js';
import { getRuntimeConfigForAdmin, setRuntimeConfig } from './runtimeConfig.js';
import {
  isAdminEnabled,
  verifyAdminCredentials,
  setAdminCredentials,
  getAdminUsername,
  isAdminCredentialsPersisted,
  mustChangeAdminCredentials,
} from './adminCredentials.js';

export { isAdminEnabled };

function getAdminSetupStatus() {
  const mustChangeCredentials = mustChangeAdminCredentials();
  const mustChangeEntryPath = mustChangeAdminEntryPath();
  return {
    mustChangeCredentials,
    mustChangeEntryPath,
    setupRequired: mustChangeCredentials || mustChangeEntryPath,
  };
}

const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 小时
const ADMIN_COOKIE = 'om_admin_sid';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_AUDIT_KEY = 'openmusic:admin:audit';
/** Redis 保留最近 N 条；面板只展示前 50 条 */
const AUDIT_MAX = 500;

// 进程内会话表：重启后全部失效；logout / 吊销可立即生效（不依赖前端清存储）
const activeSessions = new Map();

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
  const extra = Object.entries(detail)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');
  console.info(
    `[admin-audit] ${new Date(entry.at).toISOString()} action=${action} ip=${entry.ip || '-'} ${extra}`.trim(),
  );

  const client = getRedisClient();
  if (!client) {
    console.error('admin-audit: Redis 不可用，审计记录未持久化');
    return;
  }
  void client
    .lPush(ADMIN_AUDIT_KEY, JSON.stringify(entry))
    .then(() => client.lTrim(ADMIN_AUDIT_KEY, 0, AUDIT_MAX - 1))
    .catch((err) => {
      console.error('admin-audit Redis 写入失败:', err?.message || err);
    });
}

async function listAuditLogPage({ offset = 0, limit = 20 } = {}) {
  const pageSize = Math.min(Math.max(1, Number(limit) || 20), 100);
  const start = Math.max(0, Number(offset) || 0);
  const client = getRedisClient();
  if (!client) return { items: [], total: 0, offset: start, limit: pageSize };
  try {
    const total = await client.lLen(ADMIN_AUDIT_KEY);
    if (start >= total) {
      return { items: [], total, offset: start, limit: pageSize };
    }
    const end = Math.min(start + pageSize - 1, total - 1);
    const rows = await client.lRange(ADMIN_AUDIT_KEY, start, end);
    const items = rows.map((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }).filter(Boolean);
    return { items, total, offset: start, limit: pageSize };
  } catch (err) {
    console.error('admin-audit Redis 读取失败:', err?.message || err);
    return { items: [], total: 0, offset: start, limit: pageSize };
  }
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
  for (const [ip, entry] of gateAttempts.entries()) {
    if (now - entry.windowStart > 120_000) gateAttempts.delete(ip);
  }
}, 300_000).unref();

function pathsEqual(a, b) {
  return safeEqual(String(a || ''), String(b || ''));
}

const AUTH_DENIED = { error: '未登录或登录已过期' };
const KEY_DENIED = { error: '账号或密码错误' };

function resolveRequestOrigin(req) {
  const origin = String(req.headers?.origin || '').trim().replace(/\/$/, '');
  if (origin) return origin;
  const referer = String(req.headers?.referer || '').trim();
  if (!referer) return '';
  try {
    return new URL(referer).origin.replace(/\/$/, '');
  } catch {
    return '';
  }
}

/** Origin 的 host 与请求 Host 一致即视为同源（浏览器无法伪造 Origin，天然防 CSRF） */
function isSameHostOrigin(req, origin) {
  const host = String(req.headers?.host || '').trim();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * 写操作 Origin / Referer 白名单校验（SameSite=Strict 之外再加一层）
 * @param {Set<string> | null} allowedOrigins
 */
function createRequireAdminOrigin(allowedOrigins) {
  return function requireAdminOrigin(req, res, next) {
    const origin = resolveRequestOrigin(req);

    if (allowedOrigins && allowedOrigins.size > 0) {
      // 白名单命中或同源请求（如本地 localhost 直连服务端口调试）均放行
      if (!origin || (!allowedOrigins.has(origin) && !isSameHostOrigin(req, origin))) {
        return res.status(403).json({ error: '请求来源不被允许' });
      }
      return next();
    }

    // 未配置 CLIENT_URL：若带 Origin，必须与 Host 同源；无 Origin（如 curl）仅非生产放行
    if (origin) {
      const host = String(req.headers?.host || '').trim();
      try {
        if (new URL(origin).host !== host) {
          return res.status(403).json({ error: '请求来源不被允许' });
        }
      } catch {
        return res.status(403).json({ error: '请求来源不被允许' });
      }
      return next();
    }

    if (IS_PRODUCTION) {
      return res.status(403).json({ error: '请求来源不被允许' });
    }
    next();
  };
}

export function mountAdminApi(app, { io, socketToRoom, socketToUserId, getClientIp, allowedOrigins = null }) {
  const requireAdminOrigin = createRequireAdminOrigin(allowedOrigins);

  // 校验当前前端路径是否为管理入口（不返回真实路径，避免泄露）
  app.post('/api/admin/gate', (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    if (isGateRateLimited(ip)) {
      return res.status(429).json({ match: false, error: '尝试过于频繁' });
    }
    // 未启用与路径不匹配一律 match:false，不泄露启用态
    if (!isAdminEnabled()) {
      return res.json({ match: false });
    }
    const candidate = sanitizeAdminEntryPath(req.body?.path);
    const configured = getAdminEntryPath();
    res.json({ match: Boolean(candidate && pathsEqual(candidate, configured)) });
  });

  // 会话探测：未登录与未启用一律 401，避免公开探测「管理后台是否启用」
  app.get('/api/admin/session', (req, res) => {
    if (!isAdminEnabled() || !verifySession(req)) {
      clearAdminSessionCookie(res);
      return res.status(401).json(AUTH_DENIED);
    }
    const setup = getAdminSetupStatus();
    res.json({
      ok: true,
      expiresInMs: ADMIN_SESSION_TTL_MS,
      entryPath: getAdminEntryPath(),
      ...setup,
    });
  });

  app.post('/api/admin/login', requireAdminOrigin, async (req, res) => {
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

    // 未启用与凭据错误统一 403「账号或密码错误」，避免探测后台是否启用
    const username = String(req.body?.username || '').trim();
    // 兼容旧客户端仍以 key 字段提交
    const password = String(req.body?.password ?? req.body?.key ?? '');
    const verified = isAdminEnabled() && username && password
      ? await verifyAdminCredentials(username, password)
      : false;
    if (!verified) {
      noteLoginFailure(ip);
      audit('login_fail', { username }, ip);
      const after = getLoginBlock(ip);
      if (after.blocked && after.reason === 'locked') {
        res.setHeader('Retry-After', String(after.retryAfterSec));
        return res.status(429).json({
          error: `账号或密码错误，登录已锁定 ${after.retryAfterSec} 秒`,
          retryAfterSec: after.retryAfterSec,
        });
      }
      return res.status(403).json(KEY_DENIED);
    }

    noteLoginSuccess(ip);
    const { sid } = createSession();
    setAdminSessionCookie(res, sid);
    audit('login_ok', { username }, ip);
    const setup = getAdminSetupStatus();
    res.json({ ok: true, expiresInMs: ADMIN_SESSION_TTL_MS, ...setup });
  });

  app.post('/api/admin/logout', requireAdminOrigin, (req, res) => {
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
    // 未启用与未登录统一 401，不泄露启用态
    const session = isAdminEnabled() ? verifySession(req) : null;
    if (!session) {
      clearAdminSessionCookie(res);
      return res.status(401).json(AUTH_DENIED);
    }
    req.adminSession = session;
    next();
  }

  /** 初始安全设置未完成时，拦截除改密 / 改入口外的写操作 */
  function requireAdminSetupComplete(req, res, next) {
    const setup = getAdminSetupStatus();
    if (!setup.setupRequired) return next();
    return res.status(403).json({
      error: '请先完成初始安全设置（修改默认账号密码与登录地址）',
      ...setup,
    });
  }

  app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
    const rooms = listRoomsForAdmin();
    const mem = process.memoryUsage();
    const setup = getAdminSetupStatus();
    res.json({
      roomCount: rooms.length,
      onlineUsers: rooms.reduce((sum, r) => sum + r.userCount, 0),
      playingRooms: rooms.filter((r) => r.isPlaying).length,
      connectedSockets: io.engine?.clientsCount ?? 0,
      uptimeSec: Math.floor(process.uptime()),
      memoryRssMb: Math.round(mem.rss / 1024 / 1024),
      redisEnabled: isRedisEnabled(),
      metingUpstreams: getMetingUpstreamStatus(),
      lrcapiUpstreams: getLrcapiUpstreamStatus(),
      entryPath: getAdminEntryPath(),
      adminUsername: getAdminUsername(),
      credentialsPersisted: isAdminCredentialsPersisted(),
      ...setup,
      auditStoredIn: 'redis',
    });
  });

  app.get('/api/admin/audit', requireAdmin, async (req, res) => {
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || '20'), 10) || 20));
    const result = await listAuditLogPage({ offset: (page - 1) * pageSize, limit: pageSize });
    res.json({
      items: result.items,
      total: result.total,
      page,
      pageSize: result.limit,
      totalPages: Math.max(1, Math.ceil(result.total / result.limit) || 1),
    });
  });

  // 修改管理员账号密码（存 Redis；需验证当前密码；限流防会话泄露后爆破）
  app.put('/api/admin/credentials', requireAdminOrigin, requireAdmin, async (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const block = getLoginBlock(ip);
    if (block.blocked) {
      res.setHeader('Retry-After', String(block.retryAfterSec));
      return res.status(429).json({
        error: block.reason === 'locked'
          ? `操作已锁定，请 ${block.retryAfterSec} 秒后再试`
          : '尝试过于频繁，请稍后再试',
        retryAfterSec: block.retryAfterSec,
      });
    }
    noteLoginAttempt(ip);

    const result = await setAdminCredentials({
      username: req.body?.username,
      password: req.body?.password,
      currentPassword: req.body?.currentPassword,
    });
    if (!result.success) {
      noteLoginFailure(ip);
      audit('set_credentials_fail', {}, ip);
      const after = getLoginBlock(ip);
      if (after.blocked && after.reason === 'locked') {
        res.setHeader('Retry-After', String(after.retryAfterSec));
        return res.status(429).json({
          error: `当前密码错误，操作已锁定 ${after.retryAfterSec} 秒`,
          retryAfterSec: after.retryAfterSec,
        });
      }
      return res.status(400).json({ error: result.error });
    }
    noteLoginSuccess(ip);
    // 保留当前会话，吊销其它已登录会话
    const currentSid = req.adminSession?.sid;
    for (const sid of activeSessions.keys()) {
      if (sid !== currentSid) activeSessions.delete(sid);
    }
    audit('set_credentials', { username: result.username, persisted: result.persisted }, ip);
    res.json({
      ok: true,
      username: result.username,
      persisted: result.persisted,
      ...getAdminSetupStatus(),
    });
  });

  app.put('/api/admin/entry-path', requireAdminOrigin, requireAdmin, (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const requireCustom = mustChangeAdminEntryPath();
    const result = setAdminEntryPath(req.body?.path, { requireCustom });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    audit('set_entry_path', { path: result.entryPath }, ip);
    res.json({ ok: true, entryPath: result.entryPath, ...getAdminSetupStatus() });
  });

  app.post('/api/admin/entry-path/random', requireAdminOrigin, requireAdmin, (_req, res) => {
    res.json({ path: createRandomAdminEntryPath() });
  });

  app.get('/api/admin/runtime-config', requireAdmin, (_req, res) => {
    res.json({ config: getRuntimeConfigForAdmin() });
  });

  app.put('/api/admin/runtime-config', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = setRuntimeConfig(req.body || {});
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    audit('set_runtime_config', {}, ip);
    res.json({ ok: true, config: result.config });
  });

  app.get('/api/admin/announcement', requireAdmin, (_req, res) => {
    res.json({ announcement: getSiteAnnouncementForAdmin() });
  });

  app.put('/api/admin/announcement', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = await setSiteAnnouncement({
      enabled: Boolean(req.body?.enabled),
      title: req.body?.title,
      text: req.body?.text,
      bumpId: Boolean(req.body?.bumpId),
    });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    audit('set_announcement', {
      enabled: result.announcement.enabled,
      announcementId: result.announcement.id,
    }, ip);
    res.json({ ok: true, announcement: result.announcement });
  });

  app.get('/api/admin/rooms', requireAdmin, (_req, res) => {
    res.json({ rooms: listRoomsForAdmin() });
  });

  app.put('/api/admin/rooms/:id/protection', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const roomId = String(req.params.id || '').toUpperCase();
    const ip = getClientIp?.(req) || req.ip || '';
    const result = await setRoomProtectedFromDestroy(roomId, Boolean(req.body?.enabled));
    if (!result.success) {
      return res.status(result.error === '房间不存在' ? 404 : 503).json({ error: result.error });
    }
    audit('set_room_protection', {
      roomId,
      enabled: result.protectedFromDestroy,
    }, ip);
    res.json(result);
  });

  app.post('/api/admin/meting/reset-cooldown', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = resetMetingUpstreamCooldown(req.body?.url);
    if (!result.success) return res.status(404).json({ error: result.error });
    audit('meting_reset_cooldown', { url: result.upstream?.url }, ip);
    res.json(result);
  });

  app.post('/api/admin/meting/disable', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = setMetingUpstreamDisabled(req.body?.url, Boolean(req.body?.disabled));
    if (!result.success) return res.status(404).json({ error: result.error });
    audit('meting_set_disabled', {
      url: result.upstream?.url,
      disabled: result.upstream?.disabled,
    }, ip);
    res.json(result);
  });

  app.post('/api/admin/broadcast', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = broadcastAdminSystemMessage(req.body?.text);
    if (!result.success) return res.status(400).json({ error: result.error });

    for (const delivery of result.deliveries || []) {
      io.to(delivery.roomId).emit('chat_message', delivery.message);
      io.to(delivery.roomId).emit('chat_message', delivery.toast);
    }

    audit('broadcast', { roomCount: result.roomCount }, ip);
    res.json({ success: true, roomCount: result.roomCount });
  });

  app.get('/api/admin/bans', requireAdmin, (_req, res) => {
    res.json({ bans: listSiteBans() });
  });

  app.post('/api/admin/bans', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const adminIp = getClientIp?.(req) || req.ip || '';
    const result = await addSiteBan({
      type: req.body?.type,
      value: req.body?.value,
      reason: req.body?.reason,
    });
    if (!result.success) return res.status(400).json({ error: result.error });

    // 立即踢出在线匹配连接
    let kicked = 0;
    const ban = result.ban;
    const affectedRooms = new Set();
    for (const [sid, userId] of socketToUserId.entries()) {
      const s = io.sockets.sockets.get(sid);
      if (!s) continue;
      const sockIp = getClientIp?.(s.request) || '';
      const cookies = parseCookieHeader(s.handshake?.headers?.cookie || '');
      const deviceId = sanitizeDeviceId(cookies.openmusic_did);
      const roomId = socketToRoom.get(sid);
      const user = roomId ? getRoomInternal(roomId)?.users?.get(userId) : null;

      let match = false;
      if (ban.type === 'ip') {
        if ((sockIp && sockIp === ban.value) || (user?.clientIp && user.clientIp === ban.value)) {
          match = true;
        }
      } else if (ban.type === 'device') {
        if ((deviceId && deviceId === ban.value) || (user?.deviceId && user.deviceId === ban.value)) {
          match = true;
        }
      }
      if (!match) continue;

      if (roomId) {
        removeUser(roomId, userId, sid);
        affectedRooms.add(roomId);
        s.leave(roomId);
      }
      socketToRoom.delete(sid);
      socketToUserId.delete(sid);
      s.emit('kicked', { message: '你已被站点封禁' });
      kicked += 1;
    }
    for (const roomId of affectedRooms) {
      const prepared = prepareRoomBroadcast(roomId);
      if (!prepared) continue;
      for (const [sid, rid] of socketToRoom.entries()) {
        if (rid !== roomId) continue;
        const s = io.sockets.sockets.get(sid);
        s?.emit('room_update', roomUpdateForViewer(prepared, socketToUserId.get(sid)));
      }
    }

    audit('site_ban_add', {
      banType: ban.type,
      value: ban.value,
      kicked,
    }, adminIp);
    res.json({ success: true, ban, kicked });
  });

  app.delete('/api/admin/bans/:id', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = await removeSiteBan(req.params.id);
    if (!result.success) return res.status(404).json({ error: result.error });
    audit('site_ban_remove', { banId: req.params.id }, ip);
    res.json({ success: true });
  });

  app.get('/api/admin/error-reports', requireAdmin, async (_req, res) => {
    res.json({ reports: await listErrorReports() });
  });

  app.get('/api/admin/error-reports/:id', requireAdmin, async (req, res) => {
    const report = await getErrorReport(req.params.id);
    if (!report) return res.status(404).json({ error: '上报不存在' });
    res.json({ report });
  });

  app.put('/api/admin/error-reports/:id', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = await updateErrorReport(req.params.id, {
      status: req.body?.status,
      note: req.body?.note,
    });
    if (!result.success) return res.status(404).json({ error: result.error });
    audit('error_report_update', {
      reportId: result.report.id,
      status: result.report.status,
    }, ip);
    res.json({ success: true, report: result.report });
  });

  app.delete('/api/admin/error-reports/:id', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, async (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    const result = await deleteErrorReport(req.params.id);
    if (!result.success) return res.status(404).json({ error: result.error });
    audit('error_report_delete', { reportId: req.params.id }, ip);
    res.json({ success: true });
  });

  app.delete('/api/admin/rooms/:id', requireAdminOrigin, requireAdmin, requireAdminSetupComplete, (req, res) => {
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
