import { fetchWithTimeout } from '../api/http';
import { rememberClientId } from './clientId';
import { getDeviceId } from './deviceId';
import { setApiSignKey } from './apiSign';

let bootstrapPromise: Promise<string | null> | null = null;
let chatTextGateKey: string | null = null;

export function getChatTextGateKey(): string | null {
  return chatTextGateKey;
}

export function setChatTextGateKey(key: string | null | undefined): void {
  chatTextGateKey = key?.trim() || null;
}

async function requestSessionBootstrap(): Promise<string | null> {
  const res = await fetchWithTimeout(
    '/api/session/bootstrap',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId() }),
    },
    8000,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    clientId?: string;
    apiSignKey?: string;
    chatTextGateKey?: string;
  };
  // 非安全 HTTP 上 Web Crypto 可能不可用；此时服务端也不会要求请求签名。
  setApiSignKey(globalThis.crypto?.subtle ? data.apiSignKey : null);
  setChatTextGateKey(data.chatTextGateKey);
  if (data.clientId) rememberClientId(data.clientId);
  return data.clientId || null;
}

/** 通过 HttpOnly Cookie 建立会话，不在 WebSocket 中传递身份令牌 */
export function ensureSessionBootstrap(force = false): Promise<string | null> {
  if (force) bootstrapPromise = null;
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const clientId = await requestSessionBootstrap();
          if (clientId) return clientId;
        } catch {
          // retry
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
      }
      return null;
    })();
  }
  return bootstrapPromise;
}

/** bootstrap 必须成功，否则抛出错误 */
export async function requireSessionBootstrap(force = false): Promise<string> {
  let clientId = await ensureSessionBootstrap(force);
  if (!clientId) {
    resetSessionBootstrap();
    clientId = await ensureSessionBootstrap(true);
  }
  if (!clientId) {
    throw new Error('会话未就绪，请刷新页面后重试');
  }
  return clientId;
}

export function resetSessionBootstrap(): void {
  bootstrapPromise = null;
  setApiSignKey(null);
  setChatTextGateKey(null);
}
