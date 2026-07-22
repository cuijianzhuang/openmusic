import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { getRedisClient, isRedisEnabled } from './roomStorage.js';
import { getRuntimeConfig, isLinuxdoConfigured } from './runtimeConfig.js';

// Linux.do OAuth2（房主身份绑定 / 找回，后台登录见 adminApi.js 的绑定部分）。
// 具体授权 / 令牌 / 用户信息接口地址由运行时配置提供（LINUXDO_* 环境变量），
// 本模块不写死任何 linux.do 的真实接口地址，需要管理员在拿到 OAuth 应用后自行核实填写。

const STATE_TTL_SEC = 10 * 60; // 授权跳转全程 10 分钟内完成，防止 state 被长期重放
const BIND_PREFIX = 'openmusic:linuxdo:bind:'; // linuxdoId -> userId
const PROFILE_PREFIX = 'openmusic:linuxdo:profile:'; // userId -> { linuxdoId, username, avatarUrl, boundAt }

// 未配置 CLIENT_ID_SECRET 时的兜底：必须是进程启动时随机生成、不可预测的值——
// 之前用固定字符串兜底，任何拿到这份开源代码的人都能算出同样的签名，
// 使 state 形同虚设。随机兜底每次重启会变，但只影响「10 分钟内未完成的登录跳转」，
// 不影响已持久化的绑定关系本身。
const FALLBACK_STATE_SECRET = randomBytes(32).toString('hex');

function stateSecret() {
  return String(process.env.CLIENT_ID_SECRET || FALLBACK_STATE_SECRET);
}

/**
 * 无状态签名 state，避免额外的服务端会话存储。
 * @param {{ purpose: string, userId?: string, returnPath?: string }} payload
 */
export function signLinuxdoState(payload) {
  const body = JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) });
  const encoded = Buffer.from(body, 'utf8').toString('base64url');
  const sig = createHmac('sha256', stateSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyLinuxdoState(token) {
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

/** 仅允许跳回站内相对路径，避免 state 被用来做开放重定向 */
export function sanitizeReturnPath(path) {
  const value = String(path || '').trim();
  if (!/^\/[a-zA-Z0-9\-._~/%]*$/.test(value)) return '/';
  if (value.startsWith('//')) return '/'; // 防止 //evil.com 这类协议相对 URL
  return value;
}

export { isLinuxdoConfigured };

export function buildLinuxdoAuthorizeUrl(state) {
  const config = getRuntimeConfig();
  const url = new URL(config.linuxdoAuthorizeUrl);
  url.searchParams.set('client_id', config.linuxdoClientId);
  url.searchParams.set('redirect_uri', config.linuxdoRedirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.linuxdoScope || 'user');
  url.searchParams.set('state', state);
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

/** 用授权码换取 access_token（标准 OAuth2 Authorization Code 流程） */
export async function exchangeLinuxdoCode(code) {
  const config = getRuntimeConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: config.linuxdoRedirectUri,
    client_id: config.linuxdoClientId,
    client_secret: config.linuxdoClientSecret,
  });

  const response = await fetchWithTimeout(config.linuxdoTokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Linux.do 令牌接口返回 ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`);
  }
  const data = await response.json();
  const accessToken = String(data?.access_token || '').trim();
  if (!accessToken) throw new Error('Linux.do 未返回 access_token');
  return accessToken;
}

/**
 * 获取用户信息；字段名未经真实接口验证前做了常见形态的兼容读取
 * （标准 OAuth2 常见 id/sub，Discourse 系常见 username/avatar_template）。
 * 拿到真实响应后如字段不一致，只需要调整这一处。
 */
export async function fetchLinuxdoProfile(accessToken) {
  const config = getRuntimeConfig();
  const response = await fetchWithTimeout(config.linuxdoUserInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Linux.do 用户信息接口返回 ${response.status}`);
  }
  const data = await response.json();
  const id = String(data?.id ?? data?.sub ?? data?.user_id ?? '').trim();
  if (!id) throw new Error('Linux.do 用户信息缺少 id');

  const username = String(data?.username ?? data?.login ?? data?.name ?? '').trim();
  let avatarUrl = String(data?.avatar_url ?? '').trim();
  const avatarTemplate = String(data?.avatar_template ?? '').trim();
  if (!avatarUrl && avatarTemplate) {
    avatarUrl = avatarTemplate.includes('{size}') ? avatarTemplate.replace('{size}', '96') : avatarTemplate;
  }

  return { id, username, avatarUrl };
}

export async function bindLinuxdoToUser(linuxdoId, userId, profile) {
  const client = getRedisClient();
  if (!isRedisEnabled() || !client) throw new Error('Redis 不可用，无法保存绑定');

  const existingUserId = await client.get(`${BIND_PREFIX}${linuxdoId}`);
  if (existingUserId && existingUserId !== userId) {
    // 这个 linuxdoId 之前绑定给别的 userId 的旧关联需要先清掉，避免同一 linuxdoId 悬挂多份 profile
    await client.del(`${PROFILE_PREFIX}${existingUserId}`);
  }

  // 这个 userId 之前绑定过别的 linuxdoId 也要一并清掉，否则旧账号仍能找回这个身份
  // （换绑后旧账号继续拥有恢复权限，等于换绑形同虚设）
  const previousProfile = await getLinuxdoProfileForUser(userId);
  if (previousProfile?.linuxdoId && previousProfile.linuxdoId !== linuxdoId) {
    await client.del(`${BIND_PREFIX}${previousProfile.linuxdoId}`);
  }

  const record = {
    linuxdoId,
    username: profile?.username || '',
    avatarUrl: profile?.avatarUrl || '',
    boundAt: Date.now(),
  };
  await client.set(`${BIND_PREFIX}${linuxdoId}`, userId);
  await client.set(`${PROFILE_PREFIX}${userId}`, JSON.stringify(record));
  return record;
}

export async function getUserIdForLinuxdo(linuxdoId) {
  const client = getRedisClient();
  if (!isRedisEnabled() || !client) return null;
  const id = String(linuxdoId || '').trim();
  if (!id) return null;
  const userId = await client.get(`${BIND_PREFIX}${id}`);
  return userId || null;
}

export async function getLinuxdoProfileForUser(userId) {
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

export async function unbindLinuxdoForUser(userId) {
  const client = getRedisClient();
  if (!isRedisEnabled() || !client) return false;
  const profile = await getLinuxdoProfileForUser(userId);
  if (profile?.linuxdoId) await client.del(`${BIND_PREFIX}${profile.linuxdoId}`);
  await client.del(`${PROFILE_PREFIX}${userId}`);
  return true;
}
