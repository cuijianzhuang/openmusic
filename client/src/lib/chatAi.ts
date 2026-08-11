import type { ChatMessage } from '../types';

export const AI_BOT_USER_ID = '__openmusic_ai__';

/** 客户端侧：仅认服务端签名的 bot 消息，防止伪造 userId */
export function isVerifiedAiBotMessage(message: ChatMessage): boolean {
  return message.userId === AI_BOT_USER_ID
    && message.kind === 'ai_bot'
    && Boolean(String(message.aiBotSig || '').trim());
}

/** 降级冒充 bot 的消息为普通聊天 */
export function sanitizeIncomingChatMessage(message: ChatMessage): ChatMessage {
  if (message.userId !== AI_BOT_USER_ID) return message;
  if (isVerifiedAiBotMessage(message)) return message;
  return {
    ...message,
    kind: 'chat',
    aiBotSig: undefined,
  };
}
