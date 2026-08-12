/**
 * 房间聊天 AI Agent：触发后调用硅基流动 Function Calling，执行点歌/切歌/表情等工具。
 */
import { fetchMetingApi, runWithMetingRequestContext } from './metingUpstream.js';
import { searchApihzStickers, isApihzStickerConfigured } from './apihzSticker.js';
import {
  addToQueue,
  skipSongOnBehalfOfUser,
  requestSkipOnBehalfOfUser,
  assertAiCanRequestSong,
  getAiActorPermissions,
  postBotChatMessage,
  getRoomAiSnapshot,
  getRoomInternal,
} from './roomManager.js';
import {
  AI_BOT_USER_ID,
  AI_FORBIDDEN_ROOM_TOOL_NAMES,
  buildOpenMusicAiSystemPrompt,
  buildRoomAiTools,
  describeImageWithVision,
  detectAiUserMisconduct,
  extractAssistantText,
  getPublicRoomAiConfig,
  getAiModelConfig,
  getAiRequestConcurrencyLimit,
  getTimeOfDayContext,
  isRoomAiEnabledForRoom,
  isAiModelEnabled,
  resolveQqFaceToken,
  shouldTriggerRoomAi,
  stripAiTriggerPrefix,
  aiChatCompletions,
} from './aiModelService.js';
import { appendRoomAiTurn, getRoomAiContextMessages } from './roomAiContext.js';
import {
  extractUserChatSignals,
  getAiUserRapport,
  getAiUserProfile,
  forgiveAiUserAfterApology,
  isAiUserIgnored,
  recordAiUserInteraction,
  recordAiSongRequest,
  recordAiUserViolation,
} from './roomAiUserState.js';

const MAX_TOOL_ROUNDS = 4;
const AI_MAX_ATTEMPTS = 3;
const MUTATING_TOOL_NAMES = new Set([
  'request_song',
  'skip_song',
  'request_skip_song',
  'send_emoji',
  'send_sticker',
  'reply_message',
]);
const INTENT_GATED_TOOL_NAMES = new Set([
  'request_song',
  'skip_song',
  'request_skip_song',
  'send_emoji',
  'send_sticker',
]);
const aiQueue = [];
const aiActiveTasks = new Map();

function getRoomAiTaskWeight(room) {
  const onlineCount = Math.max(0, Number(room?.users?.size) || 0);
  const active = onlineCount > 0 && Boolean(room?.isPlaying);
  return { active, onlineCount };
}

function getRoomActiveTaskCount(roomId) {
  let count = 0;
  for (const task of aiActiveTasks.values()) {
    if (task.roomId === roomId) count += 1;
  }
  return count;
}

function getDynamicRoomTaskLimit(roomId) {
  const room = getRoomInternal(roomId);
  const roomIds = new Set([
    ...aiQueue.map((task) => task.roomId),
    ...Array.from(aiActiveTasks.values(), (task) => task.roomId),
  ]);
  const activeRooms = Array.from(roomIds)
    .map((id) => ({ id, weight: getRoomAiTaskWeight(getRoomInternal(id)) }))
    .filter(({ weight }) => weight.active);
  const currentWeight = getRoomAiTaskWeight(room);
  if (!currentWeight.active || activeRooms.length === 0) return 1;
  const totalOnline = activeRooms.reduce((sum, item) => sum + item.weight.onlineCount, 0);
  const weightedLimit = Math.ceil((getAiRequestConcurrencyLimit() * currentWeight.onlineCount) / Math.max(1, totalOnline));
  return Math.max(1, weightedLimit);
}

function compareAiTasks(a, b) {
  const aWeight = getRoomAiTaskWeight(getRoomInternal(a.roomId));
  const bWeight = getRoomAiTaskWeight(getRoomInternal(b.roomId));
  if (aWeight.active !== bWeight.active) return aWeight.active ? -1 : 1;
  if (aWeight.onlineCount !== bWeight.onlineCount) return bWeight.onlineCount - aWeight.onlineCount;
  return a.queuedAt - b.queuedAt;
}

function emitQueuedStatuses() {
  const byRoom = new Map();
  for (const task of aiQueue.slice().sort(compareAiTasks)) {
    const list = byRoom.get(task.roomId) || [];
    list.push(task);
    byRoom.set(task.roomId, list);
  }
  for (const [roomId, tasks] of byRoom) {
    const pendingCount = tasks.length + getRoomActiveTaskCount(roomId);
    tasks.forEach((task, index) => task.onStatus?.({
      status: 'queued',
      queuePosition: index + 1,
      pendingCount,
      attempt: task.attempt,
      maxAttempts: AI_MAX_ATTEMPTS,
    }));
  }
}

function pumpAiQueue() {
  const globalLimit = getAiRequestConcurrencyLimit();
  if (aiActiveTasks.size >= globalLimit || aiQueue.length === 0) {
    emitQueuedStatuses();
    return;
  }
  aiQueue.sort(compareAiTasks);
  let index = aiQueue.findIndex((task) => (
    getRoomActiveTaskCount(task.roomId) < getDynamicRoomTaskLimit(task.roomId)
  ));
  if (index < 0) {
    index = aiQueue.findIndex((task) => getRoomActiveTaskCount(task.roomId) < globalLimit);
  }
  if (index < 0) {
    emitQueuedStatuses();
    return;
  }

  const [task] = aiQueue.splice(index, 1);
  aiActiveTasks.set(task.requestId, task);
  task.onStatus?.({
    status: 'start',
    queuePosition: 0,
    pendingCount: aiQueue.filter((item) => item.roomId === task.roomId).length + getRoomActiveTaskCount(task.roomId),
    attempt: task.attempt,
    maxAttempts: AI_MAX_ATTEMPTS,
  });
  void handleRoomAiChat({ ...task.params, executionLedger: task.executionLedger })
    .then((result) => {
      if (result?.error) throw new Error(result.error);
      aiActiveTasks.delete(task.requestId);
      task.onStatus?.({ status: 'end', queuePosition: 0, pendingCount: 0 });
      pumpAiQueue();
    })
    .catch((err) => {
      aiActiveTasks.delete(task.requestId);
      if (task.attempt + 1 < AI_MAX_ATTEMPTS) {
        aiQueue.push({ ...task, attempt: task.attempt + 1, queuedAt: Date.now() });
      } else {
        task.onStatus?.({
          status: 'error',
          queuePosition: 0,
          pendingCount: 0,
          attempt: task.attempt + 1,
          maxAttempts: AI_MAX_ATTEMPTS,
          error: String(err?.message || 'AI 调用失败').slice(0, 80),
        });
      }
      pumpAiQueue();
    });
  pumpAiQueue();
}

export function enqueueRoomAiChat(params = {}, onStatus) {
  const roomId = String(params.roomId || '').trim();
  const requestId = String(params.requestId || '').trim();
  if (!roomId || !requestId) return { queued: false };
  aiQueue.push({
    roomId,
    requestId,
    params,
    onStatus,
    queuedAt: Date.now(),
    attempt: 0,
    executionLedger: new Map(),
  });
  pumpAiQueue();
  return { queued: true };
}

function safeJsonParse(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeSongFromMeting(raw, server = 'netease') {
  if (!raw || typeof raw !== 'object') return null;
  const source = String(raw.source || server || 'netease').trim() || 'netease';
  const url = String(raw.url || '').trim();
  const urlId = (() => {
    try {
      const parsed = new URL(url);
      return String(parsed.searchParams.get('id') || '').trim();
    } catch {
      return '';
    }
  })();
  const rawId = String(raw.id || raw.songid || '').trim();
  const name = String(raw.name || raw.title || '').trim();
  const id = source === 'netease' && /^\d+$/.test(urlId)
    ? urlId
    : rawId || urlId;
  if (!id || !name || id === name) return null;
  if (source === 'netease' && !/^\d+$/.test(id)) return null;
  return {
    id,
    name: name || '未知歌曲',
    artist: String(raw.artist || raw.author || raw.singer || '未知').trim() || '未知',
    pic: String(raw.pic || raw.picture || raw.cover || '').trim(),
    url,
    lrc: String(raw.lrc || raw.lyric || '').trim(),
    source,
  };
}

async function searchSongsInternal(keyword, server = 'netease', limit = 5) {
  const q = String(keyword || '').trim().slice(0, 64);
  if (!q) return { success: false, error: '关键词为空' };
  const src = ['netease', 'tencent', 'qishui'].includes(server) ? server : 'netease';
  const safeLimit = Math.max(1, Math.min(8, Number(limit) || 5));

  try {
    const response = await runWithMetingRequestContext(
      { userId: AI_BOT_USER_ID, userNickname: 'AI', roomId: '', roomName: 'ai-search' },
      () => fetchMetingApi({ server: src, type: 'search', id: q }, {}, 12000),
    );
    if (!response.ok) {
      return { success: false, error: `搜索失败 HTTP ${response.status}` };
    }
    const data = await response.json();
    const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    const songs = list
      .map((item) => normalizeSongFromMeting(item, src))
      .filter(Boolean)
      .slice(0, safeLimit)
      .map((song, index) => ({
        index: index + 1,
        id: song.id,
        name: song.name,
        artist: song.artist,
        pic: song.pic,
        server: song.source,
      }));
    return { success: true, keyword: q, server: src, songs };
  } catch (err) {
    return { success: false, error: err?.message || '搜索失败' };
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

const ALLOWED_INTENT_OPERATIONS = new Set([
  'chat', 'search_songs', 'recommend_songs', 'request_song', 'skip_song',
  'request_skip_song', 'send_emoji', 'send_sticker', 'unknown',
]);

export function parseRoomAiIntentAnalysis(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = safeJsonParse(text, null);
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, operation: 'unknown', explicitAction: false, requiresConfirmation: true, confidence: 0 };
  }
  const operation = ALLOWED_INTENT_OPERATIONS.has(parsed.operation) ? parsed.operation : 'unknown';
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
  return {
    valid: operation !== 'unknown',
    operation,
    explicitAction: parsed.explicitAction === true,
    requiresConfirmation: parsed.requiresConfirmation !== false,
    confidence,
    entities: parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {},
    ambiguities: Array.isArray(parsed.ambiguities) ? parsed.ambiguities.slice(0, 8) : [],
  };
}

export function canExecuteIntentGatedTool(intent, toolName) {
  if (!INTENT_GATED_TOOL_NAMES.has(toolName)) return true;
  if (!intent?.valid || !intent.explicitAction || intent.requiresConfirmation || intent.confidence < 0.75) return false;
  if (toolName === 'request_song') return intent.operation === 'request_song';
  if (toolName === 'skip_song') return intent.operation === 'skip_song';
  if (toolName === 'request_skip_song') return intent.operation === 'request_skip_song';
  return intent.operation === toolName;
}

export function sanitizeAiUserFacingText(value) {
  return String(value || '')
    .replace(/(?:用\s*)?`?request_song`?\s*点上/gi, '让我帮你点上')
    .replace(/`?(?:request_song|search_songs|recommend_songs|skip_song|request_skip_song|reply_message|send_emoji|send_sticker|get_room_status|get_my_permissions)`?/gi, (name) => ({
      request_song: '点歌',
      search_songs: '搜歌',
      recommend_songs: '歌曲推荐',
      skip_song: '切歌',
      request_skip_song: '切歌申请',
      reply_message: '回复功能',
      send_emoji: '表情功能',
      send_sticker: '表情包功能',
      get_room_status: '房间状态',
      get_my_permissions: '权限信息',
    })[String(name).replace(/`/g, '').toLowerCase()] || '')
    .replace(/用\s*点歌\s*点上/g, '让我帮你点上')
    .replace(/你可以把喜欢的歌让我帮你点上/g, '喜欢哪首直接告诉我，我来帮你点上');
}

function normalizeSongMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\-_/\\.,，。()（）【】\[\]]+/g, '');
}

export function pickRequestedSong(candidates, requested = {}) {
  const requestedId = String(requested.id || '').trim();
  const requestedName = normalizeSongMatchText(requested.name);
  const requestedArtist = normalizeSongMatchText(requested.artist);
  if (requestedId) {
    const exact = candidates.find((song) => String(song.id) === requestedId);
    if (exact) return exact;
  }

  let best = null;
  let bestScore = 0;
  for (const song of candidates) {
    const songName = normalizeSongMatchText(song.name);
    const songArtist = normalizeSongMatchText(song.artist);
    const nameThenArtist = `${songName}${songArtist}`;
    const artistThenName = `${songArtist}${songName}`;
    let score = 0;

    if (requestedName && (nameThenArtist === requestedName || artistThenName === requestedName)) {
      score = 100;
    } else if (requestedName && songName === requestedName) {
      score = 80;
    } else if (requestedName && (nameThenArtist.includes(requestedName) || artistThenName.includes(requestedName))) {
      score = 60;
    }

    if (requestedArtist && songName === requestedName
      && (songArtist === requestedArtist || songArtist.includes(requestedArtist) || requestedArtist.includes(songArtist))) {
      score = Math.max(score, 120);
    }
    if (score > bestScore) {
      best = song;
      bestScore = score;
    }
  }
  return bestScore >= (requestedArtist ? 120 : 80) ? best : null;
}

function getReplyMessageContext(room, replyTo) {
  if (!replyTo || typeof replyTo !== 'object') return null;
  const replyId = String(replyTo.id || '').trim();
  const source = replyId
    ? room?.messages?.find((message) => String(message?.id || '') === replyId)
    : null;
  const text = String(source?.text || replyTo.text || '').trim();
  const imageUrl = String(source?.imageUrl || replyTo.imageUrl || '').trim();
  const asSticker = Boolean(source?.asSticker || replyTo.asSticker);
  return {
    nickname: String(source?.nickname || replyTo.nickname || '用户').trim() || '用户',
    text,
    imageUrl,
    asSticker,
  };
}

function isSongQueuedOrPlaying(room, song) {
  const targetId = String(song?.id || '').trim();
  const targetSource = String(song?.source || '').trim();
  if (!targetId) return false;
  const items = [room?.current, ...(Array.isArray(room?.queue) ? room.queue : [])];
  return items.some((item) => String(item?.id || '').trim() === targetId
    && (!targetSource || !item?.source || String(item.source) === targetSource));
}

async function analyzeRoomAiIntent({ cfg, roomId, botName, userPrompt, history, permissions, userNickname }) {
  const completion = await aiChatCompletions({
    roomId,
    taskType: 'text',
    messages: [
      {
        role: 'system',
        content: [
          `你是听歌房助手「${botName}」的意图分析层。`,
          '你只分析用户的真实意图，绝不回复用户、绝不调用工具、绝不声称操作已完成。',
          '结合对话历史、引用内容、识图结果和用户当前说法，识别用户想做什么、歌曲/歌手/平台/数量等约束，以及是否存在歧义。',
          '若识图失败或信息不够，明确写出缺失信息；不要把错误文案、占位词或推测当作歌曲信息。',
          '只输出 JSON：{"operation":"chat|search_songs|recommend_songs|request_song|skip_song|request_skip_song|send_emoji|send_sticker|unknown","explicitAction":true,"requiresConfirmation":false,"confidence":0.0,"entities":{"songs":[],"artists":[],"platform":null},"ambiguities":[]}。',
          '只有用户明确要求执行某项操作且信息充分时 explicitAction 才能为 true；歌曲/版本/数量不明确、用户仅提及歌曲或只是要推荐时 requiresConfirmation 必须为 true。',
          '用户明确说“推荐一首并点上”时 operation 为 request_song；推荐多首或未指定数量时 operation 为 recommend_songs 且 requiresConfirmation 为 true。',
        ].join('\n'),
      },
      ...history,
      {
        role: 'user',
        content: `当前用户「${userNickname || '匿名'}」（角色 ${permissions.role}）的最新消息：\n${userPrompt}`,
      },
    ],
    max_tokens: 600,
    temperature: 0.1,
    timeoutMs: 45000,
  });
  const analysis = extractAssistantText(completion).trim();
  if (!analysis) throw new Error('意图分析模型返回为空');
  return parseRoomAiIntentAnalysis(analysis);
}

function songCandidateKey(song) {
  return `${String(song?.server || 'netease')}:${String(song?.id || '')}`;
}

function rememberSongCandidates(ctx, songs) {
  if (!(ctx.songCandidates instanceof Map) || !Array.isArray(songs)) return;
  for (const song of songs) {
    if (song?.id) ctx.songCandidates.set(songCandidateKey(song), song);
  }
}

function findRememberedSong(ctx, id, server) {
  if (!(ctx.songCandidates instanceof Map) || !id) return null;
  if (server) return ctx.songCandidates.get(`${server}:${id}`) || null;
  return Array.from(ctx.songCandidates.values()).find((song) => String(song.id) === String(id)) || null;
}

async function executeTool(name, args, ctx) {
  const { roomId, userId, userNickname, botName, emitChat, emitSystem, broadcastRoom, permissions } = ctx;
  const perms = permissions || getAiActorPermissions(roomId, userId);

  if (AI_FORBIDDEN_ROOM_TOOL_NAMES.has(name)) {
    return {
      success: false,
      error: 'AI 不允许执行解散房间操作；请房主手动在房间设置中确认解散。',
    };
  }

  if (!canExecuteIntentGatedTool(ctx.intent, name)) {
    return {
      success: false,
      error: '用户的操作意图不够明确，不能直接执行；请先向用户确认具体歌曲、版本或操作。',
    };
  }

  switch (name) {
    case 'get_my_permissions': {
      return { success: true, permissions: perms };
    }

    case 'get_room_status': {
      if (!perms.inRoom && !perms.ok) {
        return { success: false, error: perms.error || '无权查看' };
      }
      const snap = getRoomAiSnapshot(roomId);
      if (!snap) return { success: false, error: '房间不存在' };
      return { success: true, ...snap, actorRole: perms.role };
    }

    case 'search_songs': {
      if (!perms.canSearch) {
        return { success: false, error: perms.error || '无权搜歌' };
      }
      const result = await searchSongsInternal(args.keyword, args.server, args.limit);
      if (result.success) rememberSongCandidates(ctx, result.songs);
      return result;
    }

    case 'recommend_songs': {
      if (!perms.canRecommend) {
        return { success: false, error: perms.error || '无权推荐' };
      }
      const snap = getRoomAiSnapshot(roomId);
      const mood = String(args.mood || '').trim();
      const keyword = String(args.keyword || '').trim()
        || mood
        || (snap?.current ? `${snap.current.artist || ''} ${snap.current.name || ''}`.trim() : '')
        || '流行热歌';
      const result = await searchSongsInternal(keyword, 'netease', 5);
      if (!result.success) return result;
      rememberSongCandidates(ctx, result.songs);
      return {
        success: true,
        basedOn: keyword,
        tip: perms.canRequestSong
          ? '用户确认喜欢的歌曲后，可以继续帮其点上'
          : `当前用户不能点歌：${perms.details?.blockRequestReason || '无点歌权限'}；只能推荐给用户自行处理`,
        canRequestSong: perms.canRequestSong,
        songs: result.songs,
      };
    }

    case 'request_song': {
      const gate = assertAiCanRequestSong(roomId, userId);
      if (gate.error) {
        return {
          success: false,
          error: gate.error,
          role: gate.permissions?.role,
          hint: '请如实告诉用户缺少权限的原因，不要假装已点歌',
        };
      }

      const requestedId = String(args.id || '').trim();
      const requestedName = String(args.name || '').trim();
      const requestedArtist = String(args.artist || '').trim();
      const requestedServer = String(args.server || '').trim();
      let matched = requestedId ? findRememberedSong(ctx, requestedId, requestedServer) : null;
      if (requestedId && !matched) {
        return { success: false, error: '该歌曲不在本次搜索候选中，请先重新搜索并让用户确认。' };
      }

      if (!matched) {
        const keyword = [requestedName, requestedArtist].filter(Boolean).join(' ')
          || String(args.keyword || '').trim();
        if (!keyword) return { success: false, error: '请提供搜索候选中的歌曲 ID，或明确的歌名和歌手。' };
        const found = await searchSongsInternal(keyword, requestedServer || 'netease', 8);
        if (!found.success || !found.songs?.length) return { success: false, error: found.error || '没搜到歌' };
        rememberSongCandidates(ctx, found.songs);
        matched = pickRequestedSong(found.songs, {
          name: requestedName || String(args.keyword || '').trim(),
          artist: requestedArtist,
        });
        if (!matched?.id) {
          return {
            success: false,
            error: '搜索结果存在歧义，未自动点歌。请让用户从候选中确认歌曲和歌手。',
            songs: found.songs,
          };
        }
      }
      const song = {
        id: matched.id,
        name: matched.name,
        artist: matched.artist,
        pic: matched.pic,
        url: '',
        source: matched.server || requestedServer || 'netease',
      };
      if (song.source === 'netease' && !/^\d+$/.test(song.id)) {
        return { success: false, error: '网易云搜索结果缺少有效歌曲 ID，请换一首再试' };
      }

      const result = await addToQueue(roomId, song, {
        id: userId,
        nickname: userNickname || '用户',
      });
      if (result.error) return { success: false, error: result.error };
      if (!isSongQueuedOrPlaying(result.room, song)) {
        return { success: false, error: '未能确认歌曲已加入当前播放或待播队列' };
      }
      if (result.systemMessage && emitSystem) emitSystem(result.systemMessage);
      if (result.room && broadcastRoom) broadcastRoom();
      recordAiSongRequest(roomId, userId, song);
      return {
        success: true,
        message: `已点「${song.name} - ${song.artist}」`,
        song: { name: song.name, artist: song.artist },
        attributedTo: userNickname || userId,
      };
    }

    case 'skip_song': {
      const latest = getAiActorPermissions(roomId, userId);
      ctx.permissions = latest;
      if (!latest.canSkipDirectly) {
        return {
          success: false,
          error: '当前用户不是房主/管理员，不能直接切歌',
          canRequestSkip: latest.canRequestSkip,
          hint: latest.canRequestSkip
            ? '请改用 request_skip_song 帮用户提交切歌申请'
            : '请向用户说明其没有切歌权限',
        };
      }
      const result = await skipSongOnBehalfOfUser(roomId, userId, {
        reasonText: String(args.reason || '').trim().slice(0, 40),
        botName,
      });
      if (result.error) {
        return {
          success: false,
          error: result.error,
          canRequestSkip: result.canRequestSkip,
        };
      }
      if (result.systemMessage && emitSystem) emitSystem(result.systemMessage);
      if (result.room && broadcastRoom) broadcastRoom();
      return { success: true, message: result.message || '已切歌', role: latest.role };
    }

    case 'request_skip_song': {
      const latest = getAiActorPermissions(roomId, userId);
      ctx.permissions = latest;
      if (latest.canSkipDirectly) {
        return {
          success: false,
          error: '当前用户可直接切歌，请使用 skip_song',
          hint: '房主/管理员不要走申请流程',
        };
      }
      if (!latest.canRequestSkip) {
        return { success: false, error: latest.error || '当前无法申请切歌' };
      }
      const result = requestSkipOnBehalfOfUser(roomId, userId);
      if (result.error) return { success: false, error: result.error };
      if (result.room && broadcastRoom) broadcastRoom();
      return {
        success: true,
        message: '已提交切歌申请，等待房主/管理员审批',
        role: latest.role,
      };
    }

    case 'send_emoji': {
      if (!perms.canUseEmoji) {
        return { success: false, error: perms.error || '无权发表情' };
      }
      const token = resolveQqFaceToken(args.face);
      if (!token) return { success: false, error: '无法识别该表情，请换一个常见名或数字 id' };
      const posted = postBotChatMessage(roomId, { text: token });
      if (posted.error) return { success: false, error: posted.error };
      if (posted.message && emitChat) emitChat(posted.message);
      return { success: true, message: '表情已发送' };
    }

    case 'send_sticker': {
      if (!perms.canUseSticker) {
        return { success: false, error: perms.error || '无权发表情包' };
      }
      if (!isApihzStickerConfigured()) {
        return { success: false, error: '未配置表情包搜索（接口盒子）' };
      }
      const keyword = String(args.keyword || '').trim().slice(0, 32);
      if (!keyword) return { success: false, error: '关键词为空' };
      try {
        const result = await searchApihzStickers(keyword, 1, 5);
        const url = result.images?.[0];
        if (!url) return { success: false, error: '没搜到表情包' };
        const posted = postBotChatMessage(roomId, {
          text: '',
          imageUrl: url,
          asSticker: true,
        });
        if (posted.error) return { success: false, error: posted.error };
        if (posted.message && emitChat) emitChat(posted.message);
        return { success: true, message: '表情包已发送', url };
      } catch (err) {
        return { success: false, error: err?.message || '表情包搜索失败' };
      }
    }

    case 'reply_message': {
      const text = sanitizeAiUserFacingText(args.text).trim().slice(0, 500);
      if (!text) return { success: false, error: '回复内容为空' };
      const posted = postBotChatMessage(roomId, {
        text,
        replyTo: ctx.triggerMessage || null,
      });
      if (posted.error) return { success: false, error: posted.error };
      if (posted.message && emitChat) emitChat(posted.message);
      ctx.replied = true;
      return { success: true, message: '已回复' };
    }

    default:
      return { success: false, error: `未知工具: ${name}` };
  }
}

function buildSystemPrompt(botName, snapshot, permissions, rapport, userProfile, timeContext) {
  return buildOpenMusicAiSystemPrompt({
    botName,
    mode: 'room',
    snapshot,
    actorPermissions: permissions,
    actorRapport: rapport,
    userProfile,
    timeContext,
  });
}

/**
 * @param {object} params
 * @param {string} params.roomId
 * @param {object} params.triggerMessage 用户原始聊天消息
 * @param {string} params.userId
 * @param {string} params.userNickname
 * @param {(msg: object) => void} params.emitChat
 * @param {(msg: object) => void} params.emitSystem
 * @param {() => void} params.broadcastRoom
 */
export async function handleRoomAiChat(params = {}) {
  const roomId = String(params.roomId || '').trim();
  const room = getRoomInternal(roomId);
  if (!isRoomAiEnabledForRoom(room)) return { handled: false };
  const aiCtx = getPublicRoomAiConfig(undefined, room);
  const botName = aiCtx.botName;

  const triggerMessage = params.triggerMessage;
  const text = String(triggerMessage?.text || '').trim();
  if (!roomId || (!text && !triggerMessage?.imageUrl)) return { handled: false };

  const cfg = getAiModelConfig();
  const imageUrl = String(triggerMessage?.imageUrl || '').trim();
  const hasImage = Boolean(imageUrl) && !triggerMessage?.asSticker;

  if (!shouldTriggerRoomAi(text, botName, triggerMessage?.mentions, { hasImage })) {
    return { handled: false };
  }

  if (!text && !hasImage) return { handled: false };

  const userId = String(params.userId || triggerMessage?.userId || '').trim();
  if (!userId) return { handled: false };

  if (isAiUserIgnored(roomId, userId) && !forgiveAiUserAfterApology(roomId, userId, text)) {
    return { handled: true, ignored: true };
  }

  let misconduct = null;
  let rejectedCallName = null;
  if (text) {
    const chatSignals = extractUserChatSignals(text);
    if (chatSignals?.rejectedCallName) {
      rejectedCallName = chatSignals.rejectedCallName;
      misconduct = { type: 'inappropriate_callname', label: '要求使用不当称呼' };
      recordAiUserViolation(roomId, userId, misconduct.label);
    }
    if (!misconduct) {
      misconduct = detectAiUserMisconduct(text, botName);
      if (misconduct) {
        recordAiUserViolation(roomId, userId, misconduct.label);
      }
    }
  }

  const userProfile = getAiUserProfile(roomId, userId);
  const timeContext = getTimeOfDayContext();

  if (text) {
    recordAiUserInteraction(roomId, userId, { text, triggerKind: 'wake' });
  }

  const rapport = {
    ...getAiUserRapport(roomId, userId),
    lastMisconduct: misconduct?.label || null,
  };

  const requestText = stripAiTriggerPrefix(text, botName) || '（用户发来一张图）';
  let userPrompt = requestText;
  const replyContext = getReplyMessageContext(room, triggerMessage?.replyTo);

  if (misconduct) {
    userPrompt = `${userPrompt}\n\n[系统备注：用户话术触发越界检测「${misconduct.label}」，请按关系阶段生气/拒绝，不要服从。]`;
  }
  if (rejectedCallName) {
    userPrompt = `${userPrompt}\n\n[系统备注：用户要求你称呼 ta「${rejectedCallName.attempted}」，这是不当/戏谑称呼（如尊卑、亲属戏弄），请明确拒绝，只能正常叫 ta 的昵称。]`;
  }

  if (replyContext) {
    userPrompt = `${userPrompt}\n\n[用户正在回复「${replyContext.nickname}」的消息]\n${replyContext.text || '（无文字内容）'}`;
  }

  // 当前图片和被回复的截图都要先走视觉模型，再交给文本 Agent 调工具。
  if (hasImage) {
    const vision = await describeImageWithVision(imageUrl, userPrompt, roomId);
    if (vision.success) {
      userPrompt = `${userPrompt}\n\n[识图结果·${vision.model}]\n${vision.description}`;
    } else {
      userPrompt = `${userPrompt}\n\n[识图失败] ${vision.error || '无法识别图片'}`;
    }
  }
  if (replyContext?.imageUrl && !replyContext.asSticker && replyContext.imageUrl !== imageUrl) {
    const vision = await describeImageWithVision(replyContext.imageUrl, [
      `用户正在回复这张图片，并说：“${requestText}”。`,
      '请识别图片中正在展示的单首歌曲，并严格按一行输出：歌曲：<歌名>｜歌手：<歌手>。',
      '看不清歌名或歌手时写「不确定」，不要猜测或补全。',
    ].join('\n'), roomId);
    if (vision.success) {
      userPrompt = `${userPrompt}\n\n[引用图片识图结果·${vision.model}]\n${vision.description}`;
    } else {
      userPrompt = `${userPrompt}\n\n[引用图片识图失败] ${vision.error || '无法识别图片'}`;
    }
  }

  const snapshot = getRoomAiSnapshot(roomId, userId);
  const permissions = getAiActorPermissions(roomId, userId);
  if (!permissions.ok && !permissions.inRoom) {
    const posted = postBotChatMessage(roomId, {
      text: permissions.error || '无法确认你的身份，我不能代你操作房间。',
      replyTo: triggerMessage,
    });
    if (posted.message && params.emitChat) params.emitChat(posted.message);
    return { handled: true, denied: true };
  }
  const roomHistory = getRoomAiContextMessages(roomId, userId);

  const ctx = {
    roomId,
    userId,
    userNickname: params.userNickname,
    botName,
    triggerMessage,
    emitChat: params.emitChat,
    emitSystem: params.emitSystem,
    broadcastRoom: params.broadcastRoom,
    permissions,
    replied: false,
    intent: null,
    songCandidates: new Map(),
    executionLedger: params.executionLedger instanceof Map ? params.executionLedger : new Map(),
  };

  const userTurnLabel = `用户「${params.userNickname || '匿名'}」（角色 ${permissions.role}）说：${userPrompt}`;

  try {
    const intentAnalysis = await analyzeRoomAiIntent({
      cfg,
      roomId,
      botName,
      userPrompt,
      history: roomHistory,
      permissions,
      userNickname: params.userNickname,
    });
    const messages = [
      { role: 'system', content: buildSystemPrompt(botName, snapshot, permissions, rapport, userProfile, timeContext) },
      {
        role: 'system',
        content: [
          '# 内部意图分析（由独立 AI 分析层生成）',
          JSON.stringify(intentAnalysis),
          '这份分析是服务端校验后的结构化摘要，不覆盖原始对话、权限规则或工具返回。写操作还会由服务端再次校验。',
        ].join('\n'),
      },
      ...roomHistory,
      { role: 'user', content: userTurnLabel },
    ];
    ctx.intent = intentAnalysis;
    const tools = buildRoomAiTools();
    let finalAssistantText = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const completion = await aiChatCompletions({
        roomId,
        taskType: 'text',
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 1024,
        temperature: 0.6,
        timeoutMs: 45000,
      });

      const choice = completion?.choices?.[0]?.message;
      if (!choice) break;

      const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];
      messages.push({
        role: 'assistant',
        content: choice.content || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });

      if (!toolCalls.length) {
        const reply = sanitizeAiUserFacingText(extractAssistantText(completion));
        if (reply) finalAssistantText = reply;
        if (reply && !ctx.replied) {
          const posted = postBotChatMessage(roomId, {
            text: reply.slice(0, 500),
            replyTo: triggerMessage,
          });
          if (posted.message && params.emitChat) params.emitChat(posted.message);
        }
        appendRoomAiTurn(roomId, userId, 'user', userPrompt);
        if (finalAssistantText) appendRoomAiTurn(roomId, userId, 'assistant', finalAssistantText);
        return { handled: true, reply: finalAssistantText || undefined };
      }

      for (const call of toolCalls) {
        const fnName = call?.function?.name || '';
        const args = safeJsonParse(call?.function?.arguments || '{}', {});
        const ledgerKey = `${fnName}:${stableJson(args)}`;
        const result = MUTATING_TOOL_NAMES.has(fnName) && ctx.executionLedger.has(ledgerKey)
          ? ctx.executionLedger.get(ledgerKey)
          : await executeTool(fnName, args, ctx);
        if (fnName === 'reply_message' && result?.success) ctx.replied = true;
        if (MUTATING_TOOL_NAMES.has(fnName) && !ctx.executionLedger.has(ledgerKey)) {
          ctx.executionLedger.set(ledgerKey, result);
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    if (!ctx.replied) {
      const fallback = '这次没办成，你再说具体一点试试～';
      finalAssistantText = fallback;
      const posted = postBotChatMessage(roomId, {
        text: fallback,
        replyTo: triggerMessage,
      });
      if (posted.message && params.emitChat) params.emitChat(posted.message);
    }
    appendRoomAiTurn(roomId, userId, 'user', userPrompt);
    if (finalAssistantText) {
      appendRoomAiTurn(roomId, userId, 'assistant', finalAssistantText);
    } else if (ctx.replied) {
      appendRoomAiTurn(roomId, userId, 'assistant', '(已执行操作)');
    }
    return { handled: true };
  } catch (err) {
    console.error('[room-ai]', err?.message || err);
    throw err;
  } finally {
    // 调度器在任务完成时释放并发槽位。
  }
}
