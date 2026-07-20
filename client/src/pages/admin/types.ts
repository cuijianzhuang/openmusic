export interface MetingUpstreamStatus {
  url: string;
  style?: string;
  disabled?: boolean;
  healthy: boolean;
  cooldownRemainingSec: number;
  okCount: number;
  failCount: number;
  lastError: string;
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
}

export interface SiteAnnouncementConfig {
  enabled: boolean;
  id: string;
  title: string;
  text: string;
}

export interface RuntimeConfig {
  roomEmptyTtlMs: number;
  metingApiUrl: string;
  metingApiAuth: string;
  metingSources: {
    url: string;
    type: 'meting' | 'chksz';
    configuredAuth: boolean;
    auth?: string;
    clearAuth?: boolean;
  }[];
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

export interface SiteBanEntry {
  id: string;
  type: 'ip' | 'device';
  value: string;
  reason: string;
  at: number;
}

export interface ErrorReportSummary {
  id: string;
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
  hasSnapshot: boolean;
}

export interface ErrorReportDetail extends ErrorReportSummary {
  snapshot: string;
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
