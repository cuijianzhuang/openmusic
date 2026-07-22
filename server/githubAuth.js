import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { getRedisClient, isRedisEnabled } from './roomStorage.js';
import { getRuntimeConfig, isGithubConfigured } from './runtimeConfig.js';

// GitHub OAuth2（房主身份绑定 / 找回，后台登录见 adminApi.js 的绑定部分）。
// GitHub 的授权 / 令牌 / 用户信息接口是公开且长期稳定的固定地址，直接写死；
// 只有 client_id / client_secret / 回调地址需要管理员去
// https://github.com/settings/developers 注册 OAuth App 后自行配置。

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USERINFO_URL = 'https://api.github.com/user';

const STATE_TTL_SEC = 10 * 60;
const BIND_PREFIX = 'openmusic:github:bind:'; // githubId -> userId
const PROFILE_PREFIX = 'openmusic:github:profile:'; // userId -> { githubId, username, avatarUrl, boundAt }

// 未配置 CLIENT_ID_SECRET 时的兜底：必须是进程启动时随机生成、不可预测的值——
// 之前用固定字符串兜底，任何拿到这份开源代码的人都能算出同样的签名，
// 使 state 形同虚设。随机兜底每次重启会变，但只影响「10 分钟内未完成的登录跳转」，
// 不影响已持久化的绑定关系本身。
const FALLBACK_STATE_SECRET = randomBytes(32).toString('hex');

function stateSecret() {
  return String(process.env.CLIENT_ID_SECRET || FALLBACK_STATE_SECRET);
}

export function signGithubState(payload) {
  const body = JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) });
  const encoded = Buffer.from(body, 'utf8').toString('base64url');
  const sig = createHmac('sha256', stateSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyGithubState(token) {
  const raw = String(token || '');
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const encoded = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);

  try {
    const expected = Buffer.from(createHmac('sha256', stateSecret()).update(encoded).digest('base64url'));
    const actual = Buffer.from(sig);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const iat = Number(payload.iat);
    if (!Number.isFinite(iat) || Math.floor(Date.now() / 1000) - iat > STATE_TTL_SEC) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sanitizeGithubReturnPath(path) {
  const value = String(path || '').trim();
  if (!/^\/[a-zA-Z0-9\-._~/%]*$/.test(value)) return '/';
  if (value.startsWith('//')) return '/';
  return value;
}

export { isGithubConfigured };

export function buildGithubAuthorizeUrl(state) {
  const config = getRuntimeConfig();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', config.githubClientId);
  url.searchParams.set('redirect_uri', config.githubRedirectUri);
  url.searchParams.set('scope', config.githubScope || 'read:user');
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');
  return url.toString();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function exchangeGithubCode(code) {
  const config = getRuntimeConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: config.githubRedirectUri,
    client_id: config.githubClientId,
    client_secret: config.githubClientSecret,
  });

  const response = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'OpenMusic',
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`GitHub 令牌接口返回 ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`);
  }
  const data = await response.json();
  const accessToken = String(data?.access_token || '').trim();
  if (!accessToken) throw new Error(data?.error_description || 'GitHub 未返回 access_token');
  return accessToken;
}

export async function fetchGithubProfile(accessToken) {
  const response = await fetchWithTimeout(USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'OpenMusic',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub 用户信息接口返回 ${response.status}`);
  }
  const data = await response.json();
  const id = String(data?.id ?? '').trim();
  if (!id) throw new Error('GitHub 用户信息缺少 id');

  return {
    id,
    username: String(data?.login ?? '').trim(),
    avatarUrl: String(data?.avatar_url ?? '').trim(),
  };
}

export async function bindGithubToUser(githubId, userId, profile) {
  const client = getRedisClient();
  if (!isRedisEnabled() || !client) throw new Error('Redis 不可用，无法保存绑定');

  const existingUserId = await client.get(`${BIND_PREFIX}${githubId}`);
  if (existingUserId && existingUserId !== userId) {
    // 这个 githubId 之前绑定给别的 userId 的旧关联需要先清掉，避免同一 githubId 悬挂多份 profile
    await client.del(`${PROFILE_PREFIX}${existingUserId}`);
  }

  // 这个 userId 之前绑定过别的 githubId 也要一并清掉，否则旧账号仍能找回这个身份
  // （换绑后旧账号继续拥有恢复权限，等于换绑形同虚设）
  const previousProfile = await getGithubProfileForUser(userId);
  if (previousProfile?.githubId && previousProfile.githubId !== githubId) {
    await client.del(`${BIND_PREFIX}${previousProfile.githubId}`);
  }

  const record = {
    githubId,
    username: profile?.username || '',
    avatarUrl: profile?.avatarUrl || '',
    boundAt: Date.now(),
  };
  await client.set(`${BIND_PREFIX}${githubId}`, userId);
  await client.set(`${PROFILE_PREFIX}${userId}`, JSON.stringify(record));
  return record;
}

export async function getUserIdForGithub(githubId) {
  const client = getRedisClient();
  if (!isRedisEnabled() || !client) return null;
  const id = String(githubId || '').trim();
  if (!id) return null;
  const userId = await client.get(`${BIND_PREFIX}${id}`);
  return userId || null;
}

export async function getGithubProfileForUser(userId) {
  const client = getRedisClient();
  if (!isRedisEnabled() || !client) return null;
  const id = String(userId || '').trim();
  if (!id) return null;
  try {
    const raw = await client.get(`${PROFILE_PREFIX}${id}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function unbindGithubForUser(userId) {
  const client = getRedisClient();
  if (!isRedisEnabled() || !client) return false;
  const profile = await getGithubProfileForUser(userId);
  if (profile?.githubId) await client.del(`${BIND_PREFIX}${profile.githubId}`);
  await client.del(`${PROFILE_PREFIX}${userId}`);
  return true;
}
