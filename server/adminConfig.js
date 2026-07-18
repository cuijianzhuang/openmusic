import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'adminConfig.json');
const DEFAULT_ENTRY_PATH = '/admin';

const RESERVED_PREFIXES = [
  '/api',
  '/socket.io',
  '/downloads',
  '/wx-proxy',
  '/cgi-bin',
  '/room/',
  '/tv/',
  '/assets/',
  '/qface/',
  '/vendor/',
];

let cached = {
  mtimeMs: -1,
  entryPath: DEFAULT_ENTRY_PATH,
};

function normalizeEntryPath(raw) {
  let p = String(raw || '').trim();
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/** @returns {string | null} 合法路径，否则 null */
export function sanitizeAdminEntryPath(raw) {
  const p = normalizeEntryPath(raw);
  // /admin 默认入口；自定义须 8–64 位 URL 安全字符
  if (p === '/admin') return p;
  if (!/^\/[A-Za-z0-9_-]{8,64}$/.test(p)) return null;
  const lower = p.toLowerCase();
  if (lower === '/room' || lower === '/tv') return null;
  for (const prefix of RESERVED_PREFIXES) {
    const bare = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    if (lower === bare || lower.startsWith(prefix)) return null;
  }
  return p;
}

function readFromDisk() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return DEFAULT_ENTRY_PATH;
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return sanitizeAdminEntryPath(raw.entryPath) || DEFAULT_ENTRY_PATH;
  } catch (err) {
    console.error('admin-config read error:', err?.message || err);
    return DEFAULT_ENTRY_PATH;
  }
}

export function getAdminEntryPath() {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(CONFIG_PATH).mtimeMs;
  } catch {
    cached = { mtimeMs: 0, entryPath: DEFAULT_ENTRY_PATH };
    return DEFAULT_ENTRY_PATH;
  }
  if (cached.mtimeMs === mtimeMs) return cached.entryPath;
  const entryPath = readFromDisk();
  cached = { mtimeMs, entryPath };
  return entryPath;
}

export function setAdminEntryPath(raw) {
  const entryPath = sanitizeAdminEntryPath(raw);
  if (!entryPath) {
    return { success: false, error: '登录地址格式无效（可用 /admin，或 / 加 8–64 位字母数字_-）' };
  }
  try {
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify({ entryPath }, null, 2)}\n`, 'utf8');
    cached = { mtimeMs: fs.statSync(CONFIG_PATH).mtimeMs, entryPath };
    return { success: true, entryPath };
  } catch (err) {
    console.error('admin-config write error:', err?.message || err);
    return { success: false, error: '保存失败' };
  }
}

export function createRandomAdminEntryPath() {
  return `/${randomBytes(12).toString('base64url')}`;
}
