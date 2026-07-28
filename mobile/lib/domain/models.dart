// Domain models mirrored from `client/src/types.ts` (subset for listening).

typedef MusicSource = String;

class RoomMemberTier {
  const RoomMemberTier({
    required this.userId,
    required this.badgeLabel,
    required this.badgeColor,
    required this.borderStyleId,
    required this.borderColor,
    this.assignedAt,
    this.welcomeEnabled,
    this.welcomeTemplateId,
    this.welcomeCustomText,
    this.confettiEnabled,
    this.welcomeCooldownSec,
  });

  final String userId;
  final String badgeLabel;
  final String badgeColor;
  final String borderStyleId;
  final String borderColor;
  final int? assignedAt;
  final bool? welcomeEnabled;
  final String? welcomeTemplateId;
  final String? welcomeCustomText;
  final bool? confettiEnabled;
  final int? welcomeCooldownSec;

  factory RoomMemberTier.fromJson(Map<String, dynamic> j) => RoomMemberTier(
        userId: '${j['userId'] ?? ''}',
        badgeLabel: '${j['badgeLabel'] ?? '贵宾'}',
        badgeColor: '${j['badgeColor'] ?? '#f6d365'}',
        borderStyleId: '${j['borderStyleId'] ?? 'solid'}',
        borderColor: '${j['borderColor'] ?? j['badgeColor'] ?? '#f6d365'}',
        assignedAt: (j['assignedAt'] as num?)?.toInt(),
        welcomeEnabled: j['welcomeEnabled'] as bool?,
        welcomeTemplateId: _strOrNull(j['welcomeTemplateId']),
        welcomeCustomText: _strOrNull(j['welcomeCustomText']),
        confettiEnabled: j['confettiEnabled'] as bool?,
        welcomeCooldownSec: (j['welcomeCooldownSec'] as num?)?.toInt(),
      );

  Map<String, dynamic> toPayload() => {
        'badgeLabel': badgeLabel,
        'badgeColor': badgeColor,
        'borderStyleId': borderStyleId,
        'borderColor': borderColor,
        if (welcomeEnabled != null) 'welcomeEnabled': welcomeEnabled,
        if (welcomeTemplateId != null) 'welcomeTemplateId': welcomeTemplateId,
        if (welcomeCustomText != null) 'welcomeCustomText': welcomeCustomText,
        if (confettiEnabled != null) 'confettiEnabled': confettiEnabled,
        if (welcomeCooldownSec != null) 'welcomeCooldownSec': welcomeCooldownSec,
      };
}

class RoomMemberSettings {
  const RoomMemberSettings({
    this.welcomeEnabled = true,
    this.welcomeTemplateId = 'royal',
    this.welcomeCustomText,
    this.confettiEnabled = true,
    this.welcomeCooldownSec = 300,
  });

  final bool welcomeEnabled;
  final String welcomeTemplateId;
  final String? welcomeCustomText;
  final bool confettiEnabled;
  final int welcomeCooldownSec;

  factory RoomMemberSettings.fromJson(Map<String, dynamic> j) => RoomMemberSettings(
        welcomeEnabled: j['welcomeEnabled'] != false,
        welcomeTemplateId: '${j['welcomeTemplateId'] ?? 'royal'}',
        welcomeCustomText: _strOrNull(j['welcomeCustomText']),
        confettiEnabled: j['confettiEnabled'] != false,
        welcomeCooldownSec: (j['welcomeCooldownSec'] as num?)?.toInt() ?? 300,
      );
}

class Song {
  Song({
    required this.id,
    required this.source,
    required this.name,
    required this.artist,
    this.album,
    this.pic,
    this.duration,
    this.url,
    this.lrc,
  });

  final String id;
  final MusicSource source;
  final String name;
  final String artist;
  final String? album;
  final String? pic;
  final double? duration;
  final String? url;
  final String? lrc;

  factory Song.fromJson(Map<String, dynamic> j) => Song(
        id: '${j['id'] ?? ''}',
        source: '${j['source'] ?? 'netease'}',
        name: '${j['name'] ?? ''}',
        artist: _songArtist(j),
        album: j['album'] as String?,
        pic: j['pic'] as String?,
        duration: _songDurationSec(j['duration']),
        url: j['url'] as String?,
        lrc: j['lrc'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'source': source,
        'name': name,
        'artist': artist,
        if (album != null) 'album': album,
        if (pic != null) 'pic': pic,
        if (duration != null) 'duration': duration,
        if (url != null) 'url': url,
        if (lrc != null) 'lrc': lrc,
      };

  String get songKey => '$source:$id';
}

class BannedSong {
  const BannedSong({
    required this.id,
    required this.source,
    required this.name,
    required this.artist,
    this.bannedAt,
  });

  final String id;
  final String source;
  final String name;
  final String artist;
  final int? bannedAt;

  factory BannedSong.fromJson(Map<String, dynamic> j) => BannedSong(
        id: '${j['id'] ?? ''}',
        source: '${j['source'] ?? 'netease'}',
        name: '${j['name'] ?? ''}',
        artist: _songArtist(j),
        bannedAt: (j['bannedAt'] as num?)?.toInt(),
      );
}

class ForbiddenWord {
  const ForbiddenWord({
    required this.word,
    this.isDefault = false,
    this.addedAt,
  });

  final String word;
  final bool isDefault;
  final int? addedAt;

  factory ForbiddenWord.fromJson(Map<String, dynamic> j) => ForbiddenWord(
        word: '${j['word'] ?? ''}',
        isDefault: j['isDefault'] == true,
        addedAt: (j['addedAt'] as num?)?.toInt(),
      );
}

class QueueItem extends Song {
  QueueItem({
    required super.id,
    required super.source,
    required super.name,
    required super.artist,
    super.album,
    super.pic,
    super.duration,
    super.url,
    super.lrc,
    required this.queueId,
    required this.requestedBy,
    this.requestedById,
    required this.addedAt,
    this.likedByIds = const [],
    this.dislikedByIds = const [],
  });

  final String queueId;
  final String requestedBy;
  final String? requestedById;
  final int addedAt;
  final List<String> likedByIds;
  final List<String> dislikedByIds;

  factory QueueItem.fromJson(Map<String, dynamic> j) => QueueItem(
        id: '${j['id'] ?? ''}',
        source: '${j['source'] ?? 'netease'}',
        name: '${j['name'] ?? ''}',
        artist: _songArtist(j),
        album: j['album'] as String?,
        pic: j['pic'] as String?,
        duration: _songDurationSec(j['duration']),
        url: j['url'] as String?,
        lrc: j['lrc'] as String?,
        queueId: '${j['queueId'] ?? ''}',
        requestedBy: '${j['requestedBy'] ?? ''}',
        requestedById: j['requestedById'] as String?,
        addedAt: (j['addedAt'] as num?)?.toInt() ?? 0,
        likedByIds: _strList(j['likedByIds']),
        dislikedByIds: _strList(j['dislikedByIds']),
      );
}

String _songArtist(Map<String, dynamic> j) {
  final a = j['artist'] ?? j['author'] ?? j['SingerName'];
  if (a is String && a.trim().isNotEmpty) return a.trim();
  if (a is List) {
    final joined = a.map((e) {
      if (e is Map) return '${e['name'] ?? ''}'.trim();
      return '$e'.trim();
    }).where((s) => s.isNotEmpty).join(' / ');
    if (joined.isNotEmpty) return joined;
  }
  return '未知歌手';
}

double? _songDurationSec(dynamic raw) {
  if (raw is! num) return null;
  final v = raw.toDouble();
  if (v <= 0) return null;
  // Heuristic: values > 10000 are milliseconds.
  return v > 10000 ? v / 1000.0 : v;
}

class RoomUser {
  RoomUser({
    required this.id,
    required this.nickname,
    required this.joinedAt,
    this.avatarUrl,
    this.location,
    this.readOnly = false,
  });

  final String id;
  final String nickname;
  final int joinedAt;
  final String? avatarUrl;
  final String? location;
  final bool readOnly;

  factory RoomUser.fromJson(Map<String, dynamic> j) => RoomUser(
        id: '${j['id'] ?? ''}',
        nickname: '${j['nickname'] ?? ''}',
        joinedAt: (j['joinedAt'] as num?)?.toInt() ?? 0,
        avatarUrl: j['avatar_url'] as String?,
        location: j['location'] as String?,
        readOnly: j['readOnly'] == true,
      );
}

class ChatMention {
  const ChatMention({required this.id, required this.nickname});

  final String id;
  final String nickname;

  factory ChatMention.fromJson(Map<String, dynamic> j) => ChatMention(
        id: '${j['id'] ?? ''}',
        nickname: '${j['nickname'] ?? ''}',
      );

  Map<String, dynamic> toJson() => {'id': id, 'nickname': nickname};
}

class ChatReplyRef {
  const ChatReplyRef({
    required this.id,
    required this.userId,
    required this.nickname,
    required this.text,
    this.imageUrl,
    this.asSticker = false,
  });

  final String id;
  final String userId;
  final String nickname;
  final String text;
  final String? imageUrl;
  final bool asSticker;

  factory ChatReplyRef.fromJson(Map<String, dynamic> j) => ChatReplyRef(
        id: '${j['id'] ?? ''}',
        userId: '${j['userId'] ?? ''}',
        nickname: '${j['nickname'] ?? ''}',
        text: '${j['text'] ?? ''}',
        imageUrl: j['imageUrl'] as String?,
        asSticker: j['asSticker'] == true,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'userId': userId,
        'nickname': nickname,
        'text': text,
        if (imageUrl != null) 'imageUrl': imageUrl,
        if (asSticker) 'asSticker': true,
      };
}

class ChatReactionUser {
  const ChatReactionUser({required this.userId, required this.nickname});

  final String userId;
  final String nickname;

  factory ChatReactionUser.fromJson(Map<String, dynamic> j) => ChatReactionUser(
        userId: '${j['userId'] ?? ''}',
        nickname: '${j['nickname'] ?? ''}',
      );
}

class ChatReactionGroup {
  const ChatReactionGroup({required this.emoji, this.users = const []});

  final String emoji;
  final List<ChatReactionUser> users;

  factory ChatReactionGroup.fromJson(Map<String, dynamic> j) => ChatReactionGroup(
        emoji: '${j['emoji'] ?? ''}',
        users: _mapList(j['users'], ChatReactionUser.fromJson),
      );
}

class ChatMessage {
  ChatMessage({
    required this.id,
    required this.userId,
    required this.nickname,
    required this.text,
    required this.timestamp,
    this.kind = 'chat',
    this.imageUrl,
    this.imageKey,
    this.asSticker = false,
    this.mentions = const [],
    this.replyTo,
    this.reactions = const [],
    this.memberTier,
    this.targetUserId,
    this.targetNickname,
    this.confettiEnabled,
  });

  final String id;
  final String userId;
  final String nickname;
  final String text;
  final int timestamp;
  final String kind;
  final String? imageUrl;
  final String? imageKey;
  final bool asSticker;
  final List<ChatMention> mentions;
  final ChatReplyRef? replyTo;
  final List<ChatReactionGroup> reactions;
  final RoomMemberTier? memberTier;
  final String? targetUserId;
  final String? targetNickname;
  final bool? confettiEnabled;

  factory ChatMessage.fromJson(Map<String, dynamic> j) => ChatMessage(
        id: '${j['id'] ?? ''}',
        userId: '${j['userId'] ?? ''}',
        nickname: '${j['nickname'] ?? ''}',
        text: '${j['text'] ?? ''}',
        timestamp: (j['timestamp'] as num?)?.toInt() ?? 0,
        kind: '${j['kind'] ?? 'chat'}',
        imageUrl: j['imageUrl'] as String?,
        imageKey: _strOrNull(j['imageKey']),
        asSticker: j['asSticker'] == true,
        mentions: _mapList(j['mentions'], ChatMention.fromJson),
        replyTo: j['replyTo'] is Map
            ? ChatReplyRef.fromJson(Map<String, dynamic>.from(j['replyTo'] as Map))
            : null,
        reactions: _mapList(j['reactions'], ChatReactionGroup.fromJson),
        memberTier: j['memberTier'] is Map
            ? RoomMemberTier.fromJson(Map<String, dynamic>.from(j['memberTier'] as Map))
            : null,
        targetUserId: _strOrNull(j['targetUserId']),
        targetNickname: _strOrNull(j['targetNickname']),
        confettiEnabled: j['confettiEnabled'] as bool?,
      );
}

class PlaybackState {
  PlaybackState({
    required this.roomId,
    required this.version,
    required this.trackId,
    required this.status,
    required this.positionSec,
    required this.serverNowMs,
    required this.startedAt,
    required this.currentTime,
    required this.updatedAt,
    this.durationSec,
    this.mediaUrl,
    this.mediaQuality,
    int? receivedAtMs,
  }) : receivedAtMs = receivedAtMs ?? DateTime.now().millisecondsSinceEpoch;

  final String roomId;
  final int version;
  final String trackId;
  final String status; // playing | paused
  final double positionSec;
  final double? durationSec;
  final int serverNowMs;
  final int startedAt;
  final double currentTime;
  final int updatedAt;
  final String? mediaUrl;
  final String? mediaQuality;
  /// Local wall clock when this snapshot was received (for extrapolation).
  final int receivedAtMs;

  bool get isPlaying => status == 'playing';

  /// Snapshot progress at receive time — server timestamps only (no client clock skew).
  double get _positionAtReceive {
    if (startedAt > 0 && serverNowMs > 0) {
      final sec = (serverNowMs - startedAt) / 1000.0;
      return sec < 0 ? 0.0 : sec;
    }
    // Prefer positionSec even when 0 (song start); only fall back if missing/negative.
    final base = positionSec >= 0 ? positionSec : currentTime;
    return base < 0 ? 0.0 : base;
  }

  /// Playing: extrapolate from receive anchor with local clock (mirrors web `getPlaybackTime`).
  double estimatedPosition({DateTime? now}) {
    if (!isPlaying) return _positionAtReceive;
    final n = (now ?? DateTime.now()).millisecondsSinceEpoch;
    final elapsed = (n - receivedAtMs) / 1000.0;
    return _positionAtReceive + (elapsed < 0 ? 0 : elapsed);
  }

  factory PlaybackState.fromJson(Map<String, dynamic> j) => PlaybackState(
        roomId: '${j['roomId'] ?? ''}',
        version: (j['version'] as num?)?.toInt() ?? 0,
        trackId: '${j['trackId'] ?? ''}',
        status: '${j['status'] ?? 'paused'}',
        positionSec: (j['positionSec'] as num?)?.toDouble() ?? 0,
        durationSec: (j['durationSec'] as num?)?.toDouble(),
        serverNowMs: (j['serverNowMs'] as num?)?.toInt() ??
            DateTime.now().millisecondsSinceEpoch,
        startedAt: (j['startedAt'] as num?)?.toInt() ?? 0,
        currentTime: (j['currentTime'] as num?)?.toDouble() ?? 0,
        updatedAt: (j['updatedAt'] as num?)?.toInt() ?? 0,
        mediaUrl: j['mediaUrl'] as String?,
        mediaQuality: j['mediaQuality'] as String?,
      );
}

class PermanentApplication {
  const PermanentApplication({
    required this.status,
    required this.appliedAt,
    this.applicantNickname,
    this.note,
  });

  final String status;
  final int appliedAt;
  final String? applicantNickname;
  final String? note;

  factory PermanentApplication.fromJson(Map<String, dynamic> j) => PermanentApplication(
        status: '${j['status'] ?? 'pending'}',
        appliedAt: (j['appliedAt'] as num?)?.toInt() ?? 0,
        applicantNickname: _strOrNull(j['applicantNickname']),
        note: _strOrNull(j['note']),
      );
}

class RoomAudioQuality {
  const RoomAudioQuality({
    required this.netease,
    required this.tencent,
  });

  final String netease;
  final String tencent;

  factory RoomAudioQuality.fromJson(dynamic v) {
    if (v is! Map) {
      return const RoomAudioQuality(netease: 'jyeffect', tencent: 'lossless');
    }
    final m = Map<String, dynamic>.from(v);
    return RoomAudioQuality(
      netease: '${m['netease'] ?? 'jyeffect'}',
      tencent: '${m['tencent'] ?? 'lossless'}',
    );
  }

  String get label => '网易 $netease · QQ $tencent';

  Map<String, String> toJson() => {'netease': netease, 'tencent': tencent};
}

class JumpRequest {
  JumpRequest({
    required this.id,
    required this.queueId,
    required this.songName,
    required this.nickname,
    required this.requestedBy,
    required this.requestedAt,
  });

  final String id;
  final String queueId;
  final String songName;
  final String nickname;
  final String requestedBy;
  final int requestedAt;

  factory JumpRequest.fromJson(Map<String, dynamic> j) => JumpRequest(
        id: '${j['id'] ?? ''}',
        queueId: '${j['queueId'] ?? ''}',
        songName: '${j['songName'] ?? ''}',
        nickname: '${j['nickname'] ?? ''}',
        requestedBy: '${j['requestedBy'] ?? ''}',
        requestedAt: (j['requestedAt'] as num?)?.toInt() ?? 0,
      );
}

class SkipRequest {
  SkipRequest({
    required this.id,
    required this.songName,
    required this.nickname,
    required this.requestedBy,
    required this.requestedAt,
  });

  final String id;
  final String songName;
  final String nickname;
  final String requestedBy;
  final int requestedAt;

  factory SkipRequest.fromJson(Map<String, dynamic> j) => SkipRequest(
        id: '${j['id'] ?? ''}',
        songName: '${j['songName'] ?? ''}',
        nickname: '${j['nickname'] ?? ''}',
        requestedBy: '${j['requestedBy'] ?? ''}',
        requestedAt: (j['requestedAt'] as num?)?.toInt() ?? 0,
      );
}

class RoomState {
  RoomState({
    required this.id,
    required this.name,
    required this.ownerId,
    required this.queue,
    required this.users,
    required this.userCount,
    required this.isPlaying,
    required this.currentTime,
    this.current,
    this.hasPassword = false,
    this.isLocked = false,
    this.creatorId,
    this.adminIds = const [],
    this.autoPromotedAdminIds = const [],
    this.playMode = 'order',
    this.audioQuality,
    this.neteaseFmMode,
    this.announcementEnabled = false,
    this.announcementText,
    this.customCoverUrl,
    this.protectedFromDestroy = false,
    this.permanentApplication,
    this.bannedSongs = const [],
    this.forbiddenWords = const [],
    this.memberTiers = const {},
    this.memberSettings = const RoomMemberSettings(),
    this.songRequestEnabled = true,
    this.joinNoticeEnabled = false,
    this.joinNoticeCooldownMinutes = 0,
    this.memberJumpEnabled = false,
    this.memberSeekEnabled = false,
    this.memberPauseEnabled = false,
    this.systemMediaPlayBound = true,
    this.systemMediaSkipBound = true,
    this.nextRandom,
    this.chatShowAvatars = false,
    this.chatHistoryVisibleOnJoin = true,
    this.chatVisibleSince,
    this.muteAll = false,
    this.mutedUserIds = const [],
    this.chatMuted = false,
    this.userAvatarUrls = const {},
    this.userNicknames = const {},
    this.jumpRequests = const [],
    this.skipRequests = const [],
    this.dislikeSkipMode = 'count',
    this.dislikeSkipThreshold = 5,
    this.dislikeSkipPercent = 50,
    this.clearSongsOnLeaveEnabled = false,
    this.clearSongsOnLeaveDelaySec = 60,
    this.songRequestMinStaySec = 0,
    this.songRequestMaxPerUser = 0,
    this.songRequestCooldownSec = 0,
    this.queueMaxLength = 100,
  });

  final String id;
  final String name;
  final String? ownerId;
  final String? creatorId;
  final List<String> adminIds;
  final List<String> autoPromotedAdminIds;
  final List<QueueItem> queue;
  final QueueItem? current;
  final bool isPlaying;
  final double currentTime;
  final List<RoomUser> users;
  final int userCount;
  final bool hasPassword;
  final bool isLocked;
  final String playMode;
  final RoomAudioQuality? audioQuality;
  final String? neteaseFmMode;
  final bool announcementEnabled;
  final String? announcementText;
  final String? customCoverUrl;
  final bool protectedFromDestroy;
  final PermanentApplication? permanentApplication;
  final List<BannedSong> bannedSongs;
  final List<ForbiddenWord> forbiddenWords;
  final Map<String, RoomMemberTier> memberTiers;
  final RoomMemberSettings memberSettings;
  final bool songRequestEnabled;
  final bool joinNoticeEnabled;
  final int joinNoticeCooldownMinutes;
  final bool memberJumpEnabled;
  final bool memberSeekEnabled;
  final bool memberPauseEnabled;
  final bool systemMediaPlayBound;
  final bool systemMediaSkipBound;
  final QueueItem? nextRandom;
  final bool chatShowAvatars;
  final bool chatHistoryVisibleOnJoin;
  final int? chatVisibleSince;
  final bool muteAll;
  /// Only present for moderators in room payloads; members use [chatMuted].
  final List<String> mutedUserIds;
  /// Personalized by server for the current viewer.
  final bool chatMuted;
  final Map<String, String> userAvatarUrls;
  final Map<String, String> userNicknames;
  final List<JumpRequest> jumpRequests;
  final List<SkipRequest> skipRequests;
  final String dislikeSkipMode;
  final int dislikeSkipThreshold;
  final int dislikeSkipPercent;
  final bool clearSongsOnLeaveEnabled;
  final int clearSongsOnLeaveDelaySec;
  final int songRequestMinStaySec;
  final int songRequestMaxPerUser;
  final int songRequestCooldownSec;
  final int queueMaxLength;

  String? avatarUrlFor(String userId) {
    final fromMap = userAvatarUrls[userId];
    if (fromMap != null && fromMap.isNotEmpty) return fromMap;
    for (final u in users) {
      if (u.id == userId && u.avatarUrl != null && u.avatarUrl!.isNotEmpty) {
        return u.avatarUrl;
      }
    }
    return null;
  }

  String nicknameFor(String userId) {
    final fromMap = userNicknames[userId];
    if (fromMap != null && fromMap.isNotEmpty) return fromMap;
    for (final u in users) {
      if (u.id == userId && u.nickname.isNotEmpty) return u.nickname;
    }
    return userId;
  }

  factory RoomState.fromJson(Map<String, dynamic> j) => RoomState(
        id: '${j['id'] ?? ''}',
        name: '${j['name'] ?? ''}',
        ownerId: _strOrNull(j['ownerId']),
        creatorId: _strOrNull(j['creatorId']),
        adminIds: _strList(j['adminIds']),
        autoPromotedAdminIds: _strList(j['autoPromotedAdminIds']),
        queue: _mapList(j['queue'], QueueItem.fromJson),
        current: j['current'] is Map
            ? QueueItem.fromJson(Map<String, dynamic>.from(j['current'] as Map))
            : null,
        isPlaying: j['isPlaying'] == true,
        currentTime: (j['currentTime'] as num?)?.toDouble() ?? 0,
        users: _mapList(j['users'], RoomUser.fromJson),
        userCount: (j['userCount'] as num?)?.toInt() ?? 0,
        hasPassword: j['hasPassword'] == true,
        isLocked: j['isLocked'] == true,
        playMode: '${j['playMode'] ?? 'order'}',
        audioQuality: j['audioQuality'] == null
            ? null
            : RoomAudioQuality.fromJson(j['audioQuality']),
        neteaseFmMode: _strOrNull(j['neteaseFmMode']),
        announcementEnabled: j['announcementEnabled'] == true,
        announcementText: _strOrNull(j['announcementText']),
        customCoverUrl: _strOrNull(j['customCoverUrl']),
        protectedFromDestroy: j['protectedFromDestroy'] == true,
        permanentApplication: j['permanentApplication'] is Map
            ? PermanentApplication.fromJson(
                Map<String, dynamic>.from(j['permanentApplication'] as Map),
              )
            : null,
        bannedSongs: _mapList(j['bannedSongs'], BannedSong.fromJson),
        forbiddenWords: _mapList(j['forbiddenWords'], ForbiddenWord.fromJson),
        memberTiers: _memberTierMap(j['memberTiers']),
        memberSettings: j['memberSettings'] is Map
            ? RoomMemberSettings.fromJson(Map<String, dynamic>.from(j['memberSettings'] as Map))
            : const RoomMemberSettings(),
        songRequestEnabled: j['songRequestEnabled'] != false,
        joinNoticeEnabled: j['joinNoticeEnabled'] == true,
        joinNoticeCooldownMinutes: ((j['joinNoticeCooldownSec'] as num?)?.toInt() ?? 0) ~/ 60,
        memberJumpEnabled: j['memberJumpEnabled'] == true,
        memberSeekEnabled: j['memberSeekEnabled'] == true,
        memberPauseEnabled: j['memberPauseEnabled'] == true,
        systemMediaPlayBound: j['systemMediaPlayBound'] != false,
        systemMediaSkipBound: j['systemMediaSkipBound'] != false,
        nextRandom: j['nextRandom'] is Map
            ? QueueItem.fromJson(
                Map<String, dynamic>.from(j['nextRandom'] as Map),
              )
            : null,
        chatShowAvatars: j['chatShowAvatars'] == true,
        chatHistoryVisibleOnJoin: j['chatHistoryVisibleOnJoin'] != false,
        chatVisibleSince: (j['chatVisibleSince'] as num?)?.toInt(),
        muteAll: j['muteAll'] == true,
        mutedUserIds: j.containsKey('mutedUserIds')
            ? _strList(j['mutedUserIds'])
            : const [],
        chatMuted: j['chatMuted'] == true,
        userAvatarUrls: _strMap(j['userAvatarUrls']),
        userNicknames: _strMap(j['userNicknames']),
        jumpRequests: _mapList(j['jumpRequests'], JumpRequest.fromJson),
        skipRequests: _mapList(j['skipRequests'], SkipRequest.fromJson),
        dislikeSkipMode: '${j['dislikeSkipMode'] ?? 'count'}' == 'percent'
            ? 'percent'
            : 'count',
        dislikeSkipThreshold: (j['dislikeSkipThreshold'] as num?)?.toInt() ?? 5,
        dislikeSkipPercent: (j['dislikeSkipPercent'] as num?)?.toInt() ?? 50,
        clearSongsOnLeaveEnabled: j['clearSongsOnLeaveEnabled'] == true,
        clearSongsOnLeaveDelaySec: (j['clearSongsOnLeaveDelaySec'] as num?)?.toInt() ?? 60,
        songRequestMinStaySec: (j['songRequestMinStaySec'] as num?)?.toInt() ?? 0,
        songRequestMaxPerUser: (j['songRequestMaxPerUser'] as num?)?.toInt() ?? 0,
        songRequestCooldownSec: (j['songRequestCooldownSec'] as num?)?.toInt() ?? 0,
        queueMaxLength: (j['queueMaxLength'] as num?)?.toInt() ?? 100,
      );

  RoomState copyWith({
    List<QueueItem>? queue,
    QueueItem? current,
    bool clearCurrent = false,
    bool? isPlaying,
    double? currentTime,
    List<RoomUser>? users,
    int? userCount,
    String? name,
    String? ownerId,
    String? creatorId,
    List<String>? adminIds,
    bool? isLocked,
    String? playMode,
    RoomAudioQuality? audioQuality,
    String? neteaseFmMode,
    String? announcementText,
    bool? announcementEnabled,
    String? customCoverUrl,
    bool? protectedFromDestroy,
    PermanentApplication? permanentApplication,
    List<BannedSong>? bannedSongs,
    List<ForbiddenWord>? forbiddenWords,
    Map<String, RoomMemberTier>? memberTiers,
    RoomMemberSettings? memberSettings,
    bool? joinNoticeEnabled,
    int? joinNoticeCooldownMinutes,
    bool? chatShowAvatars,
    int? chatVisibleSince,
    bool clearChatVisibleSince = false,
    bool? muteAll,
    List<String>? mutedUserIds,
    bool? chatMuted,
    Map<String, String>? userAvatarUrls,
    Map<String, String>? userNicknames,
    List<JumpRequest>? jumpRequests,
    List<SkipRequest>? skipRequests,
    bool? clearSongsOnLeaveEnabled,
    int? clearSongsOnLeaveDelaySec,
    int? songRequestMinStaySec,
    int? songRequestMaxPerUser,
    int? songRequestCooldownSec,
    int? queueMaxLength,
  }) {
    return RoomState(
      id: id,
      name: name ?? this.name,
      ownerId: ownerId ?? this.ownerId,
      creatorId: creatorId ?? this.creatorId,
      adminIds: adminIds ?? this.adminIds,
      autoPromotedAdminIds: autoPromotedAdminIds,
      queue: queue ?? this.queue,
      current: clearCurrent ? null : (current ?? this.current),
      isPlaying: isPlaying ?? this.isPlaying,
      currentTime: currentTime ?? this.currentTime,
      users: users ?? this.users,
      userCount: userCount ?? this.userCount,
      hasPassword: hasPassword,
      isLocked: isLocked ?? this.isLocked,
      playMode: playMode ?? this.playMode,
      audioQuality: audioQuality ?? this.audioQuality,
      neteaseFmMode: neteaseFmMode ?? this.neteaseFmMode,
      announcementEnabled: announcementEnabled ?? this.announcementEnabled,
      announcementText: announcementText ?? this.announcementText,
      customCoverUrl: customCoverUrl ?? this.customCoverUrl,
      protectedFromDestroy: protectedFromDestroy ?? this.protectedFromDestroy,
      permanentApplication: permanentApplication ?? this.permanentApplication,
      bannedSongs: bannedSongs ?? this.bannedSongs,
      forbiddenWords: forbiddenWords ?? this.forbiddenWords,
      memberTiers: memberTiers ?? this.memberTiers,
      memberSettings: memberSettings ?? this.memberSettings,
      songRequestEnabled: songRequestEnabled,
      joinNoticeEnabled: joinNoticeEnabled ?? this.joinNoticeEnabled,
      joinNoticeCooldownMinutes: joinNoticeCooldownMinutes ?? this.joinNoticeCooldownMinutes,
      memberJumpEnabled: memberJumpEnabled,
      memberSeekEnabled: memberSeekEnabled,
      memberPauseEnabled: memberPauseEnabled,
      systemMediaPlayBound: systemMediaPlayBound,
      systemMediaSkipBound: systemMediaSkipBound,
      nextRandom: nextRandom,
      chatShowAvatars: chatShowAvatars ?? this.chatShowAvatars,
      chatHistoryVisibleOnJoin: chatHistoryVisibleOnJoin,
      chatVisibleSince: clearChatVisibleSince
          ? null
          : (chatVisibleSince ?? this.chatVisibleSince),
      muteAll: muteAll ?? this.muteAll,
      mutedUserIds: mutedUserIds ?? this.mutedUserIds,
      chatMuted: chatMuted ?? this.chatMuted,
      userAvatarUrls: userAvatarUrls ?? this.userAvatarUrls,
      userNicknames: userNicknames ?? this.userNicknames,
      jumpRequests: jumpRequests ?? this.jumpRequests,
      skipRequests: skipRequests ?? this.skipRequests,
      dislikeSkipMode: dislikeSkipMode,
      dislikeSkipThreshold: dislikeSkipThreshold,
      dislikeSkipPercent: dislikeSkipPercent,
      clearSongsOnLeaveEnabled: clearSongsOnLeaveEnabled ?? this.clearSongsOnLeaveEnabled,
      clearSongsOnLeaveDelaySec: clearSongsOnLeaveDelaySec ?? this.clearSongsOnLeaveDelaySec,
      songRequestMinStaySec: songRequestMinStaySec ?? this.songRequestMinStaySec,
      songRequestMaxPerUser: songRequestMaxPerUser ?? this.songRequestMaxPerUser,
      songRequestCooldownSec: songRequestCooldownSec ?? this.songRequestCooldownSec,
      queueMaxLength: queueMaxLength ?? this.queueMaxLength,
    );
  }
}

class RoomSummary {
  RoomSummary({
    required this.id,
    required this.name,
    required this.userCount,
    required this.hasPassword,
    required this.isPlaying,
    required this.queueLength,
    this.isLocked = false,
    this.customCoverUrl,
    this.currentSongName,
    this.currentSongArtist,
    this.currentSongPic,
  });

  final String id;
  final String name;
  final int userCount;
  final bool hasPassword;
  final bool isLocked;
  final bool isPlaying;
  final int queueLength;
  final String? customCoverUrl;
  final String? currentSongName;
  final String? currentSongArtist;
  final String? currentSongPic;

  factory RoomSummary.fromJson(Map<String, dynamic> j) {
    final current = j['currentSong'];
    Map<String, dynamic>? curMap;
    if (current is Map) curMap = Map<String, dynamic>.from(current);
    return RoomSummary(
      id: '${j['id'] ?? ''}',
      name: '${j['name'] ?? ''}',
      userCount: (j['userCount'] as num?)?.toInt() ?? 0,
      hasPassword: j['hasPassword'] == true,
      isLocked: j['isLocked'] == true,
      isPlaying: j['isPlaying'] == true,
      queueLength: (j['queueLength'] as num?)?.toInt() ?? 0,
      customCoverUrl: j['customCoverUrl'] as String?,
      currentSongName: curMap?['name'] as String?,
      currentSongArtist: curMap?['artist'] as String?,
      currentSongPic: curMap?['pic'] as String?,
    );
  }
}

class RoomRoles {
  const RoomRoles({
    required this.isOwner,
    required this.isAdmin,
    required this.canControlPlayback,
    required this.isPlaybackLeader,
  });

  final bool isOwner;
  final bool isAdmin;
  final bool canControlPlayback;
  final bool isPlaybackLeader;

  static RoomRoles derive(RoomState room, String? mySocketId) {
    if (mySocketId == null || mySocketId.isEmpty) {
      return const RoomRoles(
        isOwner: false,
        isAdmin: false,
        canControlPlayback: false,
        isPlaybackLeader: false,
      );
    }
    final isOwner = room.creatorId == mySocketId;
    final isAdmin = room.adminIds.contains(mySocketId);
    final canControl = isOwner ||
        isAdmin ||
        room.autoPromotedAdminIds.contains(mySocketId);
    final isLeader = room.ownerId == mySocketId;
    return RoomRoles(
      isOwner: isOwner,
      isAdmin: isAdmin,
      canControlPlayback: canControl,
      isPlaybackLeader: isLeader,
    );
  }
}

List<String> _strList(dynamic v) {
  if (v is! List) return const [];
  return v.map((e) => '$e').toList();
}

Map<String, String> _strMap(dynamic v) {
  if (v is! Map) return const {};
  final out = <String, String>{};
  v.forEach((key, value) {
    final k = '$key';
    final val = '$value'.trim();
    if (k.isEmpty || val.isEmpty) return;
    out[k] = val;
  });
  return out;
}

Map<String, RoomMemberTier> _memberTierMap(dynamic v) {
  if (v is! Map) return const {};
  final out = <String, RoomMemberTier>{};
  v.forEach((key, value) {
    if (value is! Map) return;
    final tier = RoomMemberTier.fromJson({
      ...Map<String, dynamic>.from(value),
      'userId': '${key}',
    });
    if (tier.userId.isEmpty) return;
    out[tier.userId] = tier;
  });
  return out;
}

String? _strOrNull(dynamic v) {
  if (v == null) return null;
  if (v is String) return v.isEmpty ? null : v;
  return '$v';
}

List<T> _mapList<T>(dynamic v, T Function(Map<String, dynamic>) map) {
  if (v is! List) return const [];
  return v
      .whereType<Map>()
      .map((e) => map(Map<String, dynamic>.from(e)))
      .toList();
}
