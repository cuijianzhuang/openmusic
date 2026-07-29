/**
 * 调用 Meting-API 管理接口（扫码登录 / VIP Cookie 绑定 / 一次性漫游）。
 *
 * VIP 不共享：写入 Meting，仅该房间搜索/播放。
 * VIP 共享：加入 Meting Cookie 池（等同后台新增 Cookie），全站可用。
 * 无 VIP：不上传 Meting，Cookie 仅存 OpenMusic 房间，只用于网易漫游。
 *
 * 鉴权：Authorization: Bearer <metingApiAuth>（需与 Meting「API Token」一致）
 */
import { fetchMeting, formatMetingFetchError } from './metingFetch.js';
import { getMetingUpstreamBases } from './metingUpstream.js';
import { getRuntimeConfig } from './runtimeConfig.js';

function getAdminAuth() {
  const config = getRuntimeConfig();
  const raw = String(config.metingApiAuth || '')
    .split(',')
    .map((s) => s.trim())
    .find(Boolean);
  return raw || '';
}

function getAdminBase() {
  const bases = getMetingUpstreamBases();
  return bases[0] || '';
}

async function metingAdminFetch(path, { method = 'GET', body, timeoutMs = 20000 } = {}) {
  const base = getAdminBase();
  const auth = getAdminAuth();
  if (!base) {
    return { ok: false, error: '未配置 METING_API_URL' };
  }
  if (!auth) {
    return {
      ok: false,
      error: '未配置 Meting API Token：请在管理后台填写与 Meting「API Token」一致的令牌',
    };
  }

  const url = `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const response = await fetchMeting(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${auth}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      timeoutMs,
    );
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      return {
        ok: false,
        error: data?.error || `Meting 管理接口返回 ${response.status}`,
        status: response.status,
        code: data?.code,
        data,
      };
    }
    if (data && data.success === false) {
      return { ok: false, error: data.error || '操作失败', code: data.code, data };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: formatMetingFetchError(err) };
  }
}

function userInfoHasVip(userInfo) {
  if (!userInfo || typeof userInfo !== 'object') return false;
  if (userInfo.canPlayVip === true) return true;
  if (userInfo.canPlayVip === false) return false;
  return Boolean(
    userInfo.isVip ||
    (Number(userInfo.vipType) || 0) > 0,
  );
}

export function toPublicMusicAccount(cookie, extras = {}) {
  if (!cookie || typeof cookie !== 'object') return null;
  const info = cookie.userInfo || {};
  const hasVip = Boolean(
    extras.hasVip ?? cookie.hasVip ?? userInfoHasVip(info),
  );
  return {
    cookieId: String(cookie.id || cookie.cookieId || extras.cookieId || ''),
    platform: cookie.platform === 'tencent' ? 'tencent' : 'netease',
    shared: hasVip ? Boolean(cookie.shared) : false,
    hasVip,
    /** vip=搜索/播放；fm=仅网易漫游（不入 Meting） */
    usage: hasVip ? 'vip' : 'fm',
    nickname: String(info.nickname || cookie.nickname || cookie.note || ''),
    avatarUrl: String(info.avatarUrl || cookie.avatarUrl || ''),
    userId: info.userId != null ? String(info.userId) : String(cookie.userId || ''),
    isValid: cookie.isValid !== false,
    updatedAt: Number(cookie.updatedAt) || Date.now(),
  };
}

export async function createMusicQrSession(platform) {
  const result = await metingAdminFetch('/admin/qr/create', {
    method: 'POST',
    body: { platform: platform === 'tencent' ? 'tencent' : 'netease' },
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data?.data || result.data };
}

export async function checkMusicQrSession(payload) {
  const platform = payload?.platform === 'tencent' ? 'tencent' : 'netease';
  const body =
    platform === 'tencent'
      ? {
          platform,
          qrsig: payload.qrsig || payload.key,
          ptqrtoken: payload.ptqrtoken,
        }
      : { platform, key: payload.key };
  // QQ 授权换 Cookie 可能较慢，单独加长超时
  const result = await metingAdminFetch('/admin/qr/check', {
    method: 'POST',
    body,
    timeoutMs: 45000,
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data?.data || result.data };
}

export async function validateMusicCookie(platform, cookie) {
  const result = await metingAdminFetch('/admin/cookies/validate', {
    method: 'POST',
    body: {
      platform: platform === 'tencent' ? 'tencent' : 'netease',
      cookie,
    },
  });
  if (!result.ok) return result;
  const payload = result.data?.data || result.data;
  return {
    ok: true,
    data: {
      valid: Boolean(payload?.valid),
      error: payload?.error || '',
      userInfo: payload?.userInfo || null,
      hasVip: userInfoHasVip(payload?.userInfo),
    },
  };
}

/**
 * 扫码成功后绑定：
 * - VIP 共享 → 加入 Meting Cookie 池（全站可用）
 * - VIP 不共享 → 写入 Meting，仅本房间
 * - 无 VIP 网易 → 不上传 Meting，由调用方本地存 Cookie，仅漫游
 * - 无 VIP QQ → 拒绝（无漫游用途）
 */
export async function bindRoomMusicAccount({ roomId, platform, cookie, shared, note }) {
  const plat = platform === 'tencent' ? 'tencent' : 'netease';
  const validation = await validateMusicCookie(plat, cookie);
  if (!validation.ok) return validation;
  if (!validation.data.valid) {
    return { ok: false, error: validation.data.error || '账号验证失败' };
  }

  const hasVip = validation.data.hasVip;
  const userInfo = validation.data.userInfo;

  if (!hasVip) {
    if (plat === 'tencent') {
      return {
        ok: false,
        error: '账号无vip权限，要不先去开个会员？嘻嘻~',
      };
    }
    // 无 VIP 网易：不上传 Meting
    return {
      ok: true,
      localOnly: true,
      cookie,
      data: toPublicMusicAccount(
        {
          id: `local-${String(roomId || '').toUpperCase()}-netease`,
          platform: 'netease',
          shared: false,
          userInfo,
          isValid: true,
          updatedAt: Date.now(),
        },
        { hasVip: false },
      ),
      message: '账号无vip权限，仅作用在漫游',
    };
  }

  const result = await metingAdminFetch('/admin/qr/bind', {
    method: 'POST',
    body: {
      roomId: String(roomId || '').trim().toUpperCase(),
      platform: plat,
      cookie,
      shared: Boolean(shared),
      note: note || `房间 ${String(roomId || '').trim().toUpperCase()}`,
    },
  });
  if (!result.ok) return result;
  return {
    ok: true,
    localOnly: false,
    data: toPublicMusicAccount(result.data?.data, { hasVip: true }),
    message: result.data?.message || (shared ? '已共享到全站' : '已绑定仅本房间'),
  };
}

/** 一次性漫游：Cookie 不入库 */
export async function fetchEphemeralFmSong(cookie, mode = '') {
  const result = await metingAdminFetch('/admin/fm', {
    method: 'POST',
    body: { cookie, mode },
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data?.data ?? result.data };
}

export async function fetchRoomMusicAccounts(roomId) {
  const id = String(roomId || '').trim().toUpperCase();
  if (!id) return { ok: false, error: '缺少房间 ID' };
  const result = await metingAdminFetch(`/admin/room-cookies/${encodeURIComponent(id)}`);
  if (!result.ok) return result;
  const raw = result.data?.data || {};
  return {
    ok: true,
    data: {
      netease: toPublicMusicAccount(raw.netease, { hasVip: true }),
      tencent: toPublicMusicAccount(raw.tencent, { hasVip: true }),
    },
  };
}

export async function setRoomMusicAccountShared(roomId, platform, shared) {
  const id = String(roomId || '').trim().toUpperCase();
  const plat = platform === 'tencent' ? 'tencent' : 'netease';
  const result = await metingAdminFetch(
    `/admin/room-cookies/${encodeURIComponent(id)}/${plat}/share`,
    { method: 'PUT', body: { shared: Boolean(shared) } },
  );
  if (!result.ok) return result;
  return { ok: true, data: toPublicMusicAccount(result.data?.data, { hasVip: true }) };
}

export async function unbindRoomMusicAccount(roomId, platform) {
  const id = String(roomId || '').trim().toUpperCase();
  const plat = platform === 'tencent' ? 'tencent' : 'netease';
  const result = await metingAdminFetch(
    `/admin/room-cookies/${encodeURIComponent(id)}/${plat}`,
    { method: 'DELETE' },
  );
  // 404 也视为已解绑（可能是仅本地无 VIP 账号）
  if (!result.ok && result.status !== 404) return result;
  return { ok: true };
}
