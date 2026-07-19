import { useEffect, useRef, useCallback } from 'react';

import { io, Socket } from 'socket.io-client';

import { useRoomStore } from '../stores/roomStore';
import { useChatStore } from '../stores/chatStore';
import { useChatSystemToastStore } from '../stores/chatSystemToastStore';
import { useSongHistoryStore } from '../stores/songHistoryStore';
import { useAudioStore } from '../stores/audioStore';
import { songKey } from '../api/music';

import type { ChatMention, ChatReplyRef, ChatMessage, FavoriteSong, PlaybackState, RoomState, Song, SongHistoryItem } from '../types';

import { stopSharedAudio } from '../lib/audioElement';
import { resetDriftController } from '../lib/driftController';
import { resetPhaseSync } from '../lib/playbackSync';
import { resetSyncStateMachine } from '../lib/syncStateMachine';
import { prefetchUpcomingFromRoom } from '../lib/songPreloadCache';
import { resetPlaybackStateCache } from '../lib/playbackState';
import {
  schedulePlaybackState,
  seedPlaybackFromRoom,
  resetPlaybackScheduling,
} from '../lib/playbackSchedule';
import { rememberClientIdentity } from '../lib/clientId';
import { requireSessionBootstrap, resetSessionBootstrap } from '../lib/sessionBootstrap';
import { mergeRoomState } from '../lib/mergeRoomState';
import { debugLine, debugLog, resetDriftHistogram, setDebugSocketProvider } from '../lib/debugTools';
import { bindReportTrackDurationSocket } from '../lib/reportTrackDuration';
import {
  getClientNetworkInfo,
  type ClientNetworkInfo,
} from '../lib/clientNetworkInfo';



let socket: Socket | null = null;
let socketListenersAttached = false;
let socketConnectRequested = false;

const SOCKET_ACK_TIMEOUT_MS = 8000;
const SOCKET_IMAGE_ACK_TIMEOUT_MS = 20000;

type JoinSession = {
  roomId: string;
  nickname: string;
  password?: string;
  readOnly?: boolean;
  networkInfo?: ClientNetworkInfo;
};

let lastJoinSession: JoinSession | null = null;
let lastTvJoinSession: JoinSession | null = null;
let activeJoinMode: 'normal' | 'tv' | null = null;
let rejoinInFlight = false;
let joinGeneration = 0;
let reconnectTimer: number | null = null;
let reconnectAttempt = 0;

function getSocket(): Socket {

  if (!socket) {

    socket = io({

      transports: ['websocket', 'polling'],

      autoConnect: false,

      withCredentials: true,

      reconnection: true,

      reconnectionAttempts: Infinity,

      reconnectionDelay: 1000,

      reconnectionDelayMax: 8000,

    });

  }

  return socket;

}

function waitForSocketConnect(s: Socket, timeoutMs = SOCKET_ACK_TIMEOUT_MS): Promise<void> {
  if (s.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      s.off('connect', onConnect);
      reject(new Error('连接超时，请检查网络'));
    }, timeoutMs);
    const onConnect = () => {
      window.clearTimeout(timer);
      resolve();
    };
    s.once('connect', onConnect);
    if (!s.active) s.connect();
  });
}

/** 确保会话已 bootstrap，并在需要时建立 socket 连接（不无故重连） */
async function ensureSocketReady(forceBootstrap = false): Promise<Socket> {
  await requireSessionBootstrap(forceBootstrap);
  const s = getSocket();
  if (s.connected) return s;
  socketConnectRequested = true;
  await waitForSocketConnect(s);
  return s;
}

/** 仅在会话失效时重建 socket，确保握手携带 Cookie */
async function reconnectSocketSession(forceBootstrap = false): Promise<Socket> {
  await requireSessionBootstrap(forceBootstrap);
  const s = getSocket();
  if (s.connected || s.active) {
    await new Promise<void>((resolve) => {
      s.once('disconnect', () => resolve());
      s.disconnect();
    });
  }
  socketConnectRequested = true;
  await waitForSocketConnect(s);
  return s;
}

/** 应用启动后预热 socket，缩短首次进房等待 */
export async function warmUpSocketSession(): Promise<void> {
  try {
    await ensureSocketReady(false);
  } catch {
    // 首次预热失败不影响后续进房重试
  }
}

bindReportTrackDurationSocket(getSocket);


function emitWithAck<TResponse>(
  event: string,
  payload: unknown,
  fallback: TResponse,
  timeoutMs = SOCKET_ACK_TIMEOUT_MS,
): Promise<TResponse> {
  return new Promise((resolve) => {
    getSocket().timeout(timeoutMs).emit(
      event,
      payload,
      (err: Error | null, res: TResponse | undefined) => {
        resolve(err || !res ? fallback : res);
      },
    );
  });
}

function joinPayload(session: JoinSession) {
  return {
    roomId: session.roomId,
    nickname: session.nickname,
    password: session.password?.trim() || undefined,
    readOnly: Boolean(session.readOnly),
    clientIp: session.networkInfo?.ip,
    clientLocation: session.networkInfo?.location,
  };
}

type JoinAckResponse = {
  success: boolean;
  error?: string;
  needsPassword?: boolean;
  room?: RoomState;
  messages?: ChatMessage[];
  chatHasMore?: boolean;
  playbackState?: PlaybackState;
  socketId?: string;
  connectionId?: string;
  clientId?: string;
  clientToken?: string;
  needsSession?: boolean;
  nickname?: string;
};

function applyJoinResponse(session: JoinSession, res: JoinAckResponse) {
  if (!res.success || !res.room) return;

  // 先写入身份，再应用房间快照（角色只从 room 字段推导，不读 ACK 特权布尔）
  if (res.socketId) {
    const connectionId = res.connectionId || getSocket().id || null;
    useRoomStore.getState().setConnectionInfo(res.socketId, connectionId);
  }

  applyRoomSnapshot(res.room, true);
  applyJoinSnapshot(res.room, res.playbackState);
  applyJoinExtras(res.room, { messages: res.messages, chatHasMore: res.chatHasMore });

  const isTvSession = Boolean(session.readOnly);
  if (isTvSession) {
    activeJoinMode = 'tv';
    lastTvJoinSession = session;
  } else {
    activeJoinMode = 'normal';
    lastJoinSession = session;
    lastTvJoinSession = null;
    rememberClientIdentity(res.socketId);
  }

  const resolvedNickname = res.nickname?.trim()
    || res.room.users.find((user) => user.id === res.socketId)?.nickname?.trim();
  if (!isTvSession && resolvedNickname) {
    useRoomStore.getState().setNickname(resolvedNickname);
    lastJoinSession = { ...session, nickname: resolvedNickname };
  }

  if (res.room.current || res.room.nextRandom || (res.room.queue?.length ?? 0) > 0) {
    prefetchUpcomingFromRoom(res.room);
  }

  clearReconnectSchedule();
  reconnectAttempt = 0;
  useRoomStore.getState().setReconnecting(false);
}

function applyRoomSnapshot(room: RoomState, force = false) {
  const current = useRoomStore.getState().room;
  const merged = force ? room : mergeRoomState(room, current);
  useRoomStore.getState().setRoom(merged);
  useRoomStore.getState().syncRolesFromRoom(room);

  // 房主开启「进房可看历史」后，放开本地聊天截断，允许上滑拉取更早消息
  if (
    merged.chatHistoryVisibleOnJoin
    && useChatStore.getState().roomId === merged.id
  ) {
    useChatStore.getState().unlockChatHistory();
  }
}

function applyJoinSnapshot(room: RoomState, playbackState?: PlaybackState) {
  if (playbackState) {
    schedulePlaybackState(playbackState);
  } else {
    seedPlaybackFromRoom(room);
  }
}

function applyJoinChat(room: RoomState, messages?: ChatMessage[], chatHasMore?: boolean) {
  useChatSystemToastStore.getState().clear();
  useChatStore.getState().reset(
    room.id,
    messages || [],
    Boolean(chatHasMore),
    room.chatVisibleSince ?? null,
  );
}

function prefetchSongHistory(roomId: string) {
  void emitWithAck<{ success: boolean; songs?: SongHistoryItem[] }>(
    'load_song_history',
    { limit: 150 },
    { success: false },
  ).then((res) => {
    if (useRoomStore.getState().room?.id !== roomId) return;
    if (res.success && res.songs) {
      useSongHistoryStore.getState().setSongs(roomId, res.songs);
    }
  });
}

function applyJoinExtras(
  room: RoomState,
  extras: { messages?: ChatMessage[]; chatHasMore?: boolean },
) {
  applyJoinChat(room, extras.messages, extras.chatHasMore);
  prefetchSongHistory(room.id);
}

function getActiveJoinSession(): JoinSession | null {
  if (activeJoinMode === 'tv' && lastTvJoinSession) return lastTvJoinSession;
  if (lastJoinSession) return lastJoinSession;

  const room = useRoomStore.getState().room;
  const nickname = useRoomStore.getState().nickname.trim();
  if (room && nickname) {
    return { roomId: room.id, nickname };
  }
  return null;
}

function shouldMaintainRoomSession(): boolean {
  return Boolean(getActiveJoinSession() && useRoomStore.getState().room);
}

function clearReconnectSchedule() {
  if (reconnectTimer != null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function isPermanentRejoinError(error?: string): boolean {
  const message = String(error || '').trim();
  if (!message) return false;
  return (
    message.includes('房间不存在')
    || message.includes('无法再次进入')
    || message.includes('密码')
    || message.includes('禁止')
  );
}

function scheduleRoomRejoin(trigger: string) {
  if (!shouldMaintainRoomSession()) return;
  if (reconnectTimer != null) return;

  const jitter = Math.floor(Math.random() * 600);
  const delay = Math.min(800 + reconnectAttempt * 500, 8000) + jitter;
  reconnectAttempt += 1;
  useRoomStore.getState().setReconnecting(true);
  debugLog('room_rejoin_scheduled', debugLine({ trigger, delay, attempt: reconnectAttempt }));

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    void attemptRoomRejoin(trigger);
  }, delay);
}

function emitJoinRoom(s: Socket, session: JoinSession): Promise<JoinAckResponse> {
  return new Promise((resolve) => {
    s.timeout(SOCKET_ACK_TIMEOUT_MS).emit(
      'join_room',
      joinPayload(session),
      (err: Error | null, res: JoinAckResponse | undefined) => {
        if (err || !res) {
          resolve({ success: false, error: err?.message || '加入房间失败' });
          return;
        }
        resolve(res);
      },
    );
  });
}

async function attemptRoomRejoin(trigger: string) {
  const session = getActiveJoinSession();
  const currentRoom = useRoomStore.getState().room;
  if (!session || !currentRoom) {
    useRoomStore.getState().setReconnecting(false);
    return;
  }
  if (rejoinInFlight) return;

  rejoinInFlight = true;
  useRoomStore.getState().setReconnecting(true);
  debugLog('room_rejoin_attempt', debugLine({ trigger, roomId: session.roomId, attempt: reconnectAttempt }));

  try {
    resetSessionBootstrap();
    await requireSessionBootstrap(true);

    let s = getSocket();
    if (!s.connected) {
      socketConnectRequested = true;
      if (!s.active) s.connect();
      await waitForSocketConnect(s, 12000);
    }

    let res = await emitJoinRoom(s, session);

    if (!res.success && res.needsSession && !session.readOnly) {
      s = await reconnectSocketSession(true);
      res = await emitJoinRoom(s, session);
    }

    if (res.success && res.room) {
      reconnectAttempt = 0;
      applyJoinResponse(session, res);
      useRoomStore.getState().setReconnecting(false);
      clearReconnectSchedule();
      return;
    }

    if (isPermanentRejoinError(res.error)) {
      useRoomStore.getState().setReconnecting(false);
      clearReconnectSchedule();
      return;
    }

    scheduleRoomRejoin('join_failed');
  } catch (err) {
    debugLog('room_rejoin_error', debugLine({
      trigger,
      message: err instanceof Error ? err.message : String(err),
    }));
    scheduleRoomRejoin('error');
  } finally {
    rejoinInFlight = false;
  }
}

function handleSocketDisconnect(reason: string) {
  debugLog('socket_disconnect', debugLine({ reason }));
  const { mySocketId } = useRoomStore.getState();
  useRoomStore.getState().setConnectionInfo(mySocketId, null);

  if (!shouldMaintainRoomSession()) return;

  // 普通断线不等于会话失效；40+ 人同时 bootstrap + join 会打爆服务端
  useRoomStore.getState().setReconnecting(true);

  if (reason === 'io server disconnect') {
    const s = getSocket();
    socketConnectRequested = true;
    s.connect();
  }
  // 依赖 Socket.IO 自动重连，成功后由 connect 事件触发 attemptRoomRejoin
}



export function useSocket() {

  const setConnectionInfo = useRoomStore((s) => s.setConnectionInfo);

  const resetSession = useRoomStore((s) => s.resetSession);

  const connected = useRef(false);



  useEffect(() => {

    const s = getSocket();

        setDebugSocketProvider(() => ({
      id: s.id,
      connected: s.connected,
      transport: s.io.engine?.transport?.name,
    }));
if (socketListenersAttached) return;
    socketListenersAttached = true;



let prefetchDebounceTimer = 0;

    const onRoomUpdate = (room: RoomState) => {
      debugLog('room_update', debugLine({
        roomId: room.id,
        current: room.current?.queueId || null,
        isPlaying: room.isPlaying,
        currentTime: Number(room.currentTime.toFixed(3)),
        users: room.users?.length ?? 0,
        randomLoading: room.randomLoading,
      }));
      const { room: prevRoom } = useRoomStore.getState();

      if (prevRoom?.id === room.id && room.current) {
        const prevKey = prevRoom.current ? songKey(prevRoom.current) : null;
        const nextKey = songKey(room.current);
        if (prevKey !== nextKey) {
          const current = room.current;
          useSongHistoryStore.getState().appendSong(room.id, {
            id: current.id,
            source: current.source,
            name: current.name,
            artist: current.artist,
            album: current.album,
            pic: current.pic,
            duration: current.duration,
            requestedBy: current.requestedBy,
            requestedById: current.requestedById,
            requestedAt: Date.now(),
          });
        }
      }

      applyRoomSnapshot(room);

      window.clearTimeout(prefetchDebounceTimer);
      prefetchDebounceTimer = window.setTimeout(() => {
        const live = useRoomStore.getState().room;
        if (!live || live.id !== room.id) return;
        prefetchUpcomingFromRoom(live);
      }, 400);
    };

    const onPlaybackState = (state: PlaybackState) => {
      schedulePlaybackState(state);
    };

    const onQueueSnapshot = (payload: { queue?: RoomState['queue']; current?: RoomState['current'] }) => {
      const current = useRoomStore.getState().room;
      if (!current) return;
      const nextQueue = Array.isArray(payload.queue) ? payload.queue : current.queue;
      const nextCurrent = payload.current === undefined ? current.current : payload.current;
      useRoomStore.getState().setRoom({
        ...current,
        queue: nextQueue,
        current: nextCurrent,
      });
    };

    const onChatMessage = (message: ChatMessage) => {
      if (message.kind === 'system') {
        useChatSystemToastStore.getState().show(message.text);
        return;
      }
      useChatStore.getState().append(message);
    };

    const onChatMessageRecall = ({ messageId }: { messageId: string }) => {
      if (!messageId) return;
      useChatStore.getState().remove(messageId);
    };

    const onChatReactionUpdate = ({
      messageId,
      reactions,
    }: {
      messageId: string;
      reactions: ChatMessage['reactions'];
    }) => {
      useChatStore.getState().updateReactions(messageId, reactions);
    };

    const onKicked = ({ message }: { message?: string }) => {
      joinGeneration += 1;
      lastJoinSession = null;
      lastTvJoinSession = null;
      activeJoinMode = null;
      clearReconnectSchedule();
      reconnectAttempt = 0;
      useChatStore.getState().clear();
      useChatSystemToastStore.getState().clear();
      useSongHistoryStore.getState().clear();
      stopSharedAudio();
      resetSyncStateMachine();
      resetPhaseSync();
      resetDriftController();
      resetPlaybackScheduling();
      resetDriftHistogram();
      resetPlaybackStateCache();
      useAudioStore.getState().setPlaybackVersion(0);
      useAudioStore.getState().setTrackLoading(false);
      useAudioStore.getState().setNeedsAudioUnlock(false);
      useAudioStore.getState().setSmoothPlaybackTime(0);
      resetSession();
      useRoomStore.getState().setExitReason(
        message || '你已被房主移出房间，无法再次进入',
      );
    };

    const onUserLocation = ({ userId, location }: { userId?: string; location?: string }) => {
      const nextLocation = String(location || '').trim();
      const targetUserId = String(userId || '').trim();
      if (!targetUserId || !nextLocation) return;
      const { room } = useRoomStore.getState();
      if (!room?.users?.length) return;
      let changed = false;
      const users = room.users.map((user) => {
        if (user.id !== targetUserId || user.location === nextLocation) return user;
        changed = true;
        return { ...user, location: nextLocation };
      });
      if (changed) useRoomStore.getState().setRoom({ ...room, users });
    };

    s.on('room_update', onRoomUpdate);

    s.on('playback_state', onPlaybackState);

    s.on('queue_snapshot', onQueueSnapshot);

    s.on('chat_message', onChatMessage);

    s.on('chat_message_recall', onChatMessageRecall);

    s.on('chat_reaction_update', onChatReactionUpdate);

    s.on('user_location', onUserLocation);

    s.on('kicked', onKicked);

    s.on('connect', () => {
      debugLog('socket_connect', debugLine({
        id: s.id,
        transport: s.io.engine?.transport?.name,
      }));
      void attemptRoomRejoin('connect');
    });
    s.on('disconnect', handleSocketDisconnect);
    s.on('connect_error', (err) => {
      debugLog('socket_connect_error', debugLine({ message: err?.message }));
      const { mySocketId } = useRoomStore.getState();
      useRoomStore.getState().setConnectionInfo(mySocketId, null);
      if (shouldMaintainRoomSession()) {
        scheduleRoomRejoin('connect_error');
      }
    });

  }, [setConnectionInfo, resetSession]);



  const connect = useCallback(() => {

    const s = getSocket();

        setDebugSocketProvider(() => ({
      id: s.id,
      connected: s.connected,
      transport: s.io.engine?.transport?.name,
    }));
if (!connected.current && !socketConnectRequested) {

      s.connect();

      connected.current = true;
      socketConnectRequested = true;

    }

  }, []);



  const joinRoom = useCallback(

    (
      roomId: string,
      nickname: string,
      password?: string,
      options: { readOnly?: boolean } = {},
    ): Promise<{ success: boolean; error?: string; needsPassword?: boolean; room?: RoomState }> => {
      const session: JoinSession = {
        roomId,
        nickname,
        password,
        readOnly: Boolean(options.readOnly),
      };
      const generation = ++joinGeneration;

      const attemptJoin = () => emitWithAck<JoinAckResponse>(
        'join_room',
        joinPayload(session),
        { success: false, error: '连接超时，请检查网络' },
      );

      const runJoin = async () => {
        session.networkInfo = await getClientNetworkInfo();
        try {
          await ensureSocketReady(false);
        } catch {
          resetSessionBootstrap();
          try {
            await reconnectSocketSession(true);
          } catch (err) {
            const message = err instanceof Error ? err.message : '会话未就绪，请刷新页面后重试';
            return { success: false, error: message, needsSession: true };
          }
        }

        let res = await attemptJoin();
        if (!res.success && res.needsSession && !options.readOnly) {
          resetSessionBootstrap();
          try {
            await reconnectSocketSession(true);
          } catch (err) {
            const message = err instanceof Error ? err.message : '会话未就绪，请刷新页面后重试';
            return { success: false, error: message, needsSession: true };
          }
          res = await attemptJoin();
        }
        if (res.success && res.room) {
          if (generation !== joinGeneration) return res;
          applyJoinResponse(session, res);
        }
        return res;
      };

      return runJoin();
    },

    [connect, setConnectionInfo],

  );



  const leaveRoom = useCallback((): Promise<void> => {
    joinGeneration += 1;
    lastJoinSession = null;
    lastTvJoinSession = null;
    activeJoinMode = null;
    clearReconnectSchedule();
    reconnectAttempt = 0;
    useRoomStore.getState().setReconnecting(false);
    useChatStore.getState().clear();
    useChatSystemToastStore.getState().clear();
    useSongHistoryStore.getState().clear();
    stopSharedAudio();
    resetSyncStateMachine();
    resetPhaseSync();
    resetDriftController();
    resetPlaybackScheduling();
    resetPlaybackStateCache();
    useAudioStore.getState().setPlaybackVersion(0);
    useAudioStore.getState().setTrackLoading(false);
    useAudioStore.getState().setNeedsAudioUnlock(false);
    useAudioStore.getState().setSmoothPlaybackTime(0);
    resetSession();

    const s = getSocket();
        setDebugSocketProvider(() => ({
      id: s.id,
      connected: s.connected,
      transport: s.io.engine?.transport?.name,
    }));
if (s.connected) {
      s.timeout(SOCKET_ACK_TIMEOUT_MS).emit('leave_room', {}, () => {});
    }
    return Promise.resolve();
  }, [resetSession]);



  const addSong = useCallback((song: Song): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('add_song', { song }, { success: false, error: '连接超时，请重试' });

  }, []);



  const skipSong = useCallback((options?: { reason?: 'manual' | 'source_error' | 'system' }): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('skip_song', { reason: options?.reason || 'manual' }, { success: false, error: '连接超时，请重试' });

  }, []);

  const finishSong = useCallback((queueId: string): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('finish_song', { queueId }, { success: false, error: '连接超时，请重试' });
  }, []);



  const togglePlay = useCallback((isPlaying: boolean): Promise<boolean> => {
    return emitWithAck('toggle_play', { isPlaying }, { success: false }).then((res) => res.success);

  }, []);



  const seek = useCallback((time: number): Promise<boolean> => {
    return emitWithAck('seek', { time }, { success: false }).then((res) => res.success);

  }, []);



  const removeSong = useCallback((queueId: string): Promise<boolean> => {
    return emitWithAck('remove_song', { queueId }, { success: false }).then((res) => res.success);

  }, []);

  const clearQueue = useCallback((): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('clear_queue', {}, { success: false, error: '连接超时，请重试' });
  }, []);



  const requestJump = useCallback((queueId: string): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('request_jump', { queueId }, { success: false, error: '连接超时，请重试' });

  }, []);

  const reorderQueue = useCallback((orderedQueueIds: string[], movedQueueId: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'reorder_queue',
      { orderedQueueIds, movedQueueId },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const toggleQueueLike = useCallback((queueId: string): Promise<{ success: boolean; liked?: boolean; error?: string }> => {
    return emitWithAck('toggle_queue_like', { queueId }, { success: false, error: '连接超时，请重试' });

  }, []);

  const toggleCurrentDislike = useCallback((): Promise<{
    success: boolean;
    disliked?: boolean;
    skipped?: boolean;
    dislikeCount?: number;
    threshold?: number;
    error?: string;
    room?: RoomState;
  }> => {
    return emitWithAck<{
      success: boolean;
      disliked?: boolean;
      skipped?: boolean;
      dislikeCount?: number;
      threshold?: number;
      error?: string;
      room?: RoomState;
    }>(
      'toggle_current_dislike',
      {},
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);



  const approveJump = useCallback((requestId: string): Promise<boolean> => {
    return emitWithAck('approve_jump', { requestId }, { success: false }).then((res) => res.success);

  }, []);



  const rejectJump = useCallback((requestId: string): Promise<boolean> => {
    return emitWithAck('reject_jump', { requestId }, { success: false }).then((res) => res.success);

  }, []);



  const requestSkip = useCallback((): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('request_skip', {}, { success: false, error: '连接超时，请重试' });

  }, []);



  const approveSkip = useCallback((requestId: string): Promise<boolean> => {
    return emitWithAck('approve_skip', { requestId }, { success: false }).then((res) => res.success);

  }, []);



  const rejectSkip = useCallback((requestId: string): Promise<boolean> => {
    return emitWithAck('reject_skip', { requestId }, { success: false }).then((res) => res.success);

  }, []);



  const sendChat = useCallback((
    text: string,
    options: {
      mentions?: ChatMention[];
      replyTo?: ChatReplyRef | null;
      imageUrl?: string;
      imageKey?: string;
      asSticker?: boolean;
    } = {},
  ): Promise<{ success: boolean; error?: string }> => {
    const hasImage = Boolean(options.imageUrl);
    const timeoutMs = hasImage ? SOCKET_IMAGE_ACK_TIMEOUT_MS : SOCKET_ACK_TIMEOUT_MS;
    return emitWithAck(
      'send_chat',
      { text, ...options },
      { success: false, error: '连接超时，请重试' },
      timeoutMs,
    );

  }, []);

  const toggleChatReaction = useCallback((
    messageId: string,
    emoji: string,
  ): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck(
      'toggle_chat_reaction',
      { messageId, emoji },
      { success: false, error: '连接超时，请重试' },
    );
  }, []);

  const recallChat = useCallback((
    messageId: string,
  ): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck(
      'recall_chat',
      { messageId },
      { success: false, error: '连接超时，请重试' },
    );
  }, []);

  const listFavorites = useCallback((): Promise<{ success: boolean; favorites?: FavoriteSong[]; error?: string }> => {
    return emitWithAck('list_favorites', {}, { success: false, error: '连接超时，请重试' });
  }, []);

  const setFavorite = useCallback((song: Song, favorite: boolean): Promise<{ success: boolean; favorites?: FavoriteSong[]; favorite?: boolean; error?: string }> => {
    return emitWithAck('set_favorite', { song, favorite }, { success: false, error: '连接超时，请重试' });
  }, []);

  const importFavorites = useCallback((songs: Song[]): Promise<{ success: boolean; favorites?: FavoriteSong[]; imported?: number; dropped?: number; maxFavorites?: number; error?: string }> => {
    return emitWithAck('import_favorites', { songs }, { success: false, error: '导入超时，请稍后重试' });
  }, []);



  const renameUser = useCallback((nickname: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'rename_user',
      { nickname },
      { success: false, error: '连接超时，请重试' },
    )
      .then((res) => {
        if (res.success && res.room) {
          applyRoomSnapshot(res.room);
          const myUserId = useRoomStore.getState().mySocketId;
          const resolvedNickname = (myUserId
            ? res.room.users.find((user) => user.id === myUserId)?.nickname
            : undefined)?.trim() || nickname.trim();
          useRoomStore.getState().setNickname(resolvedNickname);
          if (lastJoinSession) {
            lastJoinSession = { ...lastJoinSession, nickname: resolvedNickname };
          }
        }
        return res;
      });

  }, []);

  const transferOwner = useCallback((userId: string): Promise<{ success: boolean; error?: string; message?: string }> => {
    return emitWithAck<{ success: boolean; error?: string; message?: string; room?: RoomState }>(
      'transfer_owner',
      { userId },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomAdmin = useCallback((userId: string, admin: boolean): Promise<{ success: boolean; error?: string; message?: string }> => {
    return emitWithAck<{ success: boolean; error?: string; message?: string; room?: RoomState }>(
      'set_room_admin',
      { userId, admin },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const kickUser = useCallback((userId: string): Promise<{ success: boolean; error?: string; message?: string }> => {
    return emitWithAck<{ success: boolean; error?: string; message?: string; room?: RoomState }>(
      'kick_user',
      { userId },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const renameRoomName = useCallback((name: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'rename_room',
      { name },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomLock = useCallback((locked: boolean, password?: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_lock',
      { locked, password },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomFmMode = useCallback((mode: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_fm_mode',
      { mode },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomAnnouncement = useCallback((options: { enabled?: boolean; text?: string }): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_announcement',
      options,
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setChatHistoryVisibleOnJoin = useCallback((enabled: boolean): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_chat_history',
      { enabled },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setSongRequestEnabled = useCallback((options: {
    enabled?: boolean;
    memberJumpEnabled?: boolean;
    memberSeekEnabled?: boolean;
    memberPauseEnabled?: boolean;
    systemMediaPlayBound?: boolean;
    systemMediaSkipBound?: boolean;
    dislikeSkipMode?: 'count' | 'percent';
    dislikeSkipThreshold?: number;
    dislikeSkipPercent?: number;
    clearSongsOnLeaveEnabled?: boolean;
    clearSongsOnLeaveDelaySec?: number;
    minStaySec?: number;
    maxPerUser?: number;
    cooldownSec?: number;
    queueMaxLength?: number;
  }): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_song_request',
      options,
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const banRoomSong = useCallback((song: Song): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'ban_room_song',
      { song },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const unbanRoomSong = useCallback((
    name: string,
  ): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'unban_room_song',
      { name },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomAudioQuality = useCallback((quality: { netease: string; tencent: string }): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_audio_quality',
      quality,
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomMemberTier = useCallback((
    userId: string,
    tier: { badgeLabel: string; badgeColor: string; borderStyleId: string; borderColor: string },
  ): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_member_tier',
      { userId, tier },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const removeRoomMemberTier = useCallback((userId: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'remove_room_member_tier',
      { userId },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomMemberSettings = useCallback((settings: {
    welcomeEnabled: boolean;
    welcomeTemplateId: string;
    welcomeCustomText?: string;
  }): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_member_settings',
      settings,
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setChatMute = useCallback((options: { muteAll?: boolean; userId?: string; muted?: boolean }): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_chat_mute',
      options,
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);



  const loadChatHistory = useCallback((before: number, beforeId: string): Promise<{
    success: boolean;
    messages?: ChatMessage[];
    hasMore?: boolean;
    error?: string;
  }> => {
    return emitWithAck<{ success: boolean; messages?: ChatMessage[]; hasMore?: boolean; error?: string }>(
      'load_chat_history',
      { before, beforeId, limit: 50 },
      { success: false, error: '连接超时，请重试' },
    );
  }, []);

  const loadSongHistory = useCallback((): Promise<{
    success: boolean;
    songs?: SongHistoryItem[];
    error?: string;
  }> => {
    const roomId = useRoomStore.getState().room?.id;
    if (!roomId) return Promise.resolve({ success: false, error: '未加入房间' });
    useSongHistoryStore.getState().setLoading(true);
    return emitWithAck<{ success: boolean; songs?: SongHistoryItem[]; error?: string }>(
      'load_song_history',
      { limit: 150 },
      { success: false, error: '连接超时，请重试' },
    )
      .then((res) => {
        if (useRoomStore.getState().room?.id !== roomId) {
          if (useSongHistoryStore.getState().roomId === roomId) {
            useSongHistoryStore.getState().setLoading(false);
          }
          return res;
        }
        if (res.success && res.songs) {
          useSongHistoryStore.getState().setSongs(roomId, res.songs);
        } else {
          useSongHistoryStore.getState().setLoading(false);
        }
        return res;
      });
  }, []);

  return {

    joinRoom,

    leaveRoom,

    addSong,

    skipSong,
    finishSong,

    togglePlay,

    seek,

    removeSong,

    clearQueue,

    requestJump,
    reorderQueue,
    toggleQueueLike,
    toggleCurrentDislike,

    approveJump,

    rejectJump,

    requestSkip,

    approveSkip,

    rejectSkip,

    sendChat,

    toggleChatReaction,

    recallChat,

    listFavorites,

    setFavorite,
    importFavorites,
    renameUser,

    kickUser,

    transferOwner,

    setRoomAdmin,

    renameRoomName,

    setRoomLock,

    setRoomFmMode,

    setRoomAnnouncement,

    setChatHistoryVisibleOnJoin,

    setSongRequestEnabled,

    banRoomSong,

    unbanRoomSong,

    setRoomAudioQuality,

    setRoomMemberTier,

    removeRoomMemberTier,

    setRoomMemberSettings,

    setChatMute,

    loadChatHistory,

    loadSongHistory,

    connect,

  };

}
