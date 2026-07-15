import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Music } from 'lucide-react';
import { useRoomStore } from '../stores/roomStore';
import { useSocket } from '../hooks/useSocket';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import QueueRow, { QUEUE_ITEM_SIZE, QUEUE_ROW_GAP, QUEUE_ROW_HEIGHT } from './queue/QueueRow';
import type { RoomMemberTier, QueueItem } from '../types';

const VISIBLE_ROWS = 3;
const LIST_HEIGHT = VISIBLE_ROWS * QUEUE_ROW_HEIGHT + (VISIBLE_ROWS - 1) * QUEUE_ROW_GAP;
const VIRTUAL_THRESHOLD = 8;

type QueueRowSong = QueueItem & { isCurrent: boolean };

type RowData = {
  songs: QueueRowSong[];
  memberTiers: Record<string, RoomMemberTier> | undefined;
  mySocketId: string | null;
  nickname: string;
  canControlPlayback: boolean;
  memberJumpEnabled: boolean;
  currentRef: React.RefObject<HTMLDivElement | null>;
  onLike: (queueId: string) => void;
  onJump: (queueId: string) => void;
  onRemove: (queueId: string) => void;
  onBan: (song: QueueRowSong) => void;
};

function VirtualQueueRow({ index, style, data }: ListChildComponentProps<RowData>) {
  const song = data.songs[index];
  if (!song) return null;
  const memberTier = song.requestedById ? data.memberTiers?.[song.requestedById] : undefined;
  return (
    <div style={{ ...style, height: QUEUE_ITEM_SIZE, paddingBottom: QUEUE_ROW_GAP }}>
      <QueueRow
        song={song}
        index={index}
        memberTier={memberTier}
        mySocketId={data.mySocketId}
        nickname={data.nickname}
        canControlPlayback={data.canControlPlayback}
        memberJumpEnabled={data.memberJumpEnabled}
        rowRef={song.isCurrent ? data.currentRef : undefined}
        onLike={data.onLike}
        onJump={data.onJump}
        onRemove={data.onRemove}
        onBan={data.onBan}
      />
    </div>
  );
}

interface Props {
  fillHeight?: boolean;
}

export default function QueuePanel({ fillHeight = false }: Props) {
  const queue = useRoomStore((s) => s.room?.queue);
  const currentSong = useRoomStore((s) => s.room?.current);
  const memberTiers = useRoomStore((s) => s.room?.memberTiers);
  const hasRoom = useRoomStore((s) => Boolean(s.room));
  const nickname = useRoomStore((s) => s.nickname);
  const mySocketId = useRoomStore((s) => s.mySocketId);
  const canControlPlayback = useRoomStore((s) => s.canControlPlayback);
  const memberJumpEnabled = useRoomStore((s) => Boolean(s.room?.memberJumpEnabled));
  const { removeSong, requestJump, toggleQueueLike, banRoomSong } = useSocket();
  const [jumpMsg, setJumpMsg] = useState('');
  const currentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<FixedSizeList>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [virtualListHeight, setVirtualListHeight] = useState(LIST_HEIGHT);

  const allSongs = useMemo<QueueRowSong[]>(() => {
    return [
      ...(currentSong ? [{ ...currentSong, isCurrent: true }] : []),
      ...(queue || []).map((s) => ({ ...s, isCurrent: false })),
    ];
  }, [queue, currentSong]);

  const currentKey = currentSong?.queueId || '';
  const useVirtualList = allSongs.length >= VIRTUAL_THRESHOLD;
  const prevCurrentKeyRef = useRef(currentKey);

  useEffect(() => {
    if (!fillHeight || !useVirtualList) return;
    const container = listContainerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.height ?? 0);
      if (next > 0) setVirtualListHeight(next);
    });
    ro.observe(container);
    setVirtualListHeight(Math.floor(container.clientHeight));
    return () => ro.disconnect();
  }, [fillHeight, useVirtualList]);

  // 仅在「当前曲目切换」时跟滚；点赞/插队等队列重排不要拽回顶部
  useEffect(() => {
    const switched = prevCurrentKeyRef.current !== currentKey;
    prevCurrentKeyRef.current = currentKey;
    if (!switched || !currentKey) return;

    if (useVirtualList) {
      const idx = allSongs.findIndex((song) => song.isCurrent);
      if (idx >= 0) listRef.current?.scrollToItem(idx, 'smart');
      return;
    }
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentKey, allSongs, useVirtualList]);

  const showQueueMessage = useCallback((message: string) => {
    setJumpMsg(message);
    setTimeout(() => setJumpMsg(''), 3000);
  }, []);

  const handleJumpRequest = useCallback(async (queueId: string) => {
    setJumpMsg('');
    const res = await requestJump(queueId);
    if (res.success) {
      showQueueMessage(canControlPlayback ? '已插队到下一首，优先于点赞排序' : '已插队到下一首');
    } else {
      showQueueMessage(res.error || '插队失败');
    }
  }, [canControlPlayback, requestJump, showQueueMessage]);

  const handleLike = useCallback(async (queueId: string) => {
    const res = await toggleQueueLike(queueId);
    if (!res.success && res.error) showQueueMessage(res.error);
  }, [showQueueMessage, toggleQueueLike]);

  const handleBanSong = useCallback(async (song: QueueRowSong) => {
    setJumpMsg('');
    const res = await banRoomSong({
      id: song.id,
      source: song.source || 'netease',
      name: song.name,
      artist: song.artist,
      album: song.album,
      pic: song.pic,
      duration: song.duration,
      url: song.url,
      lrc: song.lrc,
    });
    if (res.success) {
      showQueueMessage('已禁播并移出队列');
    } else {
      showQueueMessage(res.error || '禁播失败');
    }
  }, [banRoomSong, showQueueMessage]);

  const rowData = useMemo<RowData>(() => ({
    songs: allSongs,
    memberTiers,
    mySocketId,
    nickname,
    canControlPlayback,
    memberJumpEnabled,
    currentRef,
    onLike: handleLike,
    onJump: handleJumpRequest,
    onRemove: removeSong,
    onBan: handleBanSong,
  }), [
    allSongs,
    memberTiers,
    mySocketId,
    nickname,
    canControlPlayback,
    memberJumpEnabled,
    handleLike,
    handleJumpRequest,
    removeSong,
    handleBanSong,
  ]);

  if (!hasRoom) return null;

  if (allSongs.length === 0) {
    return (
      <div
        className={`flex flex-col items-center justify-center text-netease-muted ${
          fillHeight ? 'flex-1 min-h-0' : ''
        }`}
        style={fillHeight ? undefined : { height: LIST_HEIGHT }}
      >
        <Music className="w-7 h-7 mb-2 opacity-30" />
        <p className="text-xs text-center">队列为空，搜索或双击点歌</p>
      </div>
    );
  }

  const renderPlainRows = () => allSongs.map((song, i) => (
    <QueueRow
      key={song.queueId || `current-${song.id}`}
      song={song}
      index={i}
      memberTier={song.requestedById ? memberTiers?.[song.requestedById] : undefined}
      mySocketId={mySocketId}
      nickname={nickname}
      canControlPlayback={canControlPlayback}
      memberJumpEnabled={memberJumpEnabled}
      rowRef={song.isCurrent ? currentRef : undefined}
      onLike={handleLike}
      onJump={handleJumpRequest}
      onRemove={removeSong}
      onBan={handleBanSong}
    />
  ));

  return (
    <div className={`flex flex-col ${fillHeight ? 'h-full min-h-0' : ''}`}>
      {jumpMsg && (
        <p className="text-xs text-amber-400/80 mb-1.5 px-1 flex-shrink-0">{jumpMsg}</p>
      )}

      {useVirtualList ? (
        <div
          ref={listContainerRef}
          className={`pr-0.5 ${fillHeight ? 'flex-1 min-h-0' : ''}`}
          style={fillHeight ? undefined : { height: LIST_HEIGHT }}
        >
          <FixedSizeList
            ref={listRef}
            height={fillHeight ? virtualListHeight : LIST_HEIGHT}
            width="100%"
            itemCount={allSongs.length}
            itemSize={QUEUE_ITEM_SIZE}
            itemData={rowData}
            itemKey={(index, data) => data.songs[index]?.queueId ?? index}
            overscanCount={4}
          >
            {VirtualQueueRow}
          </FixedSizeList>
        </div>
      ) : (
        <div
          className={`space-y-1.5 overflow-y-auto pr-0.5 ${fillHeight ? 'flex-1 min-h-0' : ''}`}
          style={fillHeight ? undefined : { height: LIST_HEIGHT }}
        >
          {renderPlainRows()}
        </div>
      )}
    </div>
  );
}
