import { createHash, createHmac, timingSafeEqual } from 'crypto';

const PASS_TTL_SEC = 90;
const PASS_PREFIX = 'v1';

function sha256Hex(text) {
  return createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

export function deriveChatTextGateKey(clientIdSecret, userId, iat) {
  return createHmac('sha256', clientIdSecret)
    .update(`om-chat-text-gate:${userId}:${iat}`)
    .digest('base64url');
}

function signPayload(key, payload) {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

function safeEqual(a, b) {
  try {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

/**
 * 校验前端敏感词检测通过后签发的密令。
 * 密令格式：`${ts}.${textHash}.${sign}`
 */
export function verifyChatTextGatePass(clientIdSecret, identity, text, pass) {
  const userId = String(identity?.userId || '').trim();
  const iat = Number(identity?.iat);
  const rawPass = String(pass || '').trim();
  const normalizedText = String(text || '');
  if (!userId || !Number.isFinite(iat) || iat <= 0 || !rawPass || !normalizedText) {
    return false;
  }

  const parts = rawPass.split('.');
  if (parts.length !== 3) return false;
  const [tsRaw, textHash, sign] = parts;
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || ts <= 0 || !textHash || !sign) return false;

  const now = Math.floor(Date.now() / 1000);
  if (ts > now + 30) return false;
  if (now - ts > PASS_TTL_SEC) return false;

  const expectedHash = sha256Hex(normalizedText);
  if (!safeEqual(expectedHash, textHash)) return false;

  const key = deriveChatTextGateKey(clientIdSecret, userId, iat);
  const payload = [PASS_PREFIX, userId, textHash, String(ts)].join('\n');
  const expectedSign = signPayload(key, payload);
  return safeEqual(expectedSign, sign);
}
