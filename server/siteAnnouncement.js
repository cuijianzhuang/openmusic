import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.join(__dirname, 'siteAnnouncement.json');
const MAX_TITLE_LENGTH = 40;
const MAX_TEXT_LENGTH = 4000;

let cached = {
  mtimeMs: -1,
  path: '',
  payload: emptyPayload(),
};

function emptyPayload() {
  return {
    enabled: false,
    id: '',
    title: '站点公告',
    text: '',
  };
}

function resolveConfigPath() {
  const custom = String(process.env.SITE_ANNOUNCEMENT_FILE || '').trim();
  if (!custom) return DEFAULT_PATH;
  return path.isAbsolute(custom) ? custom : path.join(__dirname, custom);
}

function sanitize(raw = {}) {
  const enabled = Boolean(raw.enabled);
  const id = String(raw.id || '').trim().slice(0, 64);
  const title = String(raw.title || '站点公告').trim().slice(0, MAX_TITLE_LENGTH) || '站点公告';
  const text = String(raw.text || '').trim().slice(0, MAX_TEXT_LENGTH);
  return {
    enabled: enabled && Boolean(id) && Boolean(text),
    id: enabled ? id : '',
    title,
    text: enabled ? text : '',
  };
}

function readFromDisk(filePath) {
  try {
    if (!fs.existsSync(filePath)) return emptyPayload();
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return sanitize(raw);
  } catch (err) {
    console.error('site-announcement read error:', err?.message || err);
    return emptyPayload();
  }
}

/** 读取首页公告配置；按文件 mtime 热更新，无需重启服务 */
export function getSiteAnnouncement() {
  const filePath = resolveConfigPath();
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    return emptyPayload();
  }

  if (cached.path === filePath && cached.mtimeMs === mtimeMs) {
    return cached.payload;
  }

  const payload = readFromDisk(filePath);
  cached = { path: filePath, mtimeMs, payload };
  return payload;
}
