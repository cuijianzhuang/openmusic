/** 全站封禁命中后冻结前端，避免已打开的页面继续狂刷 API / 重连 */

import { softBlockMessage } from './softBlock';

let blocked = false;
let frozen = false;
let blockCode = '';

export function isSiteAccessBlocked() {
  return blocked;
}

export function getSiteAccessBlockCode() {
  return blockCode;
}

export function markSiteAccessBlocked(code?: string) {
  blocked = true;
  if (code) blockCode = String(code).trim().toUpperCase() || blockCode;
  freezeSiteAccessUi();
}

function freezeSiteAccessUi() {
  if (frozen || typeof document === 'undefined') return;
  frozen = true;
  try {
    document.title = '暂时无法访问';
    const message = softBlockMessage(blockCode || 'OM-SBAN');
    document.body.innerHTML = `
      <div style="margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
        font-family:system-ui,sans-serif;background:#0b0d12;color:#e8eaed;text-align:center;padding:24px;gap:8px">
        <p style="opacity:.75;font-size:15px;margin:0;line-height:1.6;max-width:28em">${message}</p>
      </div>
    `;
  } catch {
    // ignore
  }
}

/** 识别服务端全站封禁响应：必须带明确标记，避免把普通 503 误判成全站封禁 */
export function detectSiteAccessBlockResponse(res: Response | null | undefined): boolean {
  if (!res || res.status !== 503) return false;
  return res.headers.get('x-openmusic-site-blocked') === '1';
}
