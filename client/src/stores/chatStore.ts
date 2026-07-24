import { create } from 'zustand';
import type { ChatMessage } from '../types';
import { useRoomStore } from './roomStore';
import {
  DEFAULT_MEMBER_SETTINGS,
  normalizeWelcomeCooldownSec,
} from '../lib/memberTierPresets';

function getWelcomeCooldownMs(): number {
  const sec = normalizeWelcomeCooldownSec(
    useRoomStore.getState().room?.memberSettings?.welcomeCooldownSec
      ?? DEFAULT_MEMBER_SETTINGS.welcomeCooldownSec,
  );
  return sec * 1000;
}

function hasRecentWelcomeForUser(messages: ChatMessage[], targetUserId: string) {
  const cooldownMs = getWelcomeCooldownMs();
  if (!(cooldownMs > 0)) return false;
  const now = Date.now();
  return messages.some(
    (message) => message.kind === 'welcome'
      && message.targetUserId === targetUserId
      && now - message.timestamp < cooldownMs,
  );
}

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return existing;
  const ids = new Set(existing.map((m) => m.id));
  const merged = [...existing];
  for (const message of incoming) {
    if (message.kind === 'system') continue;
    if (!ids.has(message.id)) {
      merged.push(message);
      ids.add(message.id);
    }
  }
  merged.sort((a, b) => a.timestamp - b.timestamp);
  return merged;
}

function prependMessages(existing: ChatMessage[], older: ChatMessage[]): ChatMessage[] {
  if (older.length === 0) return existing;
  const ids = new Set(existing.map((m) => m.id));
  const merged: ChatMessage[] = [];
  for (const message of older) {
    if (message.kind === 'system') continue;
    if (!ids.has(message.id)) {
      merged.push(message);
      ids.add(message.id);
    }
  }
  merged.push(...existing);
  merged.sort((a, b) => a.timestamp - b.timestamp);
  return merged;
}

interface ChatStore {
  roomId: string | null;
  messages: ChatMessage[];
  chatVisibleSince: number | null;
  hasMoreOlder: boolean;
  loadingOlder: boolean;
  reset: (
    roomId: string,
    messages: ChatMessage[],
    hasMoreOlder: boolean,
    chatVisibleSince?: number | null,
  ) => void;
  append: (message: ChatMessage) => void;
  prependOlder: (messages: ChatMessage[], hasMoreOlder: boolean) => void;
  setLoadingOlder: (loading: boolean) => void;
  /** 房间开启历史可见后，放开本地截断并允许上滑加载 */
  unlockChatHistory: () => void;
  updateReactions: (messageId: string, reactions: ChatMessage['reactions']) => void;
  remove: (messageId: string) => void;
  clear: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  roomId: null,
  messages: [],
  chatVisibleSince: null,
  hasMoreOlder: false,
  loadingOlder: false,

  reset: (roomId, messages, hasMoreOlder, chatVisibleSince = null) => {
    const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
    const deduped: ChatMessage[] = [];
    for (const message of sorted) {
      if (message.kind === 'system') continue;
      if (
        message.kind === 'welcome'
        && message.targetUserId
        && hasRecentWelcomeForUser(deduped, message.targetUserId)
      ) {
        continue;
      }
      deduped.push(message);
    }
    set({
      roomId,
      messages: deduped,
      hasMoreOlder,
      chatVisibleSince,
      loadingOlder: false,
    });
  },

  append: (message) => {
    if (message.kind === 'system') return;
    const state = get();
    if (state.chatVisibleSince != null && message.timestamp < state.chatVisibleSince) return;
    const existingIndex = state.messages.findIndex((m) => m.id === message.id);
    if (existingIndex >= 0) {
      const existing = state.messages[existingIndex];
      // 允许后到的完整图片补全此前占位消息
      if (!existing.imageUrl && message.imageUrl) {
        const next = state.messages.slice();
        next[existingIndex] = { ...existing, ...message };
        set({ messages: next });
      }
      return;
    }
    if (
      message.kind === 'welcome'
      && message.targetUserId
      && hasRecentWelcomeForUser(state.messages, message.targetUserId)
    ) {
      return;
    }
    const nextMessages = [...state.messages, message];
    // 人多刷屏时限制内存与虚拟列表高度计算压力
    const trimmed = nextMessages.length > 400
      ? nextMessages.slice(nextMessages.length - 400)
      : nextMessages;
    set({ messages: trimmed });
  },

  prependOlder: (messages, hasMoreOlder) => {
    set((state) => ({
      messages: prependMessages(state.messages, messages),
      hasMoreOlder,
      loadingOlder: false,
    }));
  },

  setLoadingOlder: (loadingOlder) => set({ loadingOlder }),

  unlockChatHistory: () => {
    set((state) => {
      if (state.chatVisibleSince == null || state.chatVisibleSince <= 0) {
        return state.hasMoreOlder ? {} : { hasMoreOlder: true };
      }
      return {
        chatVisibleSince: null,
        hasMoreOlder: true,
      };
    });
  },

  updateReactions: (messageId, reactions) => {
    set((state) => ({
      messages: state.messages.map((message) => (
        message.id === messageId ? { ...message, reactions } : message
      )),
    }));
  },

  remove: (messageId) => {
    set((state) => ({
      messages: state.messages.filter((message) => message.id !== messageId),
    }));
  },

  clear: () => set({
    roomId: null,
    messages: [],
    chatVisibleSince: null,
    hasMoreOlder: false,
    loadingOlder: false,
  }),
}));

export { mergeMessages };
