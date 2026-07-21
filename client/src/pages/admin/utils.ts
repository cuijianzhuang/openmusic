import type { AdminAuditEntry, AdminRoom } from './types';

export async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error || `请求失败（${res.status}）`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export function formatUptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}天${h}时`;
  if (h > 0) return `${h}时${m}分`;
  return `${m}分`;
}

export function formatAuditTime(at: number) {
  try {
    return new Date(at).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return String(at);
  }
}

export function formatAuditAction(entry: AdminAuditEntry) {
  switch (entry.action) {
    case 'login_ok': {
      if (entry.via === 'linuxdo') return `登录成功（Linux.do：${entry.linuxdoUsername || ''}）`;
      if (entry.via === 'github') return `登录成功（GitHub：${entry.githubUsername || ''}）`;
      return `登录成功${entry.username ? ` ${entry.username}` : ''}`;
    }
    case 'login_fail': {
      if (entry.via === 'linuxdo') return `登录失败（Linux.do：${entry.linuxdoUsername || ''}）`;
      if (entry.via === 'github') return `登录失败（GitHub：${entry.githubUsername || ''}）`;
      return `登录失败${entry.username ? ` ${entry.username}` : ''}`;
    }
    case 'logout':
      return '退出登录';
    case 'linuxdo_bind':
      return `绑定 Linux.do 账号${entry.linuxdoUsername ? `（${entry.linuxdoUsername}）` : ''}`;
    case 'linuxdo_unbind':
      return '解绑 Linux.do 账号';
    case 'github_bind':
      return `绑定 GitHub 账号${entry.githubUsername ? `（${entry.githubUsername}）` : ''}`;
    case 'github_unbind':
      return '解绑 GitHub 账号';
    case 'set_credentials':
      return `修改管理员账号密码${entry.username ? `（${entry.username}）` : ''}`;
    case 'set_entry_path':
      return `更新登录地址 ${entry.path || ''}`;
    case 'set_runtime_config':
      return '更新运行配置';
    case 'set_announcement':
      return `更新站点公告（${entry.enabled ? '启用' : '停用'}）`;
    case 'set_room_protection':
      return `${entry.enabled ? '开启' : '关闭'}房间保活 ${entry.roomId || ''}`;
    case 'meting_reset_cooldown':
      return `重置上游冷却 ${entry.url || ''}`;
    case 'meting_set_disabled':
      return `${entry.disabled ? '禁用' : '启用'}上游 ${entry.url || ''}`;
    case 'broadcast':
      return `全局广播（${entry.roomCount ?? 0} 个房间）`;
    case 'site_ban_add':
      return `封禁 ${entry.banType || ''} ${entry.value || ''}${typeof entry.kicked === 'number' ? ` · 踢出 ${entry.kicked}` : ''}`;
    case 'site_ban_remove':
      return `解除封禁 ${entry.banId || ''}`;
    case 'error_report_update':
      return `处理错误上报 ${entry.reportId || ''}${entry.status ? ` → ${entry.status}` : ''}`;
    case 'error_report_delete':
      return `删除错误上报 ${entry.reportId || ''}`;
    case 'destroy_room':
      return `解散房间 ${entry.roomId || ''}${entry.name ? `（${entry.name}）` : ''}${
        typeof entry.kicked === 'number' ? ` · 踢出 ${entry.kicked}` : ''
      }`;
    case 'destroy_room_fail':
      return `解散失败 ${entry.roomId || ''}${entry.error ? `：${entry.error}` : ''}`;
    default:
      return entry.action;
  }
}

/** 与服务端 createRandomAdminEntryPath 一致：12 字节 base64url */
export function createRandomEntryPath() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `/${b64}`;
}

export type AdminRoomStatusFilter =
  | 'playing'
  | 'paused'
  | 'idle'
  | 'password'
  | 'locked'
  | 'protected'
  | 'empty';

export const ADMIN_ROOM_STATUS_FILTERS: { value: AdminRoomStatusFilter; label: string }[] = [
  { value: 'playing', label: '播放中' },
  { value: 'paused', label: '已暂停' },
  { value: 'idle', label: '未播放' },
  { value: 'password', label: '有密码' },
  { value: 'locked', label: '已上锁' },
  { value: 'protected', label: '保活' },
  { value: 'empty', label: '空房间' },
];

function roomMatchesStatusFilter(room: AdminRoom, tag: AdminRoomStatusFilter): boolean {
  switch (tag) {
    case 'playing':
      return room.isPlaying;
    case 'paused':
      return Boolean(room.currentSong) && !room.isPlaying;
    case 'idle':
      return !room.currentSong;
    case 'password':
      return room.hasPassword;
    case 'locked':
      return room.isLocked;
    case 'protected':
      return room.protectedFromDestroy;
    case 'empty':
      return room.userCount === 0;
    default:
      return true;
  }
}

function roomMatchesKeyword(room: AdminRoom, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return true;
  if (room.id.toLowerCase().includes(kw)) return true;
  if (room.name.toLowerCase().includes(kw)) return true;
  if (room.currentSong?.name.toLowerCase().includes(kw)) return true;
  if (room.currentSong?.artist.toLowerCase().includes(kw)) return true;
  return room.users.some((user) => (
    user.nickname.toLowerCase().includes(kw)
    || user.clientIp?.toLowerCase().includes(kw)
    || user.deviceId?.toLowerCase().includes(kw)
  ));
}

/** 播放态优先：播放中 → 已暂停 → 有人未播 → 空房；同组按人数、创建时间 */
function roomActivityRank(room: AdminRoom): number {
  if (room.isPlaying) return 0;
  if (room.currentSong) return 1;
  if (room.userCount > 0) return 2;
  return 3;
}

function compareAdminRooms(a: AdminRoom, b: AdminRoom): number {
  const rankDiff = roomActivityRank(a) - roomActivityRank(b);
  if (rankDiff !== 0) return rankDiff;
  if (a.userCount !== b.userCount) return b.userCount - a.userCount;
  return b.createdAt - a.createdAt;
}

export function filterAdminRooms(
  rooms: AdminRoom[],
  keyword: string,
  statusFilters: AdminRoomStatusFilter[],
): AdminRoom[] {
  return rooms
    .filter((room) => {
      if (!roomMatchesKeyword(room, keyword)) return false;
      if (statusFilters.length === 0) return true;
      return statusFilters.some((tag) => roomMatchesStatusFilter(room, tag));
    })
    .sort(compareAdminRooms);
}
