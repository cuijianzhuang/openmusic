export const DEFAULT_MAIBOT_TOOLS = [
  'get_room_status',
  'get_my_permissions',
  'search_songs',
  'request_song',
  'recommend_songs',
  'request_skip_song',
  'skip_song',
  'send_sticker',
  'send_emoji',
];

export const DEFAULT_ENABLED_MAIBOT_TOOLS = [
  'get_room_status',
  'get_my_permissions',
  'search_songs',
  'request_song',
  'recommend_songs',
  'request_skip_song',
  'send_sticker',
  'send_emoji',
];

const MAX_TEXT = 200;

export function isMaiBotToolAllowed(tool, allowedTools = []) {
  return DEFAULT_MAIBOT_TOOLS.includes(String(tool || ''))
    && Array.isArray(allowedTools)
    && allowedTools.includes(String(tool || ''));
}

export function normalizeMaiBotToolCall(raw = {}) {
  const rawContext = raw.context && typeof raw.context === 'object' ? raw.context : {};
  const rawArgs = raw.arguments && typeof raw.arguments === 'object' ? raw.arguments : {};
  const tool = String(raw.tool || '').trim();
  const context = {
    roomId: String(rawContext.room_id || '').trim().slice(0, 120),
    userId: String(rawContext.user_id || '').trim().slice(0, 160),
    requestText: String(rawContext.request_text || '').trim().slice(0, MAX_TEXT),
    userNickname: String(rawContext.user_nickname || '').trim().slice(0, 80),
  };
  const args = { ...rawArgs };
  for (const key of ['keyword', 'name', 'artist', 'server', 'id', 'face', 'reason', 'mood']) {
    if (key in args) args[key] = String(args[key] || '').trim().slice(0, MAX_TEXT);
  }
  if ('limit' in args) args.limit = Math.min(5, Math.max(1, Number(args.limit) || 5));
  return { tool, arguments: args, context };
}
