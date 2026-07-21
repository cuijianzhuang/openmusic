import { fetchWithTimeout } from '../api/http';

export interface GithubBinding {
  githubId: string;
  username: string;
  avatarUrl: string;
  boundAt: number;
}

export interface GithubStatus {
  enabled: boolean;
  bound: GithubBinding | null;
}

/** 当前浏览器身份是否已绑定 GitHub（未配置该功能时 enabled 为 false） */
export async function fetchGithubStatus(): Promise<GithubStatus> {
  try {
    const res = await fetchWithTimeout('/api/auth/github/status', {}, 8000);
    if (!res.ok) return { enabled: false, bound: null };
    const data = await res.json().catch(() => ({}));
    return { enabled: Boolean(data.enabled), bound: data.bound ?? null };
  } catch {
    return { enabled: false, bound: null };
  }
}

/** 跳转到 GitHub 完成绑定（房主专用，需要 roomId 校验房主身份） */
export function startGithubBind(roomId: string, returnPath: string): void {
  const params = new URLSearchParams({ purpose: 'bind', roomId, returnPath });
  window.location.href = `/api/auth/github/start?${params.toString()}`;
}

/** 跳转到 GitHub 完成身份找回（任何人都可发起，只有此前绑定过的账号才能找回成功） */
export function startGithubRecover(returnPath: string): void {
  const params = new URLSearchParams({ purpose: 'recover', returnPath });
  window.location.href = `/api/auth/github/start?${params.toString()}`;
}

export async function unbindGithub(): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout('/api/auth/github/unbind', { method: 'POST' }, 10000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: data.error || '解绑失败' };
    return { success: true };
  } catch {
    return { success: false, error: '网络错误，解绑失败' };
  }
}

const GITHUB_RESULT_MESSAGES: Record<string, { message: string; type: 'success' | 'error' }> = {
  bound: { message: '已绑定 GitHub 账号', type: 'success' },
  recovered: { message: '已通过 GitHub 找回房间身份', type: 'success' },
  notfound: { message: '这个 GitHub 账号还没有绑定过任何身份', type: 'error' },
  expired: { message: '登录已过期或身份已变化，请重试', type: 'error' },
  error: { message: 'GitHub 登录失败，请稍后再试', type: 'error' },
};

/** 从当前地址栏读取 `?github=` 回跳结果并清理该参数，返回要展示的提示（没有则为 null） */
export function consumeGithubReturnParam(): { message: string; type: 'success' | 'error' } | null {
  const url = new URL(window.location.href);
  const result = url.searchParams.get('github');
  if (!result) return null;

  url.searchParams.delete('github');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);

  return GITHUB_RESULT_MESSAGES[result] || null;
}
