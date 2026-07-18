import fs from 'fs';
import path from 'path';
import { createHash, randomBytes, scrypt as scryptCallback } from 'crypto';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { sanitizeAdminEntryPath, setAdminEntryPath } from './adminConfig.js';

const scrypt = promisify(scryptCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '.env');
const LOCK_PATH = path.join(__dirname, 'setup.lock');
const ADMIN_CREDENTIALS_KEY = 'openmusic:admin:credentials';
const attempts = new Map();

function hasLegacyConfiguration() {
  const redisConfigured = Boolean(
    String(process.env.REDIS_URL || '').trim()
    || String(process.env.REDIS_HOST || '').trim(),
  );
  return redisConfigured && Boolean(String(process.env.ADMIN_KEY || '').trim());
}

function writeSetupLock(detail = {}) {
  const payload = {
    installedAt: new Date().toISOString(),
    version: 1,
    ...detail,
  };
  fs.writeFileSync(LOCK_PATH, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}

/** 老版本已通过环境变量部署时自动加锁，避免升级后暴露安装接口。 */
export function migrateLegacySetupLock() {
  if (fs.existsSync(LOCK_PATH) || !hasLegacyConfiguration()) return;
  try {
    writeSetupLock({ migrated: true });
  } catch (err) {
    if (err?.code !== 'EEXIST') {
      console.error('setup: 迁移安装锁失败:', err?.message || err);
    }
  }
}

export function isSetupRequired() {
  return !fs.existsSync(LOCK_PATH);
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

function isRateLimited(req, max = 10) {
  const key = clientIp(req);
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.startedAt > 60_000) {
    attempts.set(key, { startedAt: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

function requireSameHost(req, res, next) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) {
    if (process.env.NODE_ENV !== 'production') return next();
    return res.status(403).json({ error: '请求来源不被允许' });
  }
  try {
    if (new URL(origin).host !== String(req.headers.host || '')) {
      return res.status(403).json({ error: '请求来源不被允许' });
    }
  } catch {
    return res.status(403).json({ error: '请求来源不被允许' });
  }
  next();
}

function cleanText(raw, max = 256) {
  const value = String(raw ?? '').trim();
  if (/[\r\n\0]/.test(value) || value.length > max) return null;
  return value;
}

function parseRedisInput(raw = {}) {
  const mode = raw.mode === 'url' ? 'url' : 'host';
  if (mode === 'url') {
    const url = cleanText(raw.url, 1024);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') throw new Error();
      return { options: { url }, values: { REDIS_URL: url } };
    } catch {
      return { error: 'Redis URL 必须以 redis:// 或 rediss:// 开头' };
    }
  }

  const host = cleanText(raw.host, 253);
  const username = cleanText(raw.username, 128);
  const password = cleanText(raw.password, 512);
  const port = Number(raw.port);
  const database = Number(raw.database);
  if (!host || !/^[A-Za-z0-9._:-]+$/.test(host)) return { error: 'Redis 主机名无效' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'Redis 端口无效' };
  if (!Number.isInteger(database) || database < 0 || database > 255) return { error: 'Redis DB 无效' };

  const options = { socket: { host, port, connectTimeout: 8_000 }, database };
  if (username) options.username = username;
  if (password) options.password = password;
  return {
    options,
    values: {
      REDIS_HOST: host,
      REDIS_PORT: String(port),
      REDIS_USERNAME: username || '',
      REDIS_PASSWORD: password || '',
      REDIS_DB: String(database),
    },
  };
}

async function connectRedis(raw) {
  const parsed = parseRedisInput(raw);
  if (parsed.error) return parsed;
  const { createClient } = await import('redis');
  const client = createClient(parsed.options);
  client.on('error', () => {});
  try {
    await client.connect();
    await client.ping();
    return { client, values: parsed.values };
  } catch (err) {
    try {
      if (client.isOpen) await client.quit();
    } catch {
      // ignore cleanup failure
    }
    return { error: `Redis 连接失败：${err?.message || err}` };
  }
}

function updateEnvFile(values) {
  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const lines = existing ? existing.replace(/\r\n/g, '\n').split('\n') : [];
  const pending = new Map(Object.entries(values));
  const format = (value) => JSON.stringify(String(value ?? ''));
  const next = lines.map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!match || !pending.has(match[1])) return line;
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return `${match[1]}=${format(value)}`;
  });
  if (next.length && next[next.length - 1] !== '') next.push('');
  for (const [key, value] of pending) next.push(`${key}=${format(value)}`);
  const temp = `${ENV_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${next.join('\n').replace(/\n+$/, '')}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(temp, ENV_PATH);
}

async function createBootstrapCredentials(client, username, password, { mustChange = true } = {}) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 32)).toString('hex');
  await client.set(ADMIN_CREDENTIALS_KEY, JSON.stringify({
    username,
    salt,
    hash,
    updatedAt: Date.now(),
    mustChange: Boolean(mustChange),
  }));
}

function pickFromAlphabet(alphabet, length) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** 安装完成时随机账号：om_ + 8 位小写字母数字 */
function generateBootstrapUsername() {
  return `om_${pickFromAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)}`;
}

/** 安装完成时随机密码：16 位，避开易混淆字符 */
function generateBootstrapPassword() {
  return pickFromAlphabet(
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*',
    16,
  );
}

function validateSiteUrl(raw) {
  const value = cleanText(raw, 512);
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
    return parsed.origin;
  } catch {
    return null;
  }
}

/** 校验并规范化 Meting 上游地址（支持逗号分隔多上游、chksz: 前缀）。空值允许（可后台再配） */
function validateMetingUrl(raw) {
  const value = cleanText(raw, 1024);
  if (value === null) return null;
  if (!value) return '';
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  for (let part of parts) {
    if (part.toLowerCase().startsWith('chksz:')) part = part.slice(6).trim();
    try {
      const parsed = new URL(part);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    } catch {
      return null;
    }
  }
  return parts.join(',');
}

export function mountSetupApi(app) {
  migrateLegacySetupLock();

  app.get('/api/setup/status', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ setupRequired: isSetupRequired() });
  });

  app.post('/api/setup/test-redis', requireSameHost, async (req, res) => {
    if (!isSetupRequired()) return res.status(404).json({ error: '安装向导已锁定' });
    if (isRateLimited(req)) return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });
    const result = await connectRedis(req.body?.redis);
    if (result.error) return res.status(400).json({ error: result.error });
    await result.client.quit();
    res.json({ ok: true });
  });

  app.post('/api/setup/complete', requireSameHost, async (req, res) => {
    if (!isSetupRequired()) return res.status(404).json({ error: '安装向导已锁定' });
    if (isRateLimited(req, 5)) return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });

    const siteUrl = validateSiteUrl(req.body?.siteUrl);
    if (siteUrl === null) return res.status(400).json({ error: '站点地址必须是有效的 http/https 地址' });
    const adminPath = sanitizeAdminEntryPath(req.body?.adminPath);
    if (!adminPath || adminPath === '/admin') {
      return res.status(400).json({ error: '管理入口须为非 /admin 的 8–64 位随机路径' });
    }
    const metingApiUrl = validateMetingUrl(req.body?.metingApiUrl);
    if (metingApiUrl === null) {
      return res.status(400).json({ error: 'Meting 音源地址无效（http/https，多个用英文逗号分隔）' });
    }
    const metingApiAuth = cleanText(req.body?.metingApiAuth, 1024);
    if (metingApiAuth === null) return res.status(400).json({ error: 'Meting 令牌无效' });

    const result = await connectRedis(req.body?.redis);
    if (result.error) return res.status(400).json({ error: result.error });

    try {
      // 安装完成随机生成账号密码（已足够强，不再强制改密；入口路径已在向导中设为非 /admin）
      const username = generateBootstrapUsername();
      const password = generateBootstrapPassword();
      await createBootstrapCredentials(result.client, username, password, { mustChange: false });
      const clientSecret = randomBytes(32).toString('hex');
      const setupNonce = createHash('sha256').update(randomBytes(32)).digest('hex');
      updateEnvFile({
        ...result.values,
        CLIENT_URL: siteUrl || '',
        CLIENT_ID_SECRET: clientSecret,
        TRUST_PROXY: req.body?.trustProxy === false ? '0' : '1',
        METING_API_URL: metingApiUrl,
        METING_API_AUTH: metingApiAuth,
        SETUP_NONCE: setupNonce,
      });
      const pathResult = setAdminEntryPath(adminPath, { requireCustom: true });
      if (!pathResult.success) throw new Error(pathResult.error);
      writeSetupLock({ siteUrl: siteUrl || '', adminPath });
      await result.client.quit();
      res.json({
        ok: true,
        restartRequired: true,
        adminPath,
        username,
        password,
      });
    } catch (err) {
      try {
        if (result.client.isOpen) await result.client.quit();
      } catch {
        // ignore cleanup failure
      }
      if (err?.code === 'EEXIST') return res.status(409).json({ error: '安装已由其它请求完成' });
      console.error('setup: 安装失败:', err?.message || err);
      res.status(500).json({ error: '保存安装配置失败' });
    }
  });
}
