import { create } from 'zustand';
import type { ChatMessage } from '../types';

const WELCOME_MESSAGE_COOLDOWN_MS = 5 * 60 * 1000;

function hasRecentWelcomeForUser(messages: ChatMessage[], targetUserId: string) {
  const now = Date.now();
  return messages.some(
    (message) => message.kind === 'welcome'
      && message.targetUserId === targetUserId
      && now - message.timestamp < WELCOME_MESSAGE_COOLDOWN_MS,
  );
}

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return existing;
  const ids = new Set(existing.map((m) => m.id));
  const merged = [...existing];
  for (const message of incoming) {
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
  updateReactions: (messageId: string, reactions: ChatMessage['reactions']) => void;
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
    const state = get();
    if (state.chatVisibleSince != null && message.timestamp < state.chatVisibleSince) return;
    if (state.messages.some((m) => m.id === message.id)) return;
    if (
      message.kind === 'welcome'
      && message.targetUserId
      && hasRecentWelcomeForUser(state.messages, message.targetUserId)
    ) {
      return;
    }
    set({ messages: [...state.messages, message] });
  },

  prependOlder: (messages, hasMoreOlder) => {
    set((state) => ({
      messages: prependMessages(state.messages, messages),
      hasMoreOlder,
      loadingOlder: false,
    }));
  },

  setLoadingOlder: (loadingOlder) => set({ loadingOlder }),

  updateReactions: (messageId, reactions) => {
    set((state) => ({
      messages: state.messages.map((message) => (
        message.id === messageId ? { ...message, reactions } : message
      )),
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
