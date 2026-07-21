export type MusicSource = 'netease' | 'tencent' | 'kugou';

export interface RoomAudioQuality {
  netease: string;
  tencent: string;
}

export interface RoomMemberTier {
  userId: string;
  badgeLabel: string;
  badgeColor: string;
  borderStyleId: string;
  borderColor: string;
  assignedAt?: number;
}

export interface RoomMemberSettings {
  welcomeEnabled: boolean;
  welcomeTemplateId: string;
  welcomeCustomText?: string;
}

export interface Song {
  id: string;
  source: MusicSource;
  name: string;
  artist: string;
  album?: string;
  pic?: string;
  duration?: number;
  /** 直链播放地址（蓝点等） */
  url?: string;
  /** 歌词文本或歌词 API 地址 */
  lrc?: string;
}

export interface QueueItem extends Song {
  queueId: string;
  requestedBy: string;
  requestedById?: string;
  addedAt: number;
  likedByIds?: string[];
  /** 当前曲被踩的人（仅对正在播放有效，切歌后清空） */
  dislikedByIds?: string[];
  ownerPriority?: number;
  /** 管理员插队置顶的操作者昵称 */
  priorityBy?: string;
  /** 拖拽排序后的锁定序号（服务端排序用，客户端可不展示） */
  manualOrder?: number;
}

export interface SongHistoryItem extends Song {
  requestedBy: string;
  requestedById?: string;
  requestedAt: number;
}

export interface BannedSong {
  source: MusicSource;
  id: string;
  name: string;
  artist: string;
  bannedAt?: number;
}

export interface RoomUser {
  id: string;
  nickname: string;
  readOnly?: boolean;
  joinedAt: number;
  location?: string;
  avatar_url?: string;
}

export interface JumpRequest {
  id: string;
  queueId: string;
  songName: string;
  nickname: string;
  requestedBy: string;
  requestedAt: number;
}

export interface ChatMention {
  id: string;
  nickname: string;
}

export interface ChatReplyRef {
  id: string;
  userId: string;
  nickname: string;
  text: string;
  imageUrl?: string | null;
  imageKey?: string | null;
  asSticker?: boolean;
}

export interface ChatReactionUser {
  userId: string;
  nickname: string;
}

export interface ChatReactionGroup {
  emoji: string;
  users: ChatReactionUser[];
}

export interface ChatMessage {
  id: string;
  userId: string;
  nickname: string;
  text: string;
  imageUrl?: string | null;
  imageKey?: string | null;
  asSticker?: boolean;
  kind?: 'chat' | 'welcome' | 'system' | 'notice' | 'recall';
  mentions?: ChatMention[];
  replyTo?: ChatReplyRef | null;
  timestamp: number;
  reactions?: ChatReactionGroup[];
  memberTier?: Pick<RoomMemberTier, 'badgeLabel' | 'badgeColor' | 'borderStyleId' | 'borderColor'>;
  targetUserId?: string;
  targetNickname?: string;
}

export interface SkipRequest {
  id: string;
  songName: string;
  nickname: string;
  requestedBy: string;
  requestedAt: number;
}

export interface RoomState {
  id: string;
  name: string;
  hasPassword?: boolean;
  isLocked?: boolean;
  muteAll?: boolean;
  mutedUserIds?: string[];
  /** 仅加入时由服务端按当前用户计算；广播更新请用 isChatMutedForUser */
  chatMuted?: boolean;
  ownerId: string | null;
  /** 房间初创房主（可通过转让变更；唯一显示「房主」） */
  creatorId?: string | null;
  /** 管理员（最多 5 人，仅房主指定的正式管理） */
  adminIds?: string[];
  /** 临时自动提升管理（仅播放权，不含管理敏感字段） */
  autoPromotedAdminIds?: string[];
  /** 曾进房用户的最近昵称（用于离线管理员展示） */
  userNicknames?: Record<string, string>;
  /** 用户头像 URL（所有用户可见） */
  userAvatarUrls?: Record<string, string>;
  ownerConnectionId?: string | null;
  queue: QueueItem[];
  current: QueueItem | null;
  isPlaying: boolean;
  currentTime: number;
  users: RoomUser[];
  userCount: number;
  jumpRequests: JumpRequest[];
  skipRequests: SkipRequest[];
  messages?: ChatMessage[];
  /** 非 null 时仅能看到该时间戳之后的消息（首次进入且未发言的新用户） */
  chatVisibleSince?: number | null;
  /** @deprecated 不再随 room_update 广播，由 chatStore 维护 */
  chatHasMore?: boolean;
  /** @deprecated 不再随 room_update 广播，按需 load_song_history */
  songHistory?: SongHistoryItem[];
  /** 队列为空时服务端已预取的下一首私人漫游（含稳定 queueId，便于客户端预拉 URL） */
  nextRandom?: QueueItem | null;
  /** 服务端正在为空队列拉取私人漫游 */
  randomLoading?: boolean;
  /** 房间播放音质（红点 / 绿点） */
  audioQuality?: RoomAudioQuality;
  /** 播放顺序：顺序 / 随机 / 单曲循环 / 列表循环 */
  playMode?: 'order' | 'shuffle' | 'loop-one' | 'loop-all';
  /** 队列为空时私人漫游推荐模式 */
  neteaseFmMode?: string;
  /** 漫游关闭前的模式，重新开启时恢复 */
  fmModeBeforeOff?: string;
  /** 公告是否开启 */
  announcementEnabled?: boolean;
  /** 公告内容 */
  announcementText?: string;
  /** 进房是否可查看聊天历史（关闭时仅见进房后的消息） */
  chatHistoryVisibleOnJoin?: boolean;
  /** 是否在聊天室提示“昵称进入房间” */
  joinNoticeEnabled?: boolean;
  /** 同一用户进房提醒的防重复间隔（秒），默认 180 */
  joinNoticeCooldownSec?: number;
  /** 是否允许成员点歌（关闭后仅房主/管理员可点） */
  songRequestEnabled?: boolean;
  /** 是否允许成员为自己的点歌插队（默认关闭，房主/管理员始终可插队） */
  memberJumpEnabled?: boolean;
  /** 是否允许成员拖动进度条（默认关闭，房主/管理员始终可） */
  memberSeekEnabled?: boolean;
  /** 是否允许成员暂停/播放（默认关闭，房主/管理员始终可） */
  memberPauseEnabled?: boolean;
  /** 是否绑定系统媒体键播放/暂停（耳机键、锁屏控件等；关闭可防摘耳机误触） */
  systemMediaPlayBound?: boolean;
  /** 是否绑定系统媒体键切歌（耳机键、锁屏下一首等） */
  systemMediaSkipBound?: boolean;
  /** 踩歌切歌模式：固定人数或在线比例 */
  dislikeSkipMode?: 'count' | 'percent';
  /** 踩歌切歌固定人数（count 模式），默认 5 */
  dislikeSkipThreshold?: number;
  /** 踩歌切歌在线比例（percent 模式），1–100，默认 50 */
  dislikeSkipPercent?: number;
  /** 退出房间后是否清除该成员已点待播曲（默认关闭） */
  clearSongsOnLeaveEnabled?: boolean;
  /** 退出后等待多久再清除，秒，默认 60 */
  clearSongsOnLeaveDelaySec?: number;
  /** 进房后需等待的秒数才能点歌，0 表示不限制 */
  songRequestMinStaySec?: number;
  /** 每人队列中最多保留几首，0 表示不限制 */
  songRequestMaxPerUser?: number;
  /** 每人点歌冷却秒数，0 表示不限制 */
  songRequestCooldownSec?: number;
  /** 队列最多保留几首 */
  queueMaxLength?: number;
  /** 禁播歌曲（仅房主/管理员可见） */
  bannedSongs?: BannedSong[];
  /** 房间贵宾角标（userId → 配置） */
  memberTiers?: Record<string, RoomMemberTier>;
  /** 贵宾欢迎语等房间级设置 */
  memberSettings?: RoomMemberSettings;
}

/** CRDT 播放状态（服务端唯一时间源） */
export interface PlaybackState {
  roomId: string;
  version: number;
  trackId: string;
  status: 'playing' | 'paused';
  positionSec: number;
  /** 当前曲目时长（秒），供客户端判断 position 是否已超出曲目 */
  durationSec?: number;
  serverNowMs: number;
  startedAt: number;
  currentTime: number;
  updatedAt: number;
}

export interface RoomSummary {
  id: string;
  name: string;
  userCount: number;
  hasPassword: boolean;
  isLocked?: boolean;
  isPlaying: boolean;
  currentSong: {
    name: string;
    artist: string;
    id?: string;
    source?: MusicSource;
    pic?: string;
  } | null;
  queueLength: number;
  createdAt: number;
}

export interface RoomCheckResult {
  exists: boolean;
  hasPassword: boolean;
  isLocked?: boolean;
  name?: string;
}

export interface LyricLine {
  time: number;
  text: string;
  translation?: string;
}

export interface SearchResult extends Song {
  url?: string;
  lrc?: string;
}

export interface FavoriteSong extends Song {
  favoritedAt?: number;
}

