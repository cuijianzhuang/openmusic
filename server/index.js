import './loadEnv.js';
import { resizeCoverForThumb } from './coverUrl.js';
import {
  isBlockedMediaHostname,
  serveUpstreamMedia,
} from './mediaProxy.js';
import { formatMetingFetchError } from './metingFetch.js';
import {
  fetchMetingApi,
  isMetingApiHostname,
  getMetingUpstreamBases,
  getMetingUpstreamStatus,
  startMetingHealthProbe,
} from './metingUpstream.js';
import { fetchLrcapiLyrics, getLrcapiUpstreamStatus } from './lrcapiUpstream.js';
import { mountWechatFileHelperProxy } from './wechatFileHelperProxy.js';
import { mountAdminApi } from './adminApi.js';
import { initAdminCredentials } from './adminCredentials.js';
import { isSetupRequired, mountSetupApi } from './setupApi.js';
import { buildRobotsTxt, buildSitemapXml, resolveSiteOrigin } from './seoFiles.js';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { isIP } from 'net';
import {
  deriveApiSignKey,
  verifyApiSign,
  isPublicApiPath,
  isApiSignRequired,
} from './apiSign.js';
import {
  collectDeviceIdsForUser,
  getUserIdForDevice,
  isAccessBanned,
  linkDeviceToUser,
  sanitizeDeviceId,
} from './deviceIdentity.js';
import {
  createRoom,
  getRoomPublic,
  getRoom,
  listRooms,
  listRoomIds,
  verifyRoomPassword,
  roomExists,
  initRooms,
  isRedisEnabled,
  addUser,
  removeUser,
  renameUser,
  renameRoom,
  setRoomLock,
  setRoomAudioQuality,
  setRoomMemberTier,
  removeRoomMemberTier,
  setRoomMemberSettings,
  postMemberWelcomeMessage,
  setRoomFmMode,
  setRoomAnnouncement,
  setChatHistoryVisibleOnJoin,
  setSongRequestEnabled,
  banRoomSong,
  unbanRoomSong,
  setChatMute,
  addToQueue,
  removeFromQueue,
  clearQueue,
  skipSong,
  finishCurrentSong,
  ensurePlayback,
  retryStuckRandomLoading,
  markRandomLoading,
  setPlaying,
  seekTo,
  getRoomInternal,
  buildPlaybackState,
  requestJump,
  reorderQueue,
  toggleQueueLike,
  toggleCurrentDislike,
  approveJump,
  rejectJump,
  requestSkip,
  approveSkip,
  rejectSkip,
  addChatMessage,
  recallChatMessage,
  toggleChatReaction,
  getChatHistoryForUser,
  getSongHistory,
  INITIAL_CHAT_LIMIT,
  advancePlaybackIfEnded,
  getPlaybackTime,
  canUserMutate,
  kickUser,
  transferOwner,
  setRoomAdmin,
  reportTrackDuration,
  setOnRoomPrefetchReady,
  setOnRoomStructureChanged,
  serializeRoomForViewer,
  prepareRoomBroadcast,
  roomUpdateForViewer,
} from './roomManager.js';
import {
  isCyapiConfigured,
  searchKugouMusic,
  getKugouSongDetail,
  moderateCyapiImage,
} from './cyapi.js';
import { importNeteasePlaylist, importQqPlaylist, fetchNeteasePlaylistMetas } from './playlistImport.js';
import { fetchNeteaseHotToplist } from './neteaseToplist.js';
import { hasRedisEnvConfig, importFavoriteSongs, listFavoriteSongs, setFavoriteSong } from './roomStorage.js';
import {
  createChatImageUploadToken,
  isQiniuConfigured,
} from './qiniuOss.js';
import { isLocalStickerImageKey } from './localSticker.js';
import {
  isApihzStickerConfigured,
  searchApihzStickers,
} from './apihzSticker.js';
import { checkApihzSensitiveWords } from './apihzSensitiveWord.js';
import { getSiteAnnouncement, initSiteAnnouncement } from './siteAnnouncement.js';
import { initSiteBans, isSiteBanned } from './siteBan.js';
import { createErrorReport } from './errorReports.js';
import { deriveChatTextGateKey, verifyChatTextGatePass } from './chatTextGate.js';
import { getRuntimeConfig } from './runtimeConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, '../client/dist');
const PORT = process.env.PORT || 4000;
const DISCONNECT_GRACE_MS = 30_000;
const AUTO_ADVANCE_INTERVAL_MS = 500;
const CLIENT_URL = (process.env.CLIENT_URL || '').replace(/\/$/, '');
const ALLOWED_ORIGINS = CLIENT_URL
  ? new Set(CLIENT_URL.split(',').map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean))
  : null;
const CLIENT_ID_SECRET = process.env.CLIENT_ID_SECRET || randomBytes(32).toString('hex');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
/** 会话 HMAC 有效期（秒），默认 90 天 */
const SESSION_TTL_SEC = Math.max(
  60 * 60 * 24,
  parseInt(process.env.SESSION_TTL_SEC || String(60 * 60 * 24 * 90), 10) || (60 * 60 * 24 * 90),
);
/** 剩余有效期低于此值时 bootstrap 静默续签 */
const SESSION_RENEW_WITHIN_SEC = Math.min(
  60 * 60 * 24 * 7,
  Math.max(60 * 60, Math.floor(SESSION_TTL_SEC / 3)),
);

if (IS_PRODUCTION && !ALLOWED_ORIGINS) {
  console.warn('安全告警: NODE_ENV=production 但未配置 CLIENT_URL，浏览器跨域请求将被拒绝');
}
if (IS_PRODUCTION && !(process.env.CLIENT_ID_SECRET || '').trim()) {
  console.warn('安全告警: NODE_ENV=production 但未配置 CLIENT_ID_SECRET，重启后所有会话将失效');
}

const app = express();
app.set('trust proxy', TRUST_PROXY || IS_PRODUCTION ? 1 : 'loopback');
const httpServer = createServer(app);

function corsOrigin(origin, callback) {
  if (!origin) {
    callback(null, true);
    return;
  }

  // 首次部署尚无 CLIENT_URL；安装 API 自身仍执行严格同 Host 校验。
  if (isSetupRequired()) {
    callback(null, true);
    return;
  }

  if (!ALLOWED_ORIGINS) {
    callback(null, !IS_PRODUCTION);
    return;
  }

  callback(null, ALLOWED_ORIGINS.has(origin.replace(/\/$/, '')));
}

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
  },
  // 表情 data URL 需 >1MB；4MB 兼顾防大包 DoS 与本地贴纸
  maxHttpBufferSize: 4 * 1024 * 1024,
  // base64 表情几乎压不动，抬高阈值避免人多时 CPU 被 deflate 打满
  perMessageDeflate: {
    threshold: 262144,
  },
  httpCompression: true,
  // 人多时事件循环偶发阻塞，放宽 ping 超时减少误判断连
  pingInterval: 25_000,
  pingTimeout: 60_000,
});

app.use(cors({ origin: corsOrigin }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));

mountSetupApi(app);

/** 受保护 API：会话校验 + 请求签名校验 */
const API_ACCESS_DENIED = '请求无效，请刷新页面后重试';

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/api/setup/')) return next();
  // 管理后台使用独立的账号密码鉴权（见 adminApi.js / adminCredentials.js），不走会话身份与签名
  if (req.path.startsWith('/api/admin/')) return next();
  if (isPublicApiPath(req)) return next();

  const identity = resolveIdentityFromRequest(req);
  if (!identity?.userId) {
    return res.status(403).json({ error: API_ACCESS_DENIED });
  }

  req.apiIdentity = identity;

  // Web Crypto 仅在 HTTPS/可信上下文可用；HTTP 直连阶段只能依赖会话校验。
  // 上线 HTTPS 后 req.secure 为 true，自动恢复请求签名校验。
  if (isApiSignRequired() && req.secure) {
    const signKey = deriveApiSignKey(CLIENT_ID_SECRET, identity.userId, identity.iat);
    const result = verifyApiSign(req, signKey, identity.userId);
    if (!result.ok) {
      return res.status(403).json({ error: API_ACCESS_DENIED });
    }
  }

  next();
});

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeClientIp(raw) {
  let ip = String(raw || '').replace(/^::ffff:/, '').trim();
  if (!ip) return '';

  // 取逗号分隔链的首段（CDN 自定义头偶发带多值）
  if (ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }

  const v4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (v4WithPort) return v4WithPort[1];

  return ip;
}

function normalizeReportedClientIp(raw) {
  const ip = normalizeClientIp(String(raw || '').slice(0, 64));
  return isIP(ip) ? ip : '';
}

function getHeaderIp(headers, name) {
  const key = String(name || '').toLowerCase();
  if (!key) return '';
  const raw = headers[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return normalizeClientIp(value);
}

/**
 * CDN 回源真实客户端 IP 头（有 CDN 时必填）。
 * Cloudflare: CF-Connecting-IP；EdgeOne: iqp
 */
const CLIENT_IP_HEADER = String(process.env.CLIENT_IP_HEADER || '').trim().toLowerCase();

function getClientIpFromHeaders(headers = {}, remoteAddress = '') {
  // 未接反代时只用 socket 地址，避免客户端伪造 XFF 绕过限流
  const trustForwarded = TRUST_PROXY || IS_PRODUCTION;
  if (!trustForwarded) {
    return normalizeClientIp(remoteAddress || '');
  }

  // CDN 配置头优先于 Nginx 写入的边缘节点 X-Real-IP
  if (CLIENT_IP_HEADER) {
    const customIp = getHeaderIp(headers, CLIENT_IP_HEADER);
    if (customIp) return customIp;
  }

  // Nginx 覆盖写入的 X-Real-IP 优先于可被伪造的 XFF 首段
  const realIp = getHeaderIp(headers, 'x-real-ip');
  if (realIp) return realIp;

  const forwarded = headers['x-forwarded-for'];
  const rawForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (rawForwarded) {
    const parts = String(rawForwarded).split(',').map((part) => part.trim()).filter(Boolean);
    // 可信代理追加在末尾；取最后一段
    if (parts.length > 0) return normalizeClientIp(parts[parts.length - 1]);
  }

  return normalizeClientIp(remoteAddress || '');
}

function logIpDebug(scope, headers, remoteAddress, resolvedIp) {
  if (process.env.DEBUG_IP !== '1') return;
  console.log(`[ip-debug:${scope}]`, {
    clientIpHeader: CLIENT_IP_HEADER || '(unset)',
    customIp: CLIENT_IP_HEADER ? headers?.[CLIENT_IP_HEADER] : undefined,
    xff: headers?.['x-forwarded-for'],
    realIp: headers?.['x-real-ip'],
    remoteAddress,
    resolvedIp,
  });
}

function getRequestIp(req) {
  const ip = getClientIpFromHeaders(req.headers, req.socket?.remoteAddress || req.ip);
  logIpDebug('http', req.headers, req.socket?.remoteAddress || req.ip, ip);
  return ip;
}

function getClientIp(socket) {
  const headers = socket.request?.headers || socket.handshake.headers || {};
  const remoteAddress = socket.request?.socket?.remoteAddress || socket.handshake.address;
  const ip = getClientIpFromHeaders(headers, remoteAddress);
  logIpDebug('socket', headers, remoteAddress, ip);
  return ip;
}

function isPrivateIp(ip) {
  return (
    !ip
    || ip === '::1'
    || ip === '127.0.0.1'
    || ip === '0.0.0.0'
    || ip.startsWith('10.')
    || ip.startsWith('192.168.')
    || ip.startsWith('169.254.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
    || /^fc|^fd/i.test(ip)
    || /^fe80:/i.test(ip)
  );
}

function normalizeLocationName(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .replace(/^(中国|中华人民共和国)/, '')
    .replace(/(省|市|特别行政区|自治区|壮族自治区|回族自治区|维吾尔自治区)$/u, '')
    .slice(0, 12);
}

function fallbackLocationForIp(ip) {
  if (!ip || isPrivateIp(ip)) return '本地';
  return '未知';
}

const VALID_SOURCES = new Set(['netease', 'tencent', 'kugou']);

function limitText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function createRateLimiter({ windowMs, max }) {
  const buckets = new Map();
  return (key) => {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= max;
  };
}

const limitRoomCreate = createRateLimiter({ windowMs: 60_000, max: 20 });
const limitJoinAttempt = createRateLimiter({ windowMs: 60_000, max: 30 });
const limitJoinPasswordFail = createRateLimiter({ windowMs: 60_000, max: 8 });
const limitProxyRequest = createRateLimiter({ windowMs: 60_000, max: 120 });
const limitSocketAction = createRateLimiter({ windowMs: 60_000, max: 90 });
const limitSocketChat = createRateLimiter({ windowMs: 60_000, max: 30 });
const limitErrorReport = createRateLimiter({ windowMs: 10 * 60_000, max: 5 });

function sanitizeClientSong(song) {
  if (!song || typeof song !== 'object') {
    return { error: '歌曲数据无效' };
  }

  const source = VALID_SOURCES.has(song.source) ? song.source : 'netease';
  const id = limitText(song.id, 128);
  const name = limitText(song.name, 100);
  const artist = limitText(song.artist, 100) || '未知歌手';

  if (!id || !name) {
    return { error: '歌曲数据缺少 id 或名称' };
  }

  const sanitized = {
    id,
    source,
    name,
    artist,
    album: limitText(song.album, 100) || undefined,
    pic: limitText(song.pic, 1000) || undefined,
    // 不信任客户端上报的时长，避免伪造超短 duration 触发自动切歌
  };

  // 歌词/播放 URL 由客户端按需拉取，服务端不持久化。
  return { song: sanitized };
}

// buildMetingUrl / isMetingApiHostname 已迁移至 metingUpstream.js（多上游负载均衡）

function parseMetingMediaQuery(url) {
  try {
    const parsed = new URL(url);
    const type = parsed.searchParams.get('type');
    if (type !== 'pic' && type !== 'url') return null;
    const server = parsed.searchParams.get('server');
    const id = parsed.searchParams.get('id');
    if (!server || !id) return null;
    const quality = parsed.searchParams.get('quality') || undefined;
    return { server, id, type, quality };
  } catch {
    return null;
  }
}

function parseMetingPicQuery(url) {
  const query = parseMetingMediaQuery(url);
  return query?.type === 'pic' ? query : null;
}

function normalizeMetingResolvedUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  return text.startsWith('@') ? text.slice(1).trim() : text;
}

function isUnresolvedMetingMediaUrl(url) {
  const query = parseMetingMediaQuery(url);
  if (!query) return false;
  try {
    const parsed = new URL(url);
    return isMetingApiHostname(parsed.hostname) || isPrivateHostname(parsed.hostname);
  } catch {
    return false;
  }
}

async function resolveMetingMediaUrl(query, depth = 0) {
  if (depth > 5) throw new Error('Meting 媒体地址解析过深');

  const params = { server: query.server, type: query.type, id: query.id };
  if (query.quality) params.quality = query.quality;

  const response = await fetchMetingApi(params, { redirect: 'manual' }, 15000);

  if (response.status >= 300 && response.status < 400) {
    const location = normalizeMetingResolvedUrl(response.headers.get('location'));
    if (!location) throw new Error('Meting 返回空重定向');
    const nested = parseMetingMediaQuery(location);
    if (nested && isUnresolvedMetingMediaUrl(location)) {
      return resolveMetingMediaUrl(nested, depth + 1);
    }
    return location;
  }

  const text = normalizeMetingResolvedUrl(await response.text());
  if (!text.startsWith('http')) throw new Error('Meting 未返回有效媒体地址');

  const nested = parseMetingMediaQuery(text);
  if (nested && isUnresolvedMetingMediaUrl(text)) {
    return resolveMetingMediaUrl(nested, depth + 1);
  }

  return text;
}

/** media-proxy 误收到 Meting API 地址时，先解析为真实 CDN 地址 */
async function resolveMediaProxyFetchUrl(fetchUrl, thumbPx = 0) {
  const query = parseMetingMediaQuery(fetchUrl);
  if (!query) return fetchUrl;

  try {
    const resolved = await resolveMetingMediaUrl(query);
    if (query.type === 'pic' && thumbPx > 0) {
      return resizeCoverForThumb(resolved, thumbPx);
    }
    return resolved;
  } catch (err) {
    console.error(`Meting ${query.type} resolve error:`, err.message);
    return fetchUrl;
  }
}

async function finalizeMetingTextResponse(body, metingType) {
  const normalized = normalizeMetingResolvedUrl(body);
  if (metingType !== 'url' || !normalized.startsWith('http')) return normalized;
  if (!isUnresolvedMetingMediaUrl(normalized)) return normalized;

  const nested = parseMetingMediaQuery(normalized);
  if (!nested || nested.type !== 'url') return normalized;
  return resolveMetingMediaUrl(nested);
}

async function proxyMetingResponse(metingQuery, res, thumbPx = 0, metingType = '') {
  const response = await fetchMetingApi(metingQuery, { redirect: 'manual' });

  if (response.status >= 300 && response.status < 400) {
    let location = response.headers.get('location');
    if (location && thumbPx > 0) {
      location = resizeCoverForThumb(location, thumbPx);
    }
    if (location) {
      // type=url/lrc 必须返回文本 URL，不能把浏览器重定向到第三方 CDN（fetch 会触发 CORS）
      if (metingType === 'url' || metingType === 'lrc') {
        const body = await finalizeMetingTextResponse(location, metingType);
        return res.type('text').send(body);
      }
      return res.redirect(response.status, location);
    }
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (metingType === 'url' || metingType === 'lrc') {
    const body = await finalizeMetingTextResponse(text, metingType);
    return res.type('text').send(body);
  }

  if (contentType.includes('application/json') || text.startsWith('[') || text.startsWith('{')) {
    try {
      return res.json(JSON.parse(text));
    } catch {
      return res.type('text').send(text);
    }
  }

  return res.type('text').send(text);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

/** 首页站点公告：管理后台设置（Redis 持久化）；no-store 防 CDN/浏览器缓存旧公告 */
app.get('/api/site-announcement', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.json(getSiteAnnouncement());
});

/** 前端更新检测：走 /api 绕过 EdgeOne 静态缓存；no-store 防中间层缓存 */
app.get('/api/app-version', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  const versionPath = path.join(clientDist, 'version.json');
  try {
    if (fs.existsSync(versionPath)) {
      const raw = fs.readFileSync(versionPath, 'utf8');
      const data = JSON.parse(raw);
      return res.json({
        buildId: String(data.buildId || data.version || ''),
        version: String(data.version || data.buildId || ''),
        notes: Array.isArray(data.notes) ? data.notes : [],
        builtAt: data.builtAt || null,
        forcePrompt: data.forcePrompt === true,
      });
    }
  } catch (err) {
    console.error('app-version read error:', err?.message || err);
  }
  return res.json({ buildId: 'dev', version: 'dev', notes: [], builtAt: null, forcePrompt: false });
});

app.get('/api/music/toplist/netease', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  if (!limitProxyRequest(proxyLimitKey('toplist', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
  const limit = parseInt(String(req.query.limit || ''), 10);
  try {
    const data = await fetchNeteaseHotToplist(Number.isFinite(limit) ? limit : 200);
    res.json(data);
  } catch (err) {
    console.error('Netease toplist error:', err.message);
    res.status(502).json({ error: err.message || '获取热榜失败' });
  }
});

app.get('/api/music/netease/playlists/meta', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  if (!limitProxyRequest(proxyLimitKey('playlist-meta', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const ids = String(req.query.ids || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (ids.length === 0) {
    return res.json({ playlists: [] });
  }

  try {
    const playlists = await fetchNeteasePlaylistMetas(ids);
    res.json({ playlists });
  } catch (err) {
    console.error('Netease playlist meta error:', err.message);
    res.status(502).json({ error: '获取歌单信息失败' });
  }
});

app.get('/api/music/netease/playlists/search', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  if (!limitProxyRequest(proxyLimitKey('playlist-search', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const keyword = limitText(req.query.keyword || req.query.s, 80);
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
  if (!keyword) return res.json({ playlists: [], total: 0, page, limit });

  try {
    const response = await fetchMetingApi({ server: 'netease', type: 'search_playlist', id: keyword }, {}, 10000);
    if (!response.ok) return res.status(response.status).json({ error: '红点歌单搜索失败' });
    const data = await response.json();
    const playlists = Array.isArray(data) ? data : [];
    const normalized = playlists.map((item) => ({
      id: String(item.id || ''),
      name: String(item.name || item.title || '未命名歌单'),
      coverImgUrl: String(item.cover || item.coverImgUrl || item.pic || ''),
      creatorName: String(item.creator?.nickname || item.creator?.name || item.user?.nickname || ''),
      trackCount: Number(item.trackCount || item.track_count || item.song_count || 0),
      playCount: Number(item.playCount || item.playcount || 0),
    })).filter((item) => item.id);
    const start = (page - 1) * limit;
    res.json({
      page,
      limit,
      total: normalized.length,
      playlists: normalized.slice(start, start + limit),
    });
  } catch (err) {
    console.error('Netease playlist search error:', err.message);
    res.status(502).json({ error: '红点歌单搜索失败' });
  }
});

app.get('/api/music/sources', (_req, res) => {
  const sources = [
    {
      id: 'netease',
      name: '红点',
      shortName: '红点',
      color: '#ec4141',
      supportsSearch: true,
      supportsIdLookup: true,
    },
    {
      id: 'tencent',
      name: '绿点',
      shortName: '绿点',
      color: '#31c27c',
      supportsSearch: true,
      supportsIdLookup: false,
    },
    {
      id: 'kugou',
      name: '蓝点',
      shortName: '蓝点',
      color: '#2688ee',
      supportsSearch: isCyapiConfigured(),
      supportsIdLookup: false,
      description: isCyapiConfigured() ? '通过迟言 API 搜索' : '请配置 CYAPI_KEY（蓝点）',
    },
  ];
  res.json(sources);
});

app.get('/api/meting', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;

  try {
    const thumbPx = parseInt(String(req.query.size || ''), 10) || 0;
    const query = { ...req.query };
    delete query.size;
    await proxyMetingResponse(query, res, thumbPx, String(query.type || ''));
  } catch (err) {
    console.error('Meting proxy error:', formatMetingFetchError(err));
    res.status(502).json({ error: '无法连接 Meting API，请检查 METING_API_URL 配置' });
  }
});

/** HTTPS 站点下代理 http 音频/封面，避免浏览器混合内容警告 */
app.get('/api/media-proxy', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  if (!limitProxyRequest(proxyLimitKey('media', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const raw = String(req.query.url || '').trim();
  const thumbPx = Math.min(512, Math.max(0, parseInt(String(req.query.size || ''), 10) || 0));
  let fetchUrl = raw;
  let parsed;
  try {
    parsed = new URL(fetchUrl);
  } catch {
    return res.status(400).json({ error: '无效地址' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: '不支持的协议' });
  }

  if (isBlockedMediaHostname(parsed.hostname) && !isMetingApiHostname(parsed.hostname)) {
    return res.status(403).json({ error: '禁止访问内网地址' });
  }
  // 不再限制媒体域名白名单，仅拦截内网地址

  try {
    if (parseMetingMediaQuery(raw)) {
      fetchUrl = await resolveMediaProxyFetchUrl(raw, thumbPx);
    } else if (thumbPx > 0) {
      fetchUrl = resizeCoverForThumb(raw, thumbPx);
    } else {
      fetchUrl = raw;
    }

    // 解析后的最终 URL 必须落在音乐 CDN 白名单（不再允许任意公网 / 内网 Meting）
    let finalHost = '';
    try {
      finalHost = new URL(fetchUrl).hostname;
    } catch {
      return res.status(400).json({ error: '无效地址' });
    }
    if (isBlockedMediaHostname(finalHost)) {
      return res.status(403).json({ error: '禁止访问内网地址' });
    }

    await serveUpstreamMedia(fetchUrl, res, fetchWithTimeout, {
      range: req.headers.range,
      thumbPx,
      requireAllowlist: true,
    });
  } catch (err) {
    console.error('Media proxy error:', err.message);
    if (!res.headersSent) res.status(502).json({ error: '媒体代理失败' });
  }
});

/** cyapi 蓝点音乐搜索 */
app.get('/api/music/cyapi/kugou/search', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  if (!limitProxyRequest(proxyLimitKey('kugou', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  if (!isCyapiConfigured()) {
    return res.status(503).json({ error: '未配置 CYAPI_KEY' });
  }

  const keyword = String(req.query.q || '').trim();
  const num = Math.min(Math.max(parseInt(String(req.query.num || '15'), 10) || 15, 1), 30);

  if (!keyword) return res.json([]);

  try {
    res.json(await searchKugouMusic(keyword, num));
  } catch (err) {
    console.error('Cyapi Kugou search error:', err.message);
    res.status(502).json({ error: '蓝点音乐搜索失败' });
  }
});

/** 导入外部歌单（分享链接） */
app.post('/api/music/playlist/import', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  if (!limitProxyRequest(proxyLimitKey('playlist', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const platform = String(req.body?.platform || '').trim();
  const input = String(req.body?.input || '').trim();
  if (!input) return res.status(400).json({ error: '请粘贴歌单分享链接' });
  if (platform !== 'netease' && platform !== 'qq') {
    return res.status(400).json({ error: '不支持的平台' });
  }

  try {
    const result = platform === 'netease'
      ? await importNeteasePlaylist(input)
      : await importQqPlaylist(input);
    res.json(result);
  } catch (err) {
    console.error('Playlist import error:', err.message);
    res.status(400).json({ error: err.message || '歌单导入失败' });
  }
});

/** cyapi 蓝点音乐详情（播放链接、歌词） */
app.get('/api/music/cyapi/kugou/song', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  if (!limitProxyRequest(proxyLimitKey('kugou-song', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  if (!isCyapiConfigured()) {
    return res.status(503).json({ error: '未配置 CYAPI_KEY' });
  }

  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: '缺少歌曲 id' });

  try {
    const detail = await getKugouSongDetail(id);
    if (!detail) return res.status(404).json({ error: '歌曲不存在' });
    res.json(detail);
  } catch (err) {
    console.error('Cyapi Kugou song error:', err.message);
    res.status(502).json({ error: '蓝点音乐获取失败' });
  }
});

/** 歌词备用：52vmy，按歌名搜索 */
app.get('/api/music/lrc-fallback', async (req, res) => {
  if (!requireSessionIdentity(req, res)) return;
  if (!limitProxyRequest(proxyLimitKey('lrc', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const msg = limitText(req.query.msg, 120);
  const artist = limitText(req.query.artist, 120);
  const album = limitText(req.query.album, 120);
  const n = String(req.query.n || '1');
  if (!msg) return res.status(400).json({ error: '缺少歌曲名' });

  // 兜底链：LrcAPI（带歌手/专辑，匹配更准，支持多上游负载均衡）→ 52vmy（仅按歌名）
  const lrcapiText = await fetchLrcapiLyrics({ title: msg, artist, album });
  if (lrcapiText) {
    return res.type('text/plain; charset=utf-8').send(lrcapiText);
  }

  try {
    const params = new URLSearchParams({ msg, n });
    const response = await fetchWithTimeout(`${getRuntimeConfig().vmyLrcUrl}?${params}`);
    if (!response.ok) {
      return res.status(502).json({ error: '歌词接口请求失败' });
    }
    const text = await response.text();
    res.type('text/plain; charset=utf-8').send(text);
  } catch (err) {
    console.error('LRC fallback error:', err.message);
    res.status(502).json({ error: '歌词获取失败' });
  }
});

const IDENTITY_UID_COOKIE = 'openmusic_uid';
const IDENTITY_TOKEN_COOKIE = 'openmusic_token';
const DEVICE_ID_COOKIE = 'openmusic_did';
const IDENTITY_COOKIE_MAX_AGE_SEC = SESSION_TTL_SEC;

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

function sanitizeClientId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{8,64}$/.test(id) ? id : '';
}

/** 签名格式：`iat.hmac(userId.iat)`，带过期时间 */
function signClientId(clientId, iat = Math.floor(Date.now() / 1000)) {
  const issuedAt = Math.floor(Number(iat) || Date.now() / 1000);
  const payload = `${clientId}.${issuedAt}`;
  const sig = createHmac('sha256', CLIENT_ID_SECRET).update(payload).digest('base64url');
  return `${issuedAt}.${sig}`;
}

/**
 * @returns {{ userId: string, iat: number, expiresAt: number } | null}
 */
function verifyClientToken(clientId, token) {
  const id = sanitizeClientId(clientId);
  const rawToken = String(token || '').trim();
  if (!id || !rawToken) return null;

  const dot = rawToken.indexOf('.');
  if (dot <= 0) return null;

  const iat = Number(rawToken.slice(0, dot));
  const sig = rawToken.slice(dot + 1);
  if (!Number.isFinite(iat) || iat <= 0 || !sig) return null;

  try {
    const expected = Buffer.from(
      createHmac('sha256', CLIENT_ID_SECRET).update(`${id}.${iat}`).digest('base64url'),
    );
    const actual = Buffer.from(sig);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (iat > now + 60) return null;
  if (now - iat > SESSION_TTL_SEC) return null;

  return { userId: id, iat, expiresAt: iat + SESSION_TTL_SEC };
}

function createServerClientId() {
  return randomBytes(18).toString('base64url');
}

function setIdentityCookieHeaders(res, userId, token, deviceId = null) {
  // Secure Cookie 只能通过 HTTPS 保存。生产环境也允许先通过直连 HTTP
  // 完成首次部署；反代正确传递 X-Forwarded-Proto 后 req.secure 会为 true。
  const secure = res.req?.secure ? '; Secure' : '';
  const base = `Path=/; Max-Age=${IDENTITY_COOKIE_MAX_AGE_SEC}; HttpOnly; SameSite=Lax${secure}`;
  const cookies = [
    `${IDENTITY_UID_COOKIE}=${encodeURIComponent(userId)}; ${base}`,
    `${IDENTITY_TOKEN_COOKIE}=${encodeURIComponent(token)}; ${base}`,
  ];
  const did = sanitizeDeviceId(deviceId);
  if (did) {
    cookies.push(`${DEVICE_ID_COOKIE}=${encodeURIComponent(did)}; ${base}`);
  }
  res.setHeader('Set-Cookie', cookies);
}

/** 仅读取 HttpOnly 设备 Cookie（不可用 body/localStorage 冒充恢复） */
function resolveDeviceIdFromCookieHeader(cookieHeader) {
  const cookies = parseCookieHeader(cookieHeader || '');
  return sanitizeDeviceId(cookies[DEVICE_ID_COOKIE]);
}

function resolveBodyDeviceId(req) {
  return sanitizeDeviceId(req.body?.deviceId);
}

function resolveIdentityFromCookies(cookieHeader) {
  const cookies = parseCookieHeader(cookieHeader);
  const userId = sanitizeClientId(cookies[IDENTITY_UID_COOKIE]);
  const token = String(cookies[IDENTITY_TOKEN_COOKIE] || '').trim();
  return verifyClientToken(userId, token);
}

function resolveIdentityFromRequest(req) {
  return resolveIdentityFromCookies(req.headers?.cookie || '');
}

function requireSessionIdentity(req, res) {
  const identity = req.apiIdentity || resolveIdentityFromRequest(req);
  if (!identity?.userId) {
    res.status(401).json({ error: '会话未就绪，请刷新页面后重试' });
    return null;
  }
  return identity;
}

function sendBootstrapResponse(res, userId, iat, token, deviceId = null) {
  setIdentityCookieHeaders(res, userId, token, deviceId);
  const payload = {
    clientId: userId,
    // 聊天文本门禁密令密钥：始终下发，供前端敏感词检测通过后签发密令
    chatTextGateKey: deriveChatTextGateKey(CLIENT_ID_SECRET, userId, iat),
  };
  if (isApiSignRequired() && res.req?.secure) {
    payload.apiSignKey = deriveApiSignKey(CLIENT_ID_SECRET, userId, iat);
  }
  return res.json(payload);
}

function proxyLimitKey(kind, req) {
  const identity = resolveIdentityFromRequest(req);
  return `${kind}:${getRequestIp(req)}:${identity?.userId || 'anon'}`;
}

/** 建立 HttpOnly 会话：身份凭证仅通过 Cookie 传递，不经 WebSocket 明文下发 */
app.post('/api/session/bootstrap', async (req, res) => {
  const cookieDeviceId = resolveDeviceIdFromCookieHeader(req.headers?.cookie || '');
  const bodyDeviceId = resolveBodyDeviceId(req);
  const now = Math.floor(Date.now() / 1000);

  const existing = resolveIdentityFromRequest(req);
  if (existing) {
    // 已认证：可用 body deviceId 对齐绑定；恢复路径不依赖 body
    const deviceId = cookieDeviceId || bodyDeviceId || createServerClientId();
    await linkDeviceToUser(deviceId, existing.userId);
    const shouldRenew = existing.expiresAt - now <= SESSION_RENEW_WITHIN_SEC;
    const signIat = shouldRenew ? now : existing.iat;
    const token = signClientId(existing.userId, signIat);
    return sendBootstrapResponse(res, existing.userId, signIat, token, deviceId);
  }

  // 无身份 Cookie：仅允许 HttpOnly openmusic_did 恢复同一 userId
  if (cookieDeviceId) {
    const boundUserId = await getUserIdForDevice(cookieDeviceId);
    if (boundUserId) {
      await linkDeviceToUser(cookieDeviceId, boundUserId);
      const signIat = now;
      return sendBootstrapResponse(
        res,
        boundUserId,
        signIat,
        signClientId(boundUserId, signIat),
        cookieDeviceId,
      );
    }
  }

  const userId = createServerClientId();
  const deviceId = cookieDeviceId || createServerClientId();
  await linkDeviceToUser(deviceId, userId);
  const signIat = now;
  return sendBootstrapResponse(res, userId, signIat, signClientId(userId, signIat), deviceId);
});

app.post('/api/error-reports', async (req, res) => {
  const identity = resolveIdentityFromRequest(req);
  if (!identity?.userId) {
    return res.status(401).json({ error: '会话未就绪，请刷新页面后重试' });
  }
  const ip = getRequestIp(req);
  if (!limitErrorReport(`error-report:${ip}:${identity.userId}`)) {
    return res.status(429).json({ error: '上报过于频繁，请稍后再试' });
  }

  const result = await createErrorReport({
    description: req.body?.description,
    snapshot: req.body?.snapshot,
    events: req.body?.events,
    meta: req.body?.meta,
    ip,
    userId: identity.userId,
  });
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ success: true, report: result.report });
});

app.get('/api/rooms', (_req, res) => {
  res.json(listRooms());
});

app.post('/api/rooms', (req, res) => {
  if (!limitRoomCreate(`room:${getRequestIp(req)}`)) {
    return res.status(429).json({ error: '创建房间过于频繁，请稍后再试' });
  }

  const name = req.body?.name;
  const password = req.body?.password;
  const identity = resolveIdentityFromRequest(req);
  if (!identity?.userId) {
    return res.status(401).json({ error: '会话未就绪，请刷新页面后重试' });
  }
  const createIp = getRequestIp(req);
  const createDeviceId = resolveDeviceIdFromCookieHeader(req.headers?.cookie || '');
  if (isSiteBanned({ ip: createIp, deviceId: createDeviceId })) {
    return res.status(403).json({ error: '你已被站点封禁，无法创建房间' });
  }
  const room = createRoom({ name, password, creatorId: identity.userId });
  res.json(room);
});

app.get('/api/rooms/:id', (req, res) => {
  const room = getRoomPublic(req.params.id);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  res.json(room);
});

app.get('/api/chat/upload-config', (_req, res) => {
  res.json({ enabled: isQiniuConfigured() });
});

app.get('/api/chat/sticker-search-config', (_req, res) => {
  res.json({ enabled: isApihzStickerConfigured() });
});

app.get('/api/chat/sticker-search', async (req, res) => {
  if (!isApihzStickerConfigured()) {
    return res.status(503).json({ error: '未配置表情包搜索' });
  }

  if (!requireSessionIdentity(req, res)) return;
  if (!limitProxyRequest(proxyLimitKey('sticker-search', req))) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const words = limitText(req.query.words, 32);
  const page = Math.max(1, Math.min(200, Number(req.query.page) || 1));
  const limit = Math.max(1, Math.min(20, Number(req.query.limit) || 15));
  if (!words) {
    return res.status(400).json({ error: '请输入搜索关键词' });
  }

  try {
    const result = await searchApihzStickers(words, page, limit);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || '搜索失败' });
  }
});

app.post('/api/chat/upload-token', (req, res) => {
  if (!isQiniuConfigured()) {
    return res.status(503).json({ error: '图片上传未配置' });
  }

  if (!limitProxyRequest(`chat-upload:${getRequestIp(req)}`)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const roomId = limitText(req.body?.roomId, 32);
  const ext = limitText(req.body?.ext, 8).toLowerCase();
  if (!roomId) {
    return res.status(400).json({ error: '房间无效' });
  }

  const identity = resolveIdentityFromRequest(req);
  if (!identity?.userId) {
    return res.status(401).json({ error: '未登录' });
  }

  const room = getRoomInternal(roomId);
  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }

  if (!room.users.has(identity.userId)) {
    return res.status(403).json({ error: '未加入房间' });
  }

  if (room.muteAll || room.mutedUserIds?.has(identity.userId)) {
    return res.status(403).json({ error: room.muteAll ? '当前房间已全体禁言' : '你已被禁言' });
  }

  try {
    const tokenData = createChatImageUploadToken(roomId, ext);
    res.json(tokenData);
  } catch (err) {
    res.status(400).json({ error: err.message || '生成上传凭证失败' });
  }
});

function resolveAndroidApkPath() {
  const candidates = [
    path.join(__dirname, 'downloads/openmusic.apk'),
    path.join(clientDist, 'downloads/openmusic.apk'),
    path.join(clientDist, 'downloads/apk'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveIosIpaPath() {
  const candidates = [
    path.join(__dirname, 'downloads/openmusic.ipa'),
    path.join(clientDist, 'downloads/openmusic.ipa'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function sendAndroidApk(req, res) {
  const apkPath = resolveAndroidApkPath();
  if (!apkPath) {
    return res.status(404).type('text/plain; charset=utf-8').send(
      'APK 尚未部署。请将 GitHub Actions 构建的 app-debug.apk 上传到 server/downloads/openmusic.apk',
    );
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.download(apkPath, 'openmusic.apk');
}

function sendIosIpa(req, res) {
  const ipaPath = resolveIosIpaPath();
  if (!ipaPath) {
    return res.status(404).type('text/plain; charset=utf-8').send(
      'IPA 尚未部署。请将 GitHub Actions 构建的 openmusic.ipa 上传到 server/downloads/openmusic.ipa，并用 Sideloadly 安装。',
    );
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.download(ipaPath, 'openmusic.ipa');
}

app.get('/downloads/openmusic.apk', sendAndroidApk);
app.get('/downloads/openmusic.ipa', sendIosIpa);

mountWechatFileHelperProxy(app, fetchWithTimeout, {
  requireAuth: (req, res) => Boolean(requireSessionIdentity(req, res)),
  secureCookies: IS_PRODUCTION,
});

app.get('/robots.txt', (req, res) => {
  const origin = resolveSiteOrigin(req, ALLOWED_ORIGINS);
  res.type('text/plain').send(buildRobotsTxt(origin));
});

app.get('/sitemap.xml', (req, res) => {
  const origin = resolveSiteOrigin(req, ALLOWED_ORIGINS);
  res.type('application/xml').send(buildSitemapXml(origin));
});

app.use(express.static(clientDist, {
  setHeaders(res, filePath) {
    const rel = path.relative(clientDist, filePath).replace(/\\/g, '/');
    if (rel === 'index.html') {
      // 入口页不长期缓存，确保发版后能拉到新资源
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return;
    }
    if (rel.startsWith('assets/')) {
      // 固定文件名：允许短缓存；发版后清 EO /assets 即可
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return;
    }
    if (rel.startsWith('qface/') || rel.startsWith('vendor/')) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  },
}));
app.get('*', (req, res, next) => {
  if (
    req.path.startsWith('/api')
    || req.path.startsWith('/socket.io')
    || req.path.startsWith('/downloads/')
    || req.path.startsWith('/wx-proxy')
    || req.path.startsWith('/cgi-bin')
  ) {
    return next();
  }
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

const socketToRoom = new Map();
const socketToUserId = new Map();

mountAdminApi(app, {
  io,
  socketToRoom,
  socketToUserId,
  getClientIp: (req) => getClientIpFromHeaders(req.headers, req.socket?.remoteAddress || ''),
  allowedOrigins: ALLOWED_ORIGINS,
});

function isPrivateHostname(hostname) {
  return isBlockedMediaHostname(hostname);
}

function getSocketUserId(socket) {
  return socketToUserId.get(socket.id) || null;
}

function rejectReadOnly(socket, callback) {
  const roomId = socketToRoom.get(socket.id);
  if (!roomId) {
    callback?.({ success: false, error: '未加入房间' });
    return true;
  }

  const userId = getSocketUserId(socket);
  if (!userId) {
    callback?.({ success: false, error: '会话无效，请刷新后重试' });
    return true;
  }

  if (!canUserMutate(roomId, userId)) {
    callback?.({ success: false, error: '只读端无法执行此操作' });
    return true;
  }

  return false;
}

function rejectRateLimited(socket, limiter, kind, callback) {
  if (!limiter(`${kind}:${socket.id}`)) {
    callback?.({ success: false, error: '操作过于频繁，请稍后再试' });
    return true;
  }
  return false;
}

function getViewerRoomPayload(socket, roomId) {
  return serializeRoomForViewer(roomId, getSocketUserId(socket));
}

function emitSystemChat(roomId, message) {
  if (!roomId || !message) return;
  io.to(roomId).emit('chat_message', message);
}

/** 合并同房短时间内的多次 room_update，减轻人多时 O(N) 风暴 */
const ROOM_BROADCAST_DEBOUNCE_MS = 80;
const ROOM_BROADCAST_MAX_WAIT_MS = 220;
const pendingRoomBroadcasts = new Map();

function clearPendingRoomBroadcast(normalized) {
  const pending = pendingRoomBroadcasts.get(normalized);
  if (!pending) return;
  if (pending.timer) clearTimeout(pending.timer);
  if (pending.maxTimer) clearTimeout(pending.maxTimer);
  pendingRoomBroadcasts.delete(normalized);
}

function flushRoomBroadcast(normalized) {
  const pending = pendingRoomBroadcasts.get(normalized);
  const excludeSocketIds = pending?.excludeSocketIds?.size
    ? [...pending.excludeSocketIds]
    : undefined;
  clearPendingRoomBroadcast(normalized);
  doBroadcastRoomUpdate(normalized, { excludeSocketIds });
}

/**
 * @param {string} roomId
 * @param {{ immediate?: boolean }} [options]
 */
function broadcastRoomUpdate(roomId, options = {}) {
  const normalized = roomId?.toUpperCase();
  if (!normalized) return;

  if (options.immediate) {
    clearPendingRoomBroadcast(normalized);
    doBroadcastRoomUpdate(normalized, options);
    return;
  }

  let pending = pendingRoomBroadcasts.get(normalized);
  if (!pending) {
    pending = { timer: null, maxTimer: null, excludeSocketIds: new Set() };
    pendingRoomBroadcasts.set(normalized, pending);
    pending.maxTimer = setTimeout(() => flushRoomBroadcast(normalized), ROOM_BROADCAST_MAX_WAIT_MS);
  }

  if (options.excludeSocketIds?.length) {
    for (const sid of options.excludeSocketIds) pending.excludeSocketIds.add(sid);
  }

  if (pending.timer) clearTimeout(pending.timer);
  pending.timer = setTimeout(() => flushRoomBroadcast(normalized), ROOM_BROADCAST_DEBOUNCE_MS);
}

function doBroadcastRoomUpdate(roomId, options = {}) {
  const normalized = roomId?.toUpperCase();
  if (!normalized) return;
  const sockets = io.sockets.adapter.rooms.get(normalized);
  if (!sockets?.size) return;

  const prepared = prepareRoomBroadcast(normalized);
  if (!prepared) return;

  const excludeSids = options.excludeSocketIds?.length
    ? new Set(options.excludeSocketIds)
    : null;

  const muteAll = Boolean(prepared.room.muteAll);
  const basePayload = {
    ...prepared.shared,
    chatMuted: muteAll,
  };

  const personalized = [];
  for (const sid of sockets) {
    if (excludeSids?.has(sid)) continue;
    const viewerId = socketToUserId.get(sid);
    const payload = roomUpdateForViewer(prepared, viewerId);
    if (!payload) continue;

    const needsPersonal = payload.chatMuted !== muteAll
      || payload.mutedUserIds != null
      || payload.userNicknames != null
      || payload.bannedSongs != null;

    if (needsPersonal) {
      personalized.push({ sid, payload });
    }
  }

  // 绝大多数成员载荷一致：整房一次 emit，仅房主/管理员/被禁言者补一次私信
  if (personalized.length === 0) {
    let target = io.to(normalized);
    if (excludeSids) {
      for (const sid of excludeSids) target = target.except(sid);
    }
    target.emit('room_update', basePayload);
    return;
  }

  if (personalized.length >= sockets.size - (excludeSids?.size || 0)) {
    for (const entry of personalized) {
      io.to(entry.sid).emit('room_update', entry.payload);
    }
    return;
  }

  const personalSids = new Set(personalized.map((entry) => entry.sid));
  let target = io.to(normalized);
  for (const sid of personalSids) {
    target = target.except(sid);
  }
  if (excludeSids) {
    for (const sid of excludeSids) target = target.except(sid);
  }
  target.emit('room_update', basePayload);

  for (const entry of personalized) {
    io.to(entry.sid).emit('room_update', entry.payload);
  }
}

function broadcastPlaybackState(roomId) {
  const internal = getRoomInternal(roomId);
  if (!internal) return;
  const state = buildPlaybackState(internal);
  if (state) io.to(roomId).emit('playback_state', state);
}

setOnRoomPrefetchReady((roomId) => {
  broadcastRoomUpdate(roomId);
});

setOnRoomStructureChanged((roomId) => {
  broadcastRoomUpdate(roomId, { immediate: true });
  broadcastPlaybackState(roomId);
});

function emitRoomAndPlayback(roomId, room) {
  // 切歌/队列结构变化：立即下发完整 room + playback
  broadcastRoomUpdate(roomId, { immediate: true });
  broadcastPlaybackState(roomId);

  if (room?.randomLoading && !room.current) {
    ensurePlayback(roomId).then((nextRoom) => {
      if (!nextRoom) return;
      if (nextRoom.current) {
        emitRoomAndPlayback(roomId, nextRoom);
        return;
      }
      broadcastRoomUpdate(roomId, { immediate: true });
      broadcastPlaybackState(roomId);
    }).catch((err) => {
      console.error('Ensure playback after loading state failed:', err.message);
    });
  }
}

/** 仅播放时钟变化（暂停/播放/seek）：只推 playback_state，避免全量 users+queue 风暴 */
function emitPlaybackOnly(roomId) {
  broadcastPlaybackState(roomId);
}

async function advanceEndedRoomNow(roomId, expectedQueueId = '') {
  const internal = getRoomInternal(roomId);
  if (!internal?.current || !internal.isPlaying) return null;
  if (expectedQueueId && internal.current.queueId !== expectedQueueId) return null;

  const beforeQueueId = internal.current.queueId;
  const beforePosition = getPlaybackTime(internal);
  // 禁止客户端 force：否则任意成员可凭 queueId 跳过「是否播完」检查强制切歌
  const advanced = await advancePlaybackIfEnded(roomId, {
    force: false,
    expectedQueueId,
  });
  if (!advanced) return null;
  if (advanced.current?.queueId === beforeQueueId) return null;

  emitRoomAndPlayback(roomId, advanced);
  console.log('playback auto advanced', {
    roomId,
    from: beforeQueueId,
    at: beforePosition.toFixed(2),
    to: advanced.current?.queueId || 'loading',
  });
  return advanced;
}

io.on('connection', (socket) => {
  socket.on('join_room', ({
    roomId,
    nickname,
    password,
    readOnly,
    clientIp: reportedClientIp,
    clientLocation,
  } = {}, callback) => {
    const id = roomId?.toUpperCase();
    if (!roomExists(id)) {
      callback?.({ success: false, error: '房间不存在' });
      return;
    }

    const ip = getClientIp(socket);
    if (!limitJoinAttempt(`join:${ip}:${id}`)) {
      callback?.({ success: false, error: '尝试过于频繁，请稍后再试' });
      return;
    }

    const cookieIdentity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    const userId = Boolean(readOnly)
      ? createServerClientId()
      : (cookieIdentity?.userId || createServerClientId());

    if (!readOnly && !cookieIdentity) {
      callback?.({ success: false, error: '会话未就绪，请刷新页面后重试', needsSession: true });
      return;
    }

    const auth = verifyRoomPassword(id, password, { clientId: userId });
    if (!auth.ok) {
      if (!limitJoinPasswordFail(`joinfail:${ip}:${id}`)) {
        callback?.({ success: false, error: '尝试过于频繁，请稍后再试' });
        return;
      }
      callback?.({ success: false, error: auth.error, needsPassword: auth.needsPassword });
      return;
    }

    const deviceId = resolveDeviceIdFromCookieHeader(socket.handshake?.headers?.cookie || '');
    // 安全限流仍使用连接来源 IP；客户端上报值仅用于成员归属展示/同端统计。
    // 站点封禁在密码校验前检查，避免被封用户反复试密码。
    const joinProbeIp = getClientIp(socket);
    const siteBan = isSiteBanned({ ip: joinProbeIp, deviceId });
    if (siteBan) {
      callback?.({ success: false, error: '你已被站点封禁，无法进入房间' });
      return;
    }

    const joinRoomInternal = getRoomInternal(id);
    if (joinRoomInternal && isAccessBanned(joinRoomInternal, userId, deviceId)) {
      callback?.({ success: false, error: '你已被移出该房间，无法再次进入' });
      return;
    }

    if (deviceId && !Boolean(readOnly)) {
      void linkDeviceToUser(deviceId, userId);
    }

    const prevRoomId = socketToRoom.get(socket.id);
    const prevUserId = getSocketUserId(socket);
    if (prevRoomId && prevRoomId !== id && prevUserId) {
      socket.leave(prevRoomId);
      const prevResult = removeUser(prevRoomId, prevUserId, socket.id);
      if (prevResult?.userRemoved && !prevResult.empty) {
        broadcastRoomUpdate(prevRoomId);
      }
    } else if (prevRoomId && prevRoomId !== id) {
      socket.leave(prevRoomId);
    }

    // 同一连接再次加入同一房间，但解析出的用户身份不同（如身份令牌尚未持久化、
    // 快速重连或 StrictMode 重复挂载）：先移除旧的占位用户，避免一个浏览器出现多个用户。
    if (prevRoomId === id && prevUserId && prevUserId !== userId) {
      removeUser(id, prevUserId, socket.id);
    }

    const joinInternalBefore = getRoomInternal(id);
    const priorUser = joinInternalBefore?.users?.get(userId);
    const hadActiveSession = Boolean(
      priorUser && (
        (Array.isArray(priorUser.connectionIds) && priorUser.connectionIds.length > 0)
        || priorUser.connectionId
      ),
    );

    // 安全限流仍使用连接来源 IP；客户端上报值仅用于成员归属展示/同端统计。
    const clientIp = normalizeReportedClientIp(reportedClientIp) || getClientIp(socket);
    const location = normalizeLocationName(clientLocation) || fallbackLocationForIp(clientIp);
    const joinedRoom = addUser(id, userId, nickname, {
      readOnly: Boolean(readOnly),
      connectionId: socket.id,
      location,
      deviceId: deviceId || undefined,
      clientIp: clientIp || undefined,
    });
    if (!joinedRoom) {
      callback?.({ success: false, error: '加入房间失败' });
      return;
    }
    if (joinedRoom.error) {
      callback?.({ success: false, error: joinedRoom.error });
      return;
    }

    socketToRoom.set(socket.id, id);
    socketToUserId.set(socket.id, userId);
    socket.join(id);

    const welcomeMessage = hadActiveSession ? null : postMemberWelcomeMessage(id, userId);

    // 无当前歌曲且队列为空时，加入后会异步拉取随机歌曲，先告知客户端"加载中"，
    // 避免播放条在随机歌曲到达前直接消失。
    const loadingRoom = markRandomLoading(id);
    const roomPayload = loadingRoom || joinedRoom;
    const chatHistory = getChatHistoryForUser(id, userId, { limit: INITIAL_CHAT_LIMIT });
    const joinInternal = getRoomInternal(id);
    const playbackState = joinInternal ? buildPlaybackState(joinInternal) : null;

    const joinUser = joinInternal?.users.get(userId);
    // 先 ACK 再广播：人数多时 O(N) 序列化/推送不应阻塞进房方超时
    callback?.({
      success: true,
      room: serializeRoomForViewer(id, userId) || roomPayload,
      messages: chatHistory.messages || [],
      chatHasMore: Boolean(chatHistory.hasMore),
      playbackState,
      socketId: userId,
      connectionId: socket.id,
      nickname: joinUser?.nickname
        || roomPayload.users?.find((user) => user.id === userId)?.nickname
        || String(nickname || '').trim(),
      // 不在 ACK 中下发 isOwner/isAdmin/canControl 等特权布尔值：
      // 角色仅由服务端鉴权 + 客户端用 room.creatorId/adminIds 与自身 socketId 比对展示 UI
    });

    setImmediate(() => {
      // 进房 ACK 已含完整快照，排除本人避免再收一次 40KB+ room_update
      broadcastRoomUpdate(id, { excludeSocketIds: [socket.id] });
      // room_update 广播省略 location，需单独补发新成员的归属地给房内其他人，
      // 否则他们要等自己退出重进才能看到（进房 ACK 才带全量 location）
      if (location) {
        socket.to(id).emit('user_location', { userId, location });
      }
      if (welcomeMessage) {
        socket.to(id).emit('chat_message', welcomeMessage);
      }
    });

    ensurePlayback(id).then((room) => {
      if (room) emitRoomAndPlayback(id, room);
    }).catch((err) => {
      console.error('Ensure playback after join failed:', err.message);
    });
  });

  socket.on('rename_user', ({ nickname }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'rename', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const userId = getSocketUserId(socket);
    const result = renameUser(roomId, userId, nickname);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('rename_room', ({ name }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'rename_room', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = renameRoom(roomId, getSocketUserId(socket), name, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_lock', ({ locked, password }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_lock', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomLock(roomId, getSocketUserId(socket), { locked, password }, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_fm_mode', ({ mode }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_fm_mode', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomFmMode(roomId, getSocketUserId(socket), mode, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_announcement', ({ enabled, text }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_announcement', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomAnnouncement(roomId, getSocketUserId(socket), { enabled, text }, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_chat_history', ({ enabled }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_chat_history', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setChatHistoryVisibleOnJoin(
      roomId,
      getSocketUserId(socket),
      enabled,
      socket.id,
    );
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_song_request', ({ enabled, minStaySec, maxPerUser, cooldownSec, queueMaxLength, memberJumpEnabled, memberSeekEnabled, memberPauseEnabled, systemMediaPlayBound, systemMediaSkipBound, dislikeSkipMode, dislikeSkipThreshold, dislikeSkipPercent, clearSongsOnLeaveEnabled, clearSongsOnLeaveDelaySec }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_song_request', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setSongRequestEnabled(roomId, getSocketUserId(socket), {
      enabled,
      minStaySec,
      maxPerUser,
      cooldownSec,
      queueMaxLength,
      memberJumpEnabled,
      memberSeekEnabled,
      memberPauseEnabled,
      systemMediaPlayBound,
      systemMediaSkipBound,
      dislikeSkipMode,
      dislikeSkipThreshold,
      dislikeSkipPercent,
      clearSongsOnLeaveEnabled,
      clearSongsOnLeaveDelaySec,
    }, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('ban_room_song', ({ song }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'ban_room_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = banRoomSong(roomId, getSocketUserId(socket), song, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('unban_room_song', ({ name }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'unban_room_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = unbanRoomSong(roomId, getSocketUserId(socket), name, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_audio_quality', ({ netease, tencent }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_audio_quality', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomAudioQuality(roomId, getSocketUserId(socket), { netease, tencent }, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_member_tier', ({ userId, tier }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_member_tier', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomMemberTier(roomId, getSocketUserId(socket), userId, tier, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('remove_room_member_tier', ({ userId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'remove_room_member_tier', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = removeRoomMemberTier(roomId, getSocketUserId(socket), userId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_room_member_settings', (settings, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_member_settings', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setRoomMemberSettings(roomId, getSocketUserId(socket), settings, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('set_chat_mute', ({ muteAll, userId, muted }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_chat_mute', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = setChatMute(roomId, getSocketUserId(socket), { muteAll, userId, muted }, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('kick_user', async ({ userId: targetUserId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'kick_user', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const actorId = getSocketUserId(socket);
    const result = await kickUser(roomId, actorId, targetUserId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);

    for (const [sid, rid] of socketToRoom.entries()) {
      if (rid !== roomId || socketToUserId.get(sid) !== targetUserId) continue;
      const kickedSocket = io.sockets.sockets.get(sid);
      socketToRoom.delete(sid);
      socketToUserId.delete(sid);
      kickedSocket?.leave(roomId);
      kickedSocket?.emit('kicked', {
        message: '你已被房主移出房间，无法再次进入',
      });
    }

    callback?.({
      success: true,
      room: getViewerRoomPayload(socket, roomId),
      message: `已移出「${result.kickedNickname}」，该用户将无法再次进入本房间`,
    });
  });

  socket.on('transfer_owner', ({ userId: targetUserId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'transfer_owner', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const actorId = getSocketUserId(socket);
    const result = transferOwner(roomId, actorId, targetUserId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId), message: result.message });
  });

  socket.on('set_room_admin', ({ userId: targetUserId, admin }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'set_room_admin', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const actorId = getSocketUserId(socket);
    const result = setRoomAdmin(roomId, actorId, targetUserId, Boolean(admin), socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId), message: result.message });
  });

  socket.on('leave_room', (_payload, callback) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: true });
      return;
    }

    socket.leave(roomId);
    socketToRoom.delete(socket.id);
    const userId = getSocketUserId(socket);
    socketToUserId.delete(socket.id);
    if (userId) {
      const result = removeUser(roomId, userId, socket.id);
      if (result?.userRemoved && !result.empty) {
        broadcastRoomUpdate(roomId);
      }
    }
    callback?.({ success: true });
  });

  socket.on('add_song', async ({ song }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'add_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const clean = sanitizeClientSong(song);
    if (clean.error) {
      callback?.({ success: false, error: clean.error });
      return;
    }

    const room = getRoomInternal(roomId);
    const userId = getSocketUserId(socket);
    const user = room?.users.get(userId);
    const result = await addToQueue(roomId, clean.song, {
      id: userId,
      nickname: user?.nickname || '匿名',
    });
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    emitRoomAndPlayback(roomId, result.room);
    emitSystemChat(roomId, result.systemMessage);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('remove_song', ({ queueId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'remove_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = removeFromQueue(roomId, getSocketUserId(socket), queueId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    emitSystemChat(roomId, result.systemMessage);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('clear_queue', (_payload, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'clear_queue', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = clearQueue(roomId, getSocketUserId(socket), socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('skip_song', async ({ reason } = {}, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'skip_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await skipSong(roomId, getSocketUserId(socket), socket.id, { reason });
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    emitRoomAndPlayback(roomId, result.room);
    emitSystemChat(roomId, result.systemMessage);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('finish_song', async ({ queueId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'finish_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const expectedQueueId = String(queueId || '');
    const advanced = await advanceEndedRoomNow(roomId, expectedQueueId);
    if (advanced) {
      emitRoomAndPlayback(roomId, advanced);
      callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
      return;
    }

    const result = await finishCurrentSong(roomId, getSocketUserId(socket), socket.id, expectedQueueId);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    emitRoomAndPlayback(roomId, result.room);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('request_jump', async ({ queueId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'request_jump', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await requestJump(roomId, getSocketUserId(socket), queueId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    emitSystemChat(roomId, result.systemMessage);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('reorder_queue', ({ orderedQueueIds, movedQueueId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'reorder_queue', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = reorderQueue(roomId, getSocketUserId(socket), orderedQueueIds, movedQueueId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    io.to(roomId).emit('queue_snapshot', {
      queue: result.room.queue,
      current: result.room.current,
    });
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('toggle_queue_like', ({ queueId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'toggle_queue_like', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = toggleQueueLike(roomId, getSocketUserId(socket), queueId);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    // 点赞会改队列排序：只推 queue/current，不下发整包 users
    io.to(roomId).emit('queue_snapshot', {
      queue: result.queue || [],
      current: result.current || null,
    });
    emitSystemChat(roomId, result.systemMessage);
    callback?.({ success: true, liked: result.liked });
  });

  socket.on('toggle_current_dislike', async (_payload, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'toggle_current_dislike', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await toggleCurrentDislike(roomId, getSocketUserId(socket));
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    if (result.skipped) {
      emitRoomAndPlayback(roomId, result.room);
    } else {
      io.to(roomId).emit('queue_snapshot', {
        queue: result.room?.queue || [],
        current: result.room?.current || null,
      });
    }
    emitSystemChat(roomId, result.systemMessage);
    callback?.({
      success: true,
      disliked: result.disliked,
      skipped: result.skipped,
      dislikeCount: result.dislikeCount,
      threshold: result.threshold,
      room: getViewerRoomPayload(socket, roomId),
    });
  });

  socket.on('approve_jump', async ({ requestId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'approve_jump', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await approveJump(roomId, getSocketUserId(socket), requestId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('reject_jump', ({ requestId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'reject_jump', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = rejectJump(roomId, getSocketUserId(socket), requestId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('request_skip', (_payload, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'request_skip', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = requestSkip(roomId, getSocketUserId(socket));
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('approve_skip', async ({ requestId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'approve_skip', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await approveSkip(roomId, getSocketUserId(socket), requestId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    emitRoomAndPlayback(roomId, result.room);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('reject_skip', ({ requestId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'reject_skip', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = rejectSkip(roomId, getSocketUserId(socket), requestId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    broadcastRoomUpdate(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('send_chat', async ({ text, mentions, replyTo, imageUrl, imageKey, asSticker, textGatePass }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketChat, 'send_chat', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const textContent = String(text || '').trim();
    if (textContent) {
      const identity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
      const gateOk = Boolean(
        identity
        && identity.userId === getSocketUserId(socket)
        && verifyChatTextGatePass(CLIENT_ID_SECRET, identity, textContent, textGatePass),
      );
      // 前端密令有效则跳过慢速敏感词接口；否则走服务端兜底
      if (!gateOk) {
        const sensitive = await checkApihzSensitiveWords(textContent);
        if (!sensitive.ok) {
          callback?.({ success: false, error: sensitive.error });
          return;
        }
      }
    }

    const imageContent = String(imageUrl || '').trim();
    if (imageContent && !isLocalStickerImageKey(imageKey)) {
      const imageModeration = await moderateCyapiImage(imageContent);
      if (!imageModeration.ok) {
        callback?.({ success: false, error: imageModeration.error });
        return;
      }
    }

    const result = addChatMessage(roomId, getSocketUserId(socket), text, {
      mentions,
      replyTo,
      imageUrl,
      imageKey,
      asSticker,
    });
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    // 先 ACK 再广播，避免大图表情包推给全员时发送方超时
    callback?.({ success: true, message: result.message });

    const rawUrl = String(result.message?.imageUrl || '');
    const hugeDataUrl = rawUrl.startsWith('data:') && rawUrl.length > 12 * 1024;
    if (hugeDataUrl) {
      // 超大 data URL：其他人只收占位，发送者收完整图（socket.to 不含自己）
      socket.to(roomId).emit('chat_message', { ...result.message, imageUrl: null });
      socket.emit('chat_message', result.message);
    } else {
      io.to(roomId).emit('chat_message', result.message);
    }
  });

  socket.on('recall_chat', ({ messageId }, callback) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = recallChatMessage(roomId, getSocketUserId(socket), messageId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    callback?.({ success: true });
    if (result.recalledMessageId) {
      io.to(roomId).emit('chat_message_recall', { messageId: result.recalledMessageId });
    }
    if (result.recallMessage) {
      io.to(roomId).emit('chat_message', result.recallMessage);
    }
  });

  socket.on('toggle_chat_reaction', ({ messageId, emoji }, callback) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = toggleChatReaction(roomId, getSocketUserId(socket), messageId, emoji);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    io.to(roomId).emit('chat_reaction_update', {
      messageId: result.messageId,
      reactions: result.reactions,
    });
    callback?.({ success: true, messageId: result.messageId, reactions: result.reactions });
  });

  socket.on('load_chat_history', ({ before, beforeId, limit }, callback) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = getChatHistoryForUser(roomId, getSocketUserId(socket), { before, beforeId, limit });
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    callback?.({
      success: true,
      messages: result.messages,
      hasMore: Boolean(result.hasMore),
    });
  });

  socket.on('load_song_history', ({ limit }, callback) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = getSongHistory(roomId, { limit });
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    callback?.({ success: true, songs: result.songs });
  });

  socket.on('report_track_duration', async ({ queueId, durationMs }, callback) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = reportTrackDuration(
      roomId,
      getSocketUserId(socket),
      queueId,
      durationMs,
      socket.id,
    );
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }
    callback?.({ success: true, skipped: Boolean(result.skipped) });

    // 补种/缩短时长后，若时钟已越过真实尽头则立刻切歌（不必等 500ms 轮询）
    if (!result.skipped) {
      await advanceEndedRoomNow(roomId, queueId || '');
    }
  });


  socket.on('list_favorites', async (_payload, callback) => {
    const identity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    if (!identity?.userId) {
      callback?.({ success: false, error: '会话未就绪，请刷新页面后重试' });
      return;
    }
    const favorites = await listFavoriteSongs(identity.userId);
    callback?.({ success: true, favorites });
  });

  socket.on('set_favorite', async ({ song, favorite }, callback) => {
    if (rejectRateLimited(socket, limitSocketAction, 'set_favorite', callback)) return;

    const identity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    if (!identity?.userId) {
      callback?.({ success: false, error: '会话未就绪，请刷新页面后重试' });
      return;
    }

    const clean = sanitizeClientSong(song);
    if (clean.error) {
      callback?.({ success: false, error: clean.error });
      return;
    }

    const result = await setFavoriteSong(identity.userId, clean.song, Boolean(favorite));
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }
    callback?.({ success: true, favorites: result.favorites, favorite: result.favorite });
  });

  socket.on('import_favorites', async ({ songs }, callback) => {
    if (rejectRateLimited(socket, limitSocketAction, 'import_favorites', callback)) return;

    const identity = resolveIdentityFromCookies(socket.handshake?.headers?.cookie || '');
    if (!identity?.userId) {
      callback?.({ success: false, error: '会话未就绪，请刷新页面后重试' });
      return;
    }

    if (!Array.isArray(songs) || songs.length === 0 || songs.length > 1000) {
      callback?.({ success: false, error: '收藏数据格式无效' });
      return;
    }

    const cleanSongs = [];
    for (const song of songs) {
      const clean = sanitizeClientSong(song);
      if (!clean.error) cleanSongs.push(clean.song);
    }

    const result = await importFavoriteSongs(identity.userId, cleanSongs);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }
    callback?.({ success: true, favorites: result.favorites, imported: result.imported, dropped: result.dropped, maxFavorites: result.maxFavorites });
  });
  socket.on('toggle_play', ({ isPlaying }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'toggle_play', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const updated = setPlaying(roomId, getSocketUserId(socket), isPlaying, socket.id);
    if (!updated) {
      callback?.({ success: false, error: '房间未允许成员暂停/播放' });
      return;
    }
    emitPlaybackOnly(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('seek', ({ time }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'seek', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const updated = seekTo(roomId, getSocketUserId(socket), time, socket.id);
    if (!updated) {
      callback?.({ success: false, error: '房间未允许成员调节进度' });
      return;
    }
    emitPlaybackOnly(roomId);
    callback?.({ success: true, room: getViewerRoomPayload(socket, roomId) });
  });

  socket.on('disconnect', () => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return;

    const userId = getSocketUserId(socket);
    socketToRoom.delete(socket.id);
    socketToUserId.delete(socket.id);
    if (!userId) return;

    setTimeout(() => {
      const result = removeUser(roomId, userId, socket.id);
      // 多端同用户仍在线、或房间已空：不必全房推送
      if (!result?.userRemoved || result.empty) return;
      broadcastRoomUpdate(roomId);
    }, DISCONNECT_GRACE_MS);
  });
});

let autoAdvanceRunning = false;

async function checkAutoAdvance() {
  if (autoAdvanceRunning) return;
  autoAdvanceRunning = true;

  try {
    for (const roomId of listRoomIds()) {
      const internal = getRoomInternal(roomId);
      if (!internal || internal.users.size === 0) continue;

      if (internal.randomLoading && !internal.current) {
        const retried = await retryStuckRandomLoading(roomId);
        if (retried) {
          emitRoomAndPlayback(roomId, retried);
        }
        continue;
      }

      if (!internal.isPlaying || !internal.current) continue;

      const advanced = await advancePlaybackIfEnded(roomId);
      if (advanced) {
        emitRoomAndPlayback(roomId, advanced);
      }
    }
  } finally {
    autoAdvanceRunning = false;
  }
}

setInterval(() => {
  void checkAutoAdvance();
}, AUTO_ADVANCE_INTERVAL_MS);

await initRooms();

const setupRequired = isSetupRequired();
if (!isRedisEnabled()) {
  if (setupRequired && !hasRedisEnvConfig()) {
    console.warn('🛠️ OpenMusic 尚未初始化，请访问 /setup 完成首次部署（需配置 Redis）');
  } else {
    console.error('❌ Redis 为必需依赖：未连接时无法启动。请检查 REDIS_URL / REDIS_HOST 后重试。');
    process.exit(1);
  }
} else {
  await initSiteAnnouncement();
  await initSiteBans();
  if (!setupRequired) {
    await initAdminCredentials();
  } else {
    console.warn('🛠️ OpenMusic 尚未初始化，请访问 /setup 完成首次部署');
  }
}

httpServer.listen(PORT, () => {
  console.log(`🎵 OpenMusic 服务运行在 http://localhost:${PORT}`);
  console.log(`📡 Meting API: ${getMetingUpstreamBases().join(', ') || '未配置'}`);
  console.log(`🎤 Cyapi (绿点/蓝点): ${isCyapiConfigured() ? '已配置' : '未配置'}`);
  console.log(`💾 持久化存储: ${isRedisEnabled() ? 'Redis' : '未连接（仅安装向导）'}`);
  startMetingHealthProbe();
});
