/**
 * 区分「息屏/切后台被系统挂起」与「用户从锁屏控件主动暂停」。
 *
 * 切到微博/其它视频 App 时，系统会抢音频焦点并下发 MediaSession pause；
 * 若据此 toggle_play(false)，整房会被停掉，回来后只能刷新重进。
 * 因此：页面 hidden 全程、以及刚回到前台的短窗口内，MediaSession 都不可改房态。
 *
 * audio 元素的 pause 自动续播仍只用「刚进后台」短窗口，避免回前台后与用户点暂停打架。
 */
const SYSTEM_SUSPEND_GRACE_MS = 2000;
/** 回到前台后系统仍可能补发 MediaSession pause，需继续忽略改房态 */
const FOREGROUND_RESUME_GRACE_MS = 2500;

let hiddenAtMs = 0;
let visibleAtMs = 0;
let listenersInstalled = false;

export function installBackgroundPlaybackGuards(): void {
  if (listenersInstalled || typeof document === 'undefined') return;
  listenersInstalled = true;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAtMs = Date.now();
      visibleAtMs = 0;
    } else {
      visibleAtMs = Date.now();
    }
  });
}

/**
 * 页面刚进入后台时的系统挂起窗口（仅 hidden）。
 * 供 audio pause/ended 误触续播使用，不可扩大到前台，否则会对抗用户点暂停。
 */
export function isLikelySystemMediaSuspend(): boolean {
  if (typeof document === 'undefined' || !document.hidden) return false;
  if (!hiddenAtMs) return true;
  return Date.now() - hiddenAtMs < SYSTEM_SUSPEND_GRACE_MS;
}

/**
 * MediaSession pause/stop 是否应忽略（不改房间 isPlaying）。
 * - 整段后台：其它 App 抢焦点无法与锁屏主动暂停区分，保房间继续播
 * - 刚回前台短窗口：系统常补发一次 pause
 */
export function shouldIgnoreBackgroundRoomPause(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.hidden) return true;
  if (visibleAtMs && Date.now() - visibleAtMs < FOREGROUND_RESUME_GRACE_MS) {
    return true;
  }
  return false;
}
