export interface MetingUpstreamRecentError {
  at: number;
  message: string;
  type?: string;
  id?: string;
  server?: string;
  userId?: string;
  userNickname?: string;
  roomId?: string;
  roomName?: string;
}

export interface MetingUpstreamStatus {
  url: string;
  style?: string;
  disabled?: boolean;
  healthy: boolean;
  cooldownRemainingSec: number;
  okCount: number;
  failCount: number;
  softFailCount?: number;
  /** 0–100，按硬失败口径：ok / (ok + fail) */
  successRate?: number;
  lastError: string;
  lastErrorAt?: number;
  recentErrors?: MetingUpstreamRecentError[];
}

export interface AdminAuditEntry {
  at: number;
  action: string;
  ip: string;
  roomId?: string;
  name?: string;
  kicked?: number;
  error?: string;
  path?: string;
  enabled?: boolean;
  announcementId?: string;
  url?: string;
  disabled?: boolean;
  roomCount?: number;
  banType?: string;
  value?: string;
  banId?: string;
  reportId?: string;
  status?: string;
  username?: string;
  via?: string;
  linuxdoUsername?: string;
  githubUsername?: string;
}

export interface SiteAnnouncementConfig {
  enabled: boolean;
  id: string;
  title: string;
  text: string;
}

export interface RuntimeConfig {
  roomEmptyTtlMs: number;
  linuxdoClientId: string;
  linuxdoClientSecret: string;
  linuxdoRedirectUri: string;
  linuxdoAuthorizeUrl: string;
  linuxdoTokenUrl: string;
  linuxdoUserInfoUrl: string;
  linuxdoScope: string;
  githubClientId: string;
  githubClientSecret: string;
  githubRedirectUri: string;
  githubScope: string;
  /** 是否开放 SVIP 音质选项（需上游 Cookie 具备对应权益） */
  svipQualityEnabled: boolean;
  metingApiUrl: string;
  metingApiAuth: string;
  metingSources: {
    url: string;
    type: 'meting';
    configuredAuth: boolean;
    auth?: string;
    clearAuth?: boolean;
  }[];
  musicApis: CustomMusicApi[];
  cyapiBase: string;
  cyapiKey: string;
  vmyLrcUrl: string;
  qiniuAccessKey: string;
  qiniuSecretKey: string;
  qiniuBucket: string;
  qiniuDomain: string;
  qiniuZone: string;
  apihzBaseUrl: string;
  apihzId: string;
  apihzKey: string;
  configuredSecrets: Record<string, boolean>;
}

export type MusicApiPlatform = 'netease' | 'tencent' | 'kugou';
export type MusicApiOperation = 'search' | 'song' | 'url' | 'lrc' | 'pic' | 'playlist' | 'search_playlist';

export interface CustomMusicApi {
  id: string;
  name: string;
  remark: string;
  enabled: boolean;
  platforms: MusicApiPlatform[];
  operations: MusicApiOperation[];
  weight: number;
  timeoutMs: number;
  failureThreshold: number;
  cooldownMs: number;
  method: 'GET' | 'POST';
  url: string;
  params: string;
  headers: string;
  body: string;
  mapping: {
    items?: string;
    id?: string;
    name?: string;
    artist?: string;
    album?: string;
    pic?: string;
    duration?: string;
    url?: string;
    lrc?: string;
    value?: string;
  };
}

export interface CustomMusicApiRouteStatus {
  id: string;
  name: string;
  remark: string;
  platform: MusicApiPlatform;
  operation: MusicApiOperation;
  enabled: boolean;
  weight: number;
  circuitState: 'closed' | 'open' | 'half-open' | 'disabled';
  healthy: boolean;
  cooldownRemainingSec: number;
  consecutiveFailures: number;
  okCount: number;
  failCount: number;
  lastError: string;
  lastFailureAt: number;
  lastSuccessAt: number;
}

export interface CustomMusicApiStatus {
  configured: boolean;
  routes: CustomMusicApiRouteStatus[];
}

export interface SiteBanEntry {
  id: string;
  type: 'ip' | 'device';
  value: string;
  reason: string;
  at: number;
}

export interface ErrorReportSummary {
  id: string;
  type: 'error' | 'feedback';
  status: 'open' | 'resolved';
  description: string;
  ip: string;
  userId: string;
  createdAt: number;
  resolvedAt: number | null;
  note: string;
  solutionAckedAt?: number | null;
  meta: {
    roomId?: string | null;
    nickname?: string | null;
    trackName?: string | null;
    trackSource?: string | null;
    href?: string | null;
  };
  eventCount: number;
  snapshotCount?: number;
  hasSnapshot: boolean;
}

export interface ErrorReportSnapshotSection {
  id: string;
  title: string;
  content: string;
}

export interface ErrorReportDetail extends ErrorReportSummary {
  snapshot: string;
  snapshots?: ErrorReportSnapshotSection[];
  events: { at: string; name: string; line: string }[];
  meta: Record<string, string | number | boolean | null>;
}

export interface AdminOverview {
  roomCount: number;
  onlineUsers: number;
  playingRooms: number;
  connectedSockets: number;
  uptimeSec: number;
  memoryRssMb: number;
  redisEnabled: boolean;
  metingUpstreams: MetingUpstreamStatus[];
  entryPath?: string;
  adminUsername?: string;
  credentialsPersisted?: boolean;
  mustChangeCredentials?: boolean;
  mustChangeEntryPath?: boolean;
  setupRequired?: boolean;
  auditStoredIn?: 'redis' | 'memory';
}

export interface AdminRoom {
  id: string;
  name: string;
  userCount: number;
  users: { id: string; nickname: string; clientIp?: string; deviceId?: string }[];
  hasPassword: boolean;
  isLocked: boolean;
  isPlaying: boolean;
  currentSong: { name: string; artist: string } | null;
  queueLength: number;
  createdAt: number;
  protectedFromDestroy: boolean;
}

export type AdminTabId = 'overview' | 'rooms' | 'bans' | 'reports' | 'notify' | 'settings' | 'audit';
