import fs from 'fs';
import path from 'path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { isBlockedMediaHostname } from './mediaProxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'runtimeConfig.json');
const SECRET_FIELDS = new Set([
  'metingApiAuth',
  'cyapiKey',
  'qiniuAccessKey',
  'qiniuSecretKey',
  'apihzId',
  'apihzKey',
]);
const QINIU_ZONES = new Set(['z0', 'z1', 'z2', 'na0', 'as0']);
const ENC_PREFIX = 'enc:v1:';
/** 管理后台回显：保留首尾，中间用 ...... 隐藏 */
const MASK_GAP = '......';

let cached = { mtimeMs: -1, persisted: {} };

export function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 4) return `${text.slice(0, 1)}${MASK_GAP}`;
  if (text.length <= 8) return `${text.slice(0, 2)}${MASK_GAP}${text.slice(-1)}`;
  return `${text.slice(0, 3)}${MASK_GAP}${text.slice(-3)}`;
}

function envText(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function envRoomEmptyTtlMs() {
  const value = Number(process.env.ROOM_EMPTY_TTL_MS);
  if (!Number.isFinite(value)) return 10 * 60 * 1000;
  return Math.max(0, Math.min(Math.round(value), 24 * 60 * 60 * 1000));
}

function envDefaults() {
  return {
    roomEmptyTtlMs: envRoomEmptyTtlMs(),
    metingApiUrl: envText('METING_API_URL'),
    metingApiAuth: envText('METING_API_AUTH'),
    cyapiBase: envText('CYAPI_BASE', envText('CYAPI_URL').replace(/\/qq_music\.php$/i, '') || 'https://cyapi.top/API'),
    cyapiKey: envText('CYAPI_KEY'),
    vmyLrcUrl: envText('VMY_LRC_URL', 'https://api.52vmy.cn/api/music/lrc'),
    // 支持英文逗号分隔多个 LrcAPI 上游做负载均衡；置空则禁用该级兜底
    lrcapiUrl: envText('LRCAPI_URL', 'https://api.lrc.cx'),
    qiniuAccessKey: envText('QINIU_ACCESS_KEY'),
    qiniuSecretKey: envText('QINIU_SECRET_KEY'),
    qiniuBucket: envText('QINIU_BUCKET'),
    qiniuDomain: envText('QINIU_DOMAIN'),
    qiniuZone: envText('QINIU_ZONE', 'z0'),
    apihzBaseUrl: envText('APIHZ_BASE_URL', 'https://cn.apihz.cn/api'),
    apihzId: envText('APIHZ_ID', envText('APIHZ_IMG_ID', envText('APIHZ_MGC_ID'))),
    apihzKey: envText('APIHZ_KEY', envText('APIHZ_IMG_KEY', envText('APIHZ_MGC_KEY'))),
  };
}

/** 用 CLIENT_ID_SECRET 派生 AES-256 密钥；未配置时密钥字段不落盘 */
function getSecretKey() {
  const secret = String(process.env.CLIENT_ID_SECRET || '').trim();
  if (!secret) return null;
  return createHash('sha256').update(`om-runtime-cfg:${secret}`).digest();
}

function encryptSecret(plain) {
  const text = String(plain || '');
  if (!text) return '';
  const key = getSecretKey();
  if (!key) return null; // 无法加密 → 调用方跳过落盘
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
}

function decryptSecret(raw) {
  const value = String(raw || '');
  if (!value) return '';
  if (!value.startsWith(ENC_PREFIX)) return value; // 兼容旧版明文
  const key = getSecretKey();
  if (!key) {
    console.warn('runtime-config: 无法解密密钥字段（缺少 CLIENT_ID_SECRET）');
    return '';
  }
  try {
    const parts = value.slice(ENC_PREFIX.length).split(':');
    if (parts.length !== 3) return '';
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const data = Buffer.from(dataB64, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (err) {
    console.error('runtime-config 密钥解密失败:', err?.message || err);
    return '';
  }
}

function decodePersisted(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = { ...raw };
  for (const field of SECRET_FIELDS) {
    if (typeof out[field] === 'string' && out[field]) {
      out[field] = decryptSecret(out[field]);
    }
  }
  return out;
}

function encodeForDisk(config) {
  const out = { ...config };
  for (const field of SECRET_FIELDS) {
    const plain = String(out[field] || '');
    if (!plain) {
      out[field] = '';
      continue;
    }
    const encrypted = encryptSecret(plain);
    if (encrypted === null) {
      // 无 CLIENT_ID_SECRET：密钥不写入磁盘，仅保留环境变量 / 进程内存
      delete out[field];
    } else {
      out[field] = encrypted;
    }
  }
  return out;
}

function readPersisted() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return decodePersisted(parsed);
  } catch (err) {
    console.error('runtime-config read error:', err?.message || err);
    return {};
  }
}

function getPersisted() {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(CONFIG_PATH).mtimeMs;
  } catch {
    if (cached.mtimeMs !== 0) cached = { mtimeMs: 0, persisted: {} };
    return cached.persisted;
  }
  if (cached.mtimeMs !== mtimeMs) {
    cached = { mtimeMs, persisted: readPersisted() };
  }
  return cached.persisted;
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalize(config) {
  const roomEmptyTtlMs = Number(config.roomEmptyTtlMs);
  return {
    roomEmptyTtlMs: Number.isFinite(roomEmptyTtlMs)
      ? Math.max(0, Math.min(Math.round(roomEmptyTtlMs), 24 * 60 * 60 * 1000))
      : 10 * 60 * 1000,
    metingApiUrl: String(config.metingApiUrl || '').trim(),
    metingApiAuth: String(config.metingApiAuth || '').trim(),
    cyapiBase: trimTrailingSlash(config.cyapiBase) || 'https://cyapi.top/API',
    cyapiKey: String(config.cyapiKey || '').trim(),
    vmyLrcUrl: trimTrailingSlash(config.vmyLrcUrl) || 'https://api.52vmy.cn/api/music/lrc',
    lrcapiUrl: String(config.lrcapiUrl ?? '')
      .split(',')
      .map((s) => trimTrailingSlash(s))
      .filter(Boolean)
      .join(','),
    qiniuAccessKey: String(config.qiniuAccessKey || '').trim(),
    qiniuSecretKey: String(config.qiniuSecretKey || '').trim(),
    qiniuBucket: String(config.qiniuBucket || '').trim(),
    qiniuDomain: trimTrailingSlash(config.qiniuDomain),
    qiniuZone: QINIU_ZONES.has(String(config.qiniuZone || '').trim()) ? String(config.qiniuZone).trim() : 'z0',
    apihzBaseUrl: trimTrailingSlash(config.apihzBaseUrl) || 'https://cn.apihz.cn/api',
    apihzId: String(config.apihzId || '').trim(),
    apihzKey: String(config.apihzKey || '').trim(),
  };
}

export function getRuntimeConfig() {
  return normalize({ ...envDefaults(), ...getPersisted() });
}

function validateHttpUrl(value, label, { allowEmpty = false, allowList = false } = {}) {
  const values = allowList ? String(value || '').split(',') : [String(value || '')];
  for (let raw of values) {
    raw = raw.trim();
    if (allowList && raw.toLowerCase().startsWith('chksz:')) raw = raw.slice(6).trim();
    if (!raw && allowEmpty) continue;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `${label}必须是 http/https 地址${allowList ? '，多个地址用英文逗号分隔' : ''}`;
      }
      if (isBlockedMediaHostname(parsed.hostname)) {
        return `${label}不允许指向内网、本机或云元数据地址`;
      }
    } catch {
      return `${label}必须是 http/https 地址${allowList ? '，多个地址用英文逗号分隔' : ''}`;
    }
  }
  return '';
}

export function getRuntimeConfigForAdmin() {
  const config = getRuntimeConfig();
  const result = { ...config, configuredSecrets: {} };
  const urls = String(config.metingApiUrl || '').split(',').map((value) => value.trim()).filter(Boolean);
  const auths = String(config.metingApiAuth || '').split(',').map((value) => value.trim());
  result.metingSources = urls.map((rawUrl, index) => {
    const explicitChksz = rawUrl.toLowerCase().startsWith('chksz:');
    const url = explicitChksz ? rawUrl.slice('chksz:'.length).trim() : rawUrl;
    let isChksz = explicitChksz;
    try {
      isChksz ||= new URL(url).hostname.toLowerCase() === 'api.chksz.com';
    } catch {
      // 原有无效地址仍交给保存时的统一校验处理
    }
    const auth = auths.length === 1 ? auths[0] : (auths[index] || '');
    return {
      url,
      type: isChksz ? 'chksz' : 'meting',
      configuredAuth: Boolean(auth),
      auth: auth ? maskSecret(auth) : '',
    };
  });
  for (const field of SECRET_FIELDS) {
    result.configuredSecrets[field] = Boolean(config[field]);
    result[field] = config[field] ? maskSecret(config[field]) : '';
  }
  return result;
}

export function setRuntimeConfig(raw = {}) {
  const current = getRuntimeConfig();
  const next = { ...current };
  const clearSecrets = new Set(Array.isArray(raw.clearSecrets) ? raw.clearSecrets : []);

  // 管理后台使用结构化源列表；磁盘和环境变量格式仍保持逗号分隔，兼容旧部署。
  if (Array.isArray(raw.metingSources)) {
    const oldUrls = String(current.metingApiUrl || '').split(',').map((value) => value.trim()).filter(Boolean);
    const oldAuths = String(current.metingApiAuth || '').split(',').map((value) => value.trim());
    const oldAuthByUrl = new Map(oldUrls.map((rawUrl, index) => {
      const url = rawUrl.toLowerCase().startsWith('chksz:') ? rawUrl.slice('chksz:'.length).trim() : rawUrl;
      const auth = oldAuths.length === 1 ? oldAuths[0] : (oldAuths[index] || '');
      return [trimTrailingSlash(url), auth];
    }));
    const sources = raw.metingSources.slice(0, 20).map((source) => {
      const url = trimTrailingSlash(source?.url);
      const type = source?.type === 'chksz' ? 'chksz' : 'meting';
      const submittedAuth = typeof source?.auth === 'string' ? source.auth.trim() : '';
      const auth = source?.clearAuth ? '' : (submittedAuth || oldAuthByUrl.get(url) || '');
      return { url, type, auth };
    }).filter((source) => source.url);
    next.metingApiUrl = sources
      .map((source) => source.type === 'chksz' ? `chksz:${source.url}` : source.url)
      .join(',');
    next.metingApiAuth = sources.some((source) => source.auth)
      ? sources.map((source) => source.auth).join(',')
      : '';
  }

  for (const field of Object.keys(current)) {
    if (SECRET_FIELDS.has(field)) {
      if (field === 'metingApiAuth' && Array.isArray(raw.metingSources)) continue;
      if (clearSecrets.has(field)) next[field] = '';
      else if (typeof raw[field] === 'string' && raw[field].trim()) next[field] = raw[field].trim();
    } else if (Object.hasOwn(raw, field)) {
      next[field] = raw[field];
    }
  }

  const normalized = normalize(next);
  const urlChecks = [
    validateHttpUrl(normalized.metingApiUrl, 'Meting API 地址', { allowEmpty: true, allowList: true }),
    validateHttpUrl(normalized.cyapiBase, '迟言 API 地址'),
    validateHttpUrl(normalized.vmyLrcUrl, '歌词备用地址'),
    validateHttpUrl(normalized.lrcapiUrl, 'LrcAPI 歌词地址', { allowEmpty: true, allowList: true }),
    validateHttpUrl(normalized.qiniuDomain, '七牛云域名', { allowEmpty: true }),
    validateHttpUrl(normalized.apihzBaseUrl, '接口盒子地址'),
  ].filter(Boolean);
  if (urlChecks.length) return { success: false, error: urlChecks[0] };

  try {
    const forDisk = encodeForDisk(normalized);
    const tempPath = `${CONFIG_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(forDisk, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, CONFIG_PATH);
    // 内存缓存保留明文，供运行时使用；磁盘为加密形态
    cached = { mtimeMs: fs.statSync(CONFIG_PATH).mtimeMs, persisted: normalized };
    return { success: true, config: getRuntimeConfigForAdmin() };
  } catch (err) {
    console.error('runtime-config write error:', err?.message || err);
    return { success: false, error: '运行配置保存失败' };
  }
}
