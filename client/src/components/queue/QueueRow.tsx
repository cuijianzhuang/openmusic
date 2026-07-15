import { memo } from 'react';
import { Trash2, Zap, ThumbsUp, AlertTriangle, Ban } from 'lucide-react';
import { getClientId } from '../../lib/clientId';
import { useTrackSourceError } from '../../hooks/useSongSourceError';
import type { RoomMemberTier, QueueItem } from '../../types';
import SongCover from '../SongCover';
import FavoriteButton from '../FavoriteButton';
import Tooltip from '../Tooltip';
import TruncateTip from '../TruncateTip';
import MemberQueueFrame from '../MemberQueueFrame';
import MemberTierBadge from '../MemberTierBadge';
import RoleBadge from '../RoleBadge';

export const QUEUE_ROW_HEIGHT = 64;
export const QUEUE_ROW_GAP = 6;
export const QUEUE_ITEM_SIZE = QUEUE_ROW_HEIGHT + QUEUE_ROW_GAP;

type QueueRowSong = QueueItem & { isCurrent: boolean };

interface Props {
  song: QueueRowSong;
  index: number;
  memberTier?: RoomMemberTier;
  mySocketId: string | null;
  nickname: string;
  canControlPlayback: boolean;
  memberJumpEnabled?: boolean;
  rowRef?: React.MutableRefObject<HTMLDivElement | null>;
  onLike: (queueId: string) => void;
  onJump: (queueId: string) => void;
  onRemove: (queueId: string) => void;
  onBan: (song: QueueRowSong) => void;
}

function QueueRow({
  song,
  index,
  memberTier,
  mySocketId,
  nickname,
  canControlPlayback,
  memberJumpEnabled = false,
  rowRef,
  onLike,
  onJump,
  onRemove,
  onBan,
}: Props) {
  const myUserId = mySocketId || getClientId();
  const isMine = !song.isCurrent && Boolean(myUserId && (
    song.requestedById === myUserId
    || (!song.requestedById && song.requestedBy === nickname)
  ));
  const likedByIds = Array.isArray(song.likedByIds) ? song.likedByIds : [];
  const likeCount = likedByIds.length;
  const likedByMe = Boolean(myUserId && likedByIds.includes(myUserId));
  const canJump = !song.isCurrent && (canControlPlayback || (isMine && memberJumpEnabled));
  const canRemove = !song.isCurrent && (canControlPlayback || isMine);
  const hasSourceError = useTrackSourceError(song);
  const isAdminPriority = Boolean(song.ownerPriority && song.priorityBy);
  const isOwnerPriority = Boolean(song.ownerPriority && !song.priorityBy);

  const rowInner = (
    <>
      <span className="w-5 text-center text-[11px] text-netease-muted flex-shrink-0">
        {song.isCurrent ? (
          <span className="inline-flex gap-0.5 items-end h-3.5">
            <span className="w-0.5 h-1.5 bg-netease-red animate-pulse" />
            <span className="w-0.5 h-2.5 bg-netease-red animate-pulse delay-75" />
            <span className="w-0.5 h-1 bg-netease-red animate-pulse delay-150" />
          </span>
        ) : (
          index
        )}
      </span>
      <SongCover
        song={song}
        size="tiny"
        className="w-11 h-11 rounded-lg object-cover bg-netease-card flex-shrink-0"
      />
      <div className="flex-1 min-w-0 self-stretch flex flex-col justify-center gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <TruncateTip
            text={song.name}
            as="p"
            className={`min-w-0 flex-1 text-sm leading-5 truncate ${
              song.isCurrent ? 'text-netease-red font-medium' : 'text-white/92'
            }`}
          />
          {hasSourceError && (
            <Tooltip content="歌曲源异常，将跳过此歌" side="bottom">
              <span className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-md border border-red-500/40 bg-red-500/15 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium leading-tight text-red-400 max-w-[9rem] sm:max-w-none">
                <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                <span className="truncate sm:whitespace-nowrap">歌曲源异常，将跳过此歌</span>
              </span>
            </Tooltip>
          )}
          {isOwnerPriority && <RoleBadge role="owner" />}
          {isAdminPriority && (
            <TruncateTip
              text={song.priorityBy!}
              as="span"
              className="flex-shrink-0 max-w-[4.5rem] rounded-full bg-sky-400/15 px-1.5 py-0 text-[9px] leading-4 text-sky-300 truncate"
            />
          )}
          {memberTier && <MemberTierBadge tier={memberTier} />}
          <FavoriteButton
            song={song}
            className="w-7 h-7 text-netease-muted hover:text-rose-300"
            iconClassName="w-3.5 h-3.5"
          />
          {!song.isCurrent && (
            <div className="flex flex-shrink-0 items-center gap-0.5">
              <Tooltip content={likedByMe ? '取消点赞' : '点赞提高排序'}>
                <button
                  type="button"
                  onClick={() => onLike(song.queueId)}
                  className={`flex min-w-7 items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[11px] transition-colors ${
                    likedByMe
                      ? 'bg-netease-red/10 text-netease-red'
                      : 'text-netease-muted hover:bg-white/10 hover:text-white'
                  }`}
                  aria-label={likedByMe ? '取消点赞' : '点赞'}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                  {likeCount > 0 && <span>{likeCount}</span>}
                </button>
              </Tooltip>
              {canJump && (
                <Tooltip content={canControlPlayback ? '管理员插队，优先于点赞排序' : '插队到下一首'}>
                  <button
                    type="button"
                    onClick={() => onJump(song.queueId)}
                    className="rounded-lg p-1 text-amber-400/75 transition-colors hover:bg-amber-400/10 hover:text-amber-300"
                    aria-label="插队"
                  >
                    <Zap className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              )}
              {canRemove && (
                <Tooltip content={canControlPlayback && !isMine ? '移除歌曲' : '删除我的点歌'}>
                  <button
                    type="button"
                    onClick={() => onRemove(song.queueId)}
                    className="rounded-lg p-1 text-netease-muted transition-colors hover:bg-netease-red/10 hover:text-netease-red"
                    aria-label="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              )}
              {canControlPlayback && !song.isCurrent && (
                <Tooltip content="禁播此歌">
                  <button
                    type="button"
                    onClick={() => onBan(song)}
                    className="rounded-lg p-1 text-netease-muted transition-colors hover:bg-amber-400/10 hover:text-amber-300"
                    aria-label="禁播"
                  >
                    <Ban className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] leading-4 text-netease-muted min-w-0">
          <TruncateTip text={song.artist} className="min-w-0 truncate" />
          {!song.isCurrent && song.requestedBy && (
            <TruncateTip
              text={`${song.requestedBy}点的歌`}
              className="min-w-0 truncate text-netease-muted/65"
            />
          )}
        </div>
      </div>
    </>
  );

  if (memberTier) {
    const memberInnerClassName = song.isCurrent ? 'bg-netease-red/10' : 'bg-transparent';
    return (
      <MemberQueueFrame variant="queue" tier={memberTier} innerClassName={memberInnerClassName}>
        <div
          ref={rowRef}
          className="group flex items-center gap-2.5 px-2.5 py-2 transition-colors hover:bg-netease-card/80"
          style={{ minHeight: QUEUE_ROW_HEIGHT }}
        >
          {rowInner}
        </div>
      </MemberQueueFrame>
    );
  }

  return (
    <div
      ref={rowRef}
      className={`group flex items-center gap-2.5 px-2.5 py-2 transition-colors rounded-xl border ${
        song.isCurrent
          ? 'bg-netease-red/10 border-netease-red/25'
          : isAdminPriority
            ? 'bg-sky-400/10 border border-sky-400/20 hover:bg-sky-400/15'
            : isOwnerPriority
              ? 'bg-amber-400/10 border border-amber-400/20 hover:bg-amber-400/15'
              : 'bg-netease-card/35 border-transparent hover:bg-netease-card/80'
      }`}
      style={{ minHeight: QUEUE_ROW_HEIGHT }}
    >
      {rowInner}
    </div>
  );
}

export default memo(QueueRow);
