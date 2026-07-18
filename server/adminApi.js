import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { listRoomsForAdmin, adminDestroyRoom, isRedisEnabled } from './roomManager.js';
import { getMetingUpstreamStatus } from './metingUpstream.js';

const ADMIN_KEY = String(process.env.ADMIN_KEY || '').trim();
const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 小时
// 进程内随机密钥签发 token：重启后所有管理会话失效（房间状态本身也在内存，行为一致）
const tokenSecret = randomBytes(32);

export function isAdminEnabled() {
  return ADMIN_KEY.length >= 8;
}

function hmac(input) {
  return createHmac('sha256', tokenSecret).update(input).digest('base64url');
}

function safeEqual(a, b) {
  const ha = createHmac('sha256', tokenSecret).update(`eq:${a}`).digest();
  const hb = createHmac('sha256', tokenSecret).update(`eq:${b}`).digest();
  return timingSafeEqual(ha, hb);
}

function issueToken() {
  const exp = Date.now() + ADMIN_TOKEN_TTL_MS;
  return `${exp}.${hmac(`admin:${exp}`)}`;
}

function verifyToken(token) {
  const [expRaw, sig] = String(token || '').split('.');
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || !sig) return false;
  if (Date.now() > exp) return false;
  return safeEqual(sig, hmac(`admin:${exp}`));
}

// 登录尝试限流：每 IP 每分钟最多 10 次
const loginAttempts = new Map();
function isLoginRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    loginAttempts.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > 10;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts.entries()) {
    if (now - entry.windowStart > 120_000) loginAttempts.delete(ip);
  }
}, 300_000).unref();

export function mountAdminApi(app, { io, socketToRoom, socketToUserId, getClientIp }) {
  app.get('/api/admin/status', (_req, res) => {
    res.json({ enabled: isAdminEnabled() });
  });

  app.post('/api/admin/login', (req, res) => {
    if (!isAdminEnabled()) {
      return res.status(503).json({ error: '管理后台未启用（需配置 ADMIN_KEY，至少 8 位）' });
    }
    const ip = getClientIp?.(req) || req.ip || '';
    if (isLoginRateLimited(ip)) {
      return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });
    }
    const key = String(req.body?.key || '');
    if (!key || !safeEqual(key, ADMIN_KEY)) {
      return res.status(403).json({ error: '密钥错误' });
    }
    res.json({ token: issueToken(), expiresInMs: ADMIN_TOKEN_TTL_MS });
  });

  function requireAdmin(req, res, next) {
    if (!isAdminEnabled()) {
      return res.status(503).json({ error: '管理后台未启用' });
    }
    if (!verifyToken(req.headers['x-admin-token'])) {
      return res.status(401).json({ error: '未登录或登录已过期' });
    }
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
    });
  });

  app.get('/api/admin/rooms', requireAdmin, (_req, res) => {
    res.json({ rooms: listRoomsForAdmin() });
  });

  app.delete('/api/admin/rooms/:id', requireAdmin, (req, res) => {
    const roomId = String(req.params.id || '').toUpperCase();
    // 先把房内连接踢出，避免解散后客户端仍持有旧状态
    for (const [sid, rid] of socketToRoom.entries()) {
      if (rid !== roomId) continue;
      const s = io.sockets.sockets.get(sid);
      socketToRoom.delete(sid);
      socketToUserId.delete(sid);
      s?.leave(roomId);
      s?.emit('kicked', { message: '房间已被站点管理员解散' });
    }
    const result = adminDestroyRoom(roomId);
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    res.json({ success: true, name: result.name });
  });
}
