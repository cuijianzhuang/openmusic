import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';
import { useChatStore } from '../stores/chatStore';
import { getSharedAudio } from './audioElement';
import { canSyncAudioForQueue, getAudioBoundQueueId } from './audioTrackBinding';
import { getClientId } from './clientId';
import {
  getClientPlaybackState,
  getPlaybackSnapshotTiming,
  getPlaybackTime,
} from './playbackState';
import { formatDriftHistogram, resetDriftHistogram } from './driftHistogram';
import { isAudioBuffering } from './audioBuffering';
import {
  isInsecureRemoteMediaUrl,
  isProxiedMediaUrl,
  unwrapProxiedMediaUrl,
} from './mediaProxyUrl';
import { isTrackSourceError } from './songPreloadCache';
import type { QueueItem } from '../types';

const DEBUG_FLAG_KEY = 'openmusic:debug';
const DEBUG_INTERVAL_MS = 2000;
const MAX_EVENTS = 120;
const ERROR_REPORT_EVENT_LIMIT = 40;
const ERROR_REPORT_SNAPSHOT_COUNT = 5;
const ERROR_REPORT_SNAPSHOT_INTERVAL_MS = 400;

type DebugEvent = {
  at: string;
  name: string;
  line: string;
};

type SocketSnapshot = {
  id?: string;
  connected?: boolean;
  transport?: string;
};

const state = {
  enabled: false,
  timer: 0,
  events: [] as DebugEvent[],
  getSocket: null as null | (() => SocketSnapshot | null),
};

function nowLabel(): string {
  return new Date().toISOString().slice(11, 23);
}

function fmtNum(value: number | null | undefined, digits = 3): string {
  return Number.isFinite(value) ? Number(value!.toFixed(digits)).toString() : 'null';
}

/** key=value 单行，便于整段复制 */
export function debugLine(parts: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(parts)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v ?? 'null'}`)
    .join(' ');
}

export function debugLog(name: string, line?: string): void {
  const text = line ?? '';
  const event: DebugEvent = { at: nowLabel(), name, line: text };
  state.events.push(event);
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS);
  }
  if (state.enabled) {
    console.log(text ? `[openmusic:${name}] ${text}` : `[openmusic:${name}]`);
  }
}

function shortSrc(src: string): string {
  if (!src) return '';
  try {
    const url = new URL(src);
    return `${url.host}${url.pathname.slice(0, 24)}…`;
  } catch {
    return src.slice(0, 48);
  }
}

function readyStateLabel(state: number): string {
  switch (state) {
    case HTMLMediaElement.HAVE_NOTHING: return 'HAVE_NOTHING';
    case HTMLMediaElement.HAVE_METADATA: return 'HAVE_METADATA';
    case HTMLMediaElement.HAVE_CURRENT_DATA: return 'HAVE_CURRENT_DATA';
    case HTMLMediaElement.HAVE_FUTURE_DATA: return 'HAVE_FUTURE_DATA';
    case HTMLMediaElement.HAVE_ENOUGH_DATA: return 'HAVE_ENOUGH_DATA';
    default: return `unknown(${state})`;
  }
}

function networkStateLabel(state: number): string {
  switch (state) {
    case HTMLMediaElement.NETWORK_EMPTY: return 'NETWORK_EMPTY';
    case HTMLMediaElement.NETWORK_IDLE: return 'NETWORK_IDLE';
    case HTMLMediaElement.NETWORK_LOADING: return 'NETWORK_LOADING';
    case HTMLMediaElement.NETWORK_NO_SOURCE: return 'NETWORK_NO_SOURCE';
    default: return `unknown(${state})`;
  }
}

function mediaErrorLabel(error: MediaError | null): string | null {
  if (!error) return null;
  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED: return 'MEDIA_ERR_ABORTED';
    case MediaError.MEDIA_ERR_NETWORK: return 'MEDIA_ERR_NETWORK';
    case MediaError.MEDIA_ERR_DECODE: return 'MEDIA_ERR_DECODE';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: return 'MEDIA_ERR_SRC_NOT_SUPPORTED';
    default: return `unknown(${error.code})`;
  }
}

function upstreamHostOf(src: string): string | null {
  if (!src) return null;
  const raw = isProxiedMediaUrl(src) ? unwrapProxiedMediaUrl(src) : src;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

function formatBufferedAhead(audio: HTMLAudioElement): string {
  const ranges = audio.buffered;
  if (!ranges || ranges.length === 0) return '0';
  let maxEnd = 0;
  for (let i = 0; i < ranges.length; i += 1) {
    maxEnd = Math.max(maxEnd, ranges.end(i));
  }
  const aheadSec = Math.max(0, maxEnd - audio.currentTime);
  return `${fmtNum(aheadSec)}s/${ranges.length}rng`;
}

function formatAudioSnapshot(
  audio: HTMLAudioElement,
  audioStore: ReturnType<typeof useAudioStore.getState>,
  current: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'> | null | undefined,
): string[] {
  const src = audio.currentSrc || audio.src || '';
  const boundQueueId = getAudioBoundQueueId(audio);
  const lines: string[] = [];

  lines.push(debugLine({
    audioBound: boundQueueId || null,
    audioBindMatch: current ? boundQueueId === current.queueId : null,
    audioCanSync: current ? canSyncAudioForQueue(audio, current.queueId) : null,
    audioTime: fmtNum(audio.currentTime),
    audioDuration: fmtNum(audio.duration),
    audioPaused: audio.paused,
    audioEnded: audio.ended,
    audioSeeking: audio.seeking,
    audioReadyState: `${audio.readyState}:${readyStateLabel(audio.readyState)}`,
    audioNetworkState: `${audio.networkState}:${networkStateLabel(audio.networkState)}`,
    audioRate: fmtNum(audio.playbackRate),
    audioMuted: audio.muted,
    audioVolume: fmtNum(audioStore.volume),
    audioBuffering: isAudioBuffering(audio),
    audioBufferedAhead: formatBufferedAhead(audio),
    trackLoading: audioStore.trackLoading,
    needsUnlock: audioStore.needsAudioUnlock,
    smoothTime: fmtNum(audioStore.smoothPlaybackTime),
    playbackVersion: audioStore.playbackVersion,
    trackReloadNonce: audioStore.trackReloadNonce,
  }));

  lines.push(debugLine({
    audioSrc: shortSrc(src),
    audioSrcProxied: src ? isProxiedMediaUrl(src) : null,
    audioSrcInsecureUpstream: src ? isInsecureRemoteMediaUrl(
      isProxiedMediaUrl(src) ? unwrapProxiedMediaUrl(src) : src,
    ) : null,
    audioUpstreamHost: upstreamHostOf(src),
    audioCrossOrigin: audio.crossOrigin || 'default',
    audioPreload: audio.preload,
    audioError: mediaErrorLabel(audio.error),
    trackSourceError: current ? isTrackSourceError(current) : null,
    trackOriginalUrl: current?.url ? shortSrc(current.url) : null,
    lrcDurationMs: audioStore.lrcDurationMs,
    mediaDurationMs: audioStore.mediaDurationMs,
  }));

  if (src) {
    lines.push(`audioSrcFull=${src}`);
  }

  return lines;
}

export type ErrorReportSnapshotSection = {
  id: string;
  title: string;
  content: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatSnapshotText(reason: string): string {
  const lines: string[] = [];
  const at = new Date().toISOString();
  lines.push(`--- openmusic debug ${reason} ${at} ---`);

  const socket = state.getSocket?.();
  lines.push(debugLine({
    href: location.href,
    clientId: getClientId(),
    socketId: socket?.id ?? null,
    socketConnected: socket?.connected ?? null,
    socketTransport: socket?.transport ?? null,
    hidden: document.hidden,
    visibility: document.visibilityState,
    online: navigator.onLine,
  }));

  const { room, nickname, mySocketId, isOwner } = useRoomStore.getState();
  lines.push(debugLine({
    roomId: room?.id ?? null,
    roomName: room?.name ?? null,
    nickname,
    mySocketId,
    isOwner,
    isPlaying: room?.isPlaying ?? null,
    roomCurrentTime: fmtNum(room?.currentTime),
    users: room?.users?.length ?? 0,
    queueLen: room?.queue?.length ?? 0,
    chatMsgs: useChatStore.getState().messages.length,
  }));

  if (room?.current) {
    lines.push(debugLine({
      trackQueueId: room.current.queueId,
      trackId: room.current.id,
      trackSource: room.current.source,
      trackName: room.current.name,
      trackArtist: room.current.artist ?? null,
      trackAlbum: room.current.album ?? null,
      trackDuration: room.current.duration ?? null,
    }));
    if (room.current.url) lines.push(`trackUrlFull=${room.current.url}`);
  }

  const audio = getSharedAudio();
  const audioStore = useAudioStore.getState();
  lines.push(...formatAudioSnapshot(audio, audioStore, room?.current));

  const pb = getClientPlaybackState();
  if (pb) {
    const derived = getPlaybackTime(pb);
    const driftMs = audio.ended
      ? 'inf'
      : Math.round((derived - audio.currentTime) * 1000);
    const timing = getPlaybackSnapshotTiming();
    const serverNowMs = Number(pb.serverNowMs);
    const clockSkewMs = Number.isFinite(serverNowMs) && serverNowMs > 0
      ? Math.round(Date.now() - serverNowMs)
      : null;
    lines.push(debugLine({
      pbVersion: pb.version,
      pbTrackId: pb.trackId,
      pbStatus: pb.status,
      pbPositionSec: fmtNum(pb.positionSec),
      pbDurationSec: fmtNum(pb.durationSec),
      pbDerivedSec: fmtNum(derived),
      pbDriftMs: driftMs,
      pbStartedAt: pb.startedAt || 0,
      pbServerNowMs: pb.serverNowMs,
      pbReceivedAt: timing?.receivedAt ?? pb.receivedAt,
      pbCommittedAt: timing?.committedAt ?? pb.committedAt,
      snapshotAgeMs: timing?.snapshotAgeMs ?? null,
      clockSkewMs,
    }));
  } else {
    lines.push('playback_state=null');
  }

  lines.push(formatDriftHistogram());

  const recent = state.events.slice(reason === 'report' ? -ERROR_REPORT_EVENT_LIMIT : -12);
  if (recent.length > 0) {
    lines.push('recent_events:');
    for (const e of recent) {
      lines.push(`  ${e.at} ${e.name} ${e.line}`.trimEnd());
    }
  }

  lines.push('--- end ---');
  return lines.join('\n');
}

export function getDebugSnapshot(): string {
  return formatSnapshotText('snapshot');
}

export function getDebugEvents(): DebugEvent[] {
  return state.events.slice();
}

export type ErrorReportType = 'error' | 'feedback';

function buildErrorReportMeta(): Record<string, string | number | boolean | null> {
  const { room, nickname, mySocketId, avatar_url, isOwner } = useRoomStore.getState();
  const current = room?.current;
  const audioStore = useAudioStore.getState();
  const audio = getSharedAudio();
  const audioSrc = audio.currentSrc || audio.src || '';
  const socket = state.getSocket?.();
  const trackKey = current ? `${current.source}-${current.id}` : null;

  return {
    href: typeof location !== 'undefined' ? location.href : '',
    clientId: getClientId(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : '',
    language: typeof navigator !== 'undefined' ? navigator.language : '',
    online: typeof navigator !== 'undefined' ? navigator.onLine : null,
    hidden: typeof document !== 'undefined' ? document.hidden : null,
    visibility: typeof document !== 'undefined' ? document.visibilityState : null,
    roomId: room?.id ?? null,
    roomName: room?.name ?? null,
    nickname: nickname || null,
    mySocketId: mySocketId || null,
    isOwner: isOwner ?? null,
    avatar_url: avatar_url || null,
    socketConnected: socket?.connected ?? null,
    socketId: socket?.id ?? null,
    socketTransport: socket?.transport ?? null,
    trackQueueId: current?.queueId ?? null,
    trackName: current?.name ?? null,
    trackArtist: current?.artist ?? null,
    trackAlbum: current?.album ?? null,
    trackSource: current?.source ?? null,
    trackId: current?.id ?? null,
    trackUrl: current?.url ?? null,
    trackPic: current?.pic ?? null,
    trackDuration: current?.duration ?? null,
    trackActualQuality: trackKey ? (audioStore.actualQualityByTrack[trackKey] ?? null) : null,
    audioSrc: audioSrc || null,
    isPlaying: room?.isPlaying ?? null,
    roomCurrentTime: room?.currentTime ?? null,
    queueLen: room?.queue?.length ?? 0,
    trackLoading: audioStore.trackLoading,
    needsAudioUnlock: audioStore.needsAudioUnlock,
    trackSourceError: current ? isTrackSourceError(current) : null,
    lrcDurationMs: audioStore.lrcDurationMs,
    mediaDurationMs: audioStore.mediaDurationMs,
  };
}

/** 错误上报：连续采集多份完整 debug 快照 */
async function collectReportSnapshots(): Promise<ErrorReportSnapshotSection[]> {
  const snapshots: ErrorReportSnapshotSection[] = [];
  for (let i = 0; i < ERROR_REPORT_SNAPSHOT_COUNT; i += 1) {
    if (i > 0) {
      await sleep(ERROR_REPORT_SNAPSHOT_INTERVAL_MS);
    }
    snapshots.push({
      id: `snapshot-${i + 1}`,
      title: `快照 ${i + 1}`,
      content: formatSnapshotText(`report-${i + 1}`),
    });
  }
  return snapshots;
}

/** 错误上报用：快照 + 最近事件 + 基础环境信息 */
export async function collectErrorReportBundle(
  description = '',
  type: ErrorReportType = 'error',
): Promise<{
  type: ErrorReportType;
  description: string;
  snapshot: string;
  snapshots: ErrorReportSnapshotSection[];
  events: DebugEvent[];
  meta: Record<string, string | number | boolean | null>;
}> {
  const meta = buildErrorReportMeta();
  if (type === 'feedback') {
    return {
      type: 'feedback',
      description: String(description || '').trim().slice(0, 500),
      snapshot: '',
      snapshots: [],
      events: [],
      meta,
    };
  }
  const snapshots = await collectReportSnapshots();
  const snapshot = snapshots
    .map((section) => `=== ${section.title} ===\n${section.content}`)
    .join('\n\n')
    .slice(0, 64_000);
  return {
    type: 'error',
    description: String(description || '').trim().slice(0, 500),
    snapshot,
    snapshots,
    events: state.events.slice(-80),
    meta,
  };
}

function printSnapshot(reason = 'tick'): void {
  console.log(formatSnapshotText(reason));
}

function printDriftHistogram(): void {
  console.log(formatDriftHistogram());
}

/** URL ?debug=1 或 ?om_debug=1 自动开启（并从地址栏移除参数） */
function consumeDebugUrlParam(): boolean {
  try {
    const params = new URLSearchParams(location.search);
    const enabled = params.get('debug') === '1' || params.get('om_debug') === '1';
    if (!enabled) return false;
    params.delete('debug');
    params.delete('om_debug');
    const query = params.toString();
    const next = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
    history.replaceState(null, '', next);
    return true;
  } catch {
    return false;
  }
}

export function setDebugSocketProvider(provider: () => SocketSnapshot | null): void {
  state.getSocket = provider;
}

export function enableOpenMusicDebug(): void {
  if (state.enabled) {
    printSnapshot('already-on');
    return;
  }
  state.enabled = true;
  localStorage.setItem(DEBUG_FLAG_KEY, '1');
  printSnapshot('enabled');
  state.timer = window.setInterval(() => printSnapshot('tick'), DEBUG_INTERVAL_MS);
}

export function disableOpenMusicDebug(): void {
  state.enabled = false;
  localStorage.removeItem(DEBUG_FLAG_KEY);
  if (state.timer) window.clearInterval(state.timer);
  state.timer = 0;
  resetDriftHistogram();
  console.log('[openmusic:debug] disabled');
}

export function installOpenMusicDebug(): void {
  const target = window as typeof window & {
    debug?: () => void;
    debugOff?: () => void;
    debugNow?: () => void;
    debugHist?: () => void;
    debugHistReset?: () => void;
    openMusicDebug?: {
      on: () => void;
      off: () => void;
      now: () => void;
      hist: () => void;
      histReset: () => void;
      snapshot: typeof getDebugSnapshot;
      event: typeof debugLog;
    };
  };

  target.debug = enableOpenMusicDebug;
  target.debugOff = disableOpenMusicDebug;
  target.debugNow = () => printSnapshot('manual');
  target.debugHist = printDriftHistogram;
  target.debugHistReset = () => {
    resetDriftHistogram();
    console.log('[openmusic:debug] drift histogram reset');
  };
  target.openMusicDebug = {
    on: enableOpenMusicDebug,
    off: disableOpenMusicDebug,
    now: target.debugNow,
    hist: target.debugHist,
    histReset: target.debugHistReset,
    snapshot: getDebugSnapshot,
    event: debugLog,
  };

  window.addEventListener('visibilitychange', () => {
    debugLog('visibilitychange', debugLine({
      hidden: document.hidden,
      visibility: document.visibilityState,
    }));
  });
  window.addEventListener('online', () => debugLog('online'));
  window.addEventListener('offline', () => debugLog('offline'));
  window.addEventListener('error', (event) => {
    debugLog('window-error', debugLine({
      message: event.message,
      file: event.filename,
      line: event.lineno,
      col: event.colno,
    }));
  });
  window.addEventListener('unhandledrejection', (event) => {
    debugLog('unhandled-rejection', String(event.reason));
  });

  if (localStorage.getItem(DEBUG_FLAG_KEY) === '1' || consumeDebugUrlParam()) {
    enableOpenMusicDebug();
  }
}

export { resetDriftHistogram };
