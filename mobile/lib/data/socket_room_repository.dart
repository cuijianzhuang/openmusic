import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openmusic/core/socket_client.dart';
import 'package:openmusic/data/local_cache.dart';
import 'package:openmusic/domain/models.dart';

class RoomSessionState {
  const RoomSessionState({
    this.room,
    this.playback,
    this.mySocketId,
    this.myConnectionId,
    this.messages = const [],
    this.hasMoreOlder = false,
    this.loadingOlder = false,
    this.joining = false,
    this.error,
    this.kickedReason,
  });

  final RoomState? room;
  final PlaybackState? playback;
  final String? mySocketId;
  final String? myConnectionId;
  final List<ChatMessage> messages;
  final bool hasMoreOlder;
  final bool loadingOlder;
  final bool joining;
  final String? error;
  final String? kickedReason;

  RoomRoles? get rolesOrNull =>
      room == null ? null : RoomRoles.derive(room!, mySocketId);

  RoomSessionState copyWith({
    RoomState? room,
    PlaybackState? playback,
    String? mySocketId,
    String? myConnectionId,
    List<ChatMessage>? messages,
    bool? hasMoreOlder,
    bool? loadingOlder,
    bool? joining,
    String? error,
    String? kickedReason,
    bool clearError = false,
    bool clearRoom = false,
    bool clearPlayback = false,
  }) {
    return RoomSessionState(
      room: clearRoom ? null : (room ?? this.room),
      playback: clearPlayback ? null : (playback ?? this.playback),
      mySocketId: mySocketId ?? this.mySocketId,
      myConnectionId: myConnectionId ?? this.myConnectionId,
      messages: messages ?? this.messages,
      hasMoreOlder: hasMoreOlder ?? this.hasMoreOlder,
      loadingOlder: loadingOlder ?? this.loadingOlder,
      joining: joining ?? this.joining,
      error: clearError ? null : (error ?? this.error),
      kickedReason: kickedReason ?? this.kickedReason,
    );
  }
}

class RoomSessionNotifier extends StateNotifier<RoomSessionState> {
  RoomSessionNotifier() : super(const RoomSessionState()) {
    _bind();
  }

  void _bind() {
    OmSocket.on('room_update', _onRoomUpdate);
    OmSocket.on('presence_update', _onPresence);
    OmSocket.on('playback_state', _onPlayback);
    OmSocket.on('playback_media', _onPlaybackMedia);
    OmSocket.on('queue_snapshot', _onQueueSnapshot);
    OmSocket.on('chat_message', _onChat);
    OmSocket.on('chat_message_recall', _onChatRecall);
    OmSocket.on('chat_reaction_update', _onChatReactionUpdate);
    OmSocket.on('kicked', _onKicked);
  }

  void _onRoomUpdate(dynamic data) {
    if (data is! Map) return;
    final map = Map<String, dynamic>.from(data);
    var room = RoomState.fromJson(map);
    final prevRoom = state.room;
    if (!map.containsKey('chatVisibleSince') && prevRoom?.chatVisibleSince != null) {
      room = room.copyWith(chatVisibleSince: prevRoom!.chatVisibleSince);
    }
    // Non-moderators omit mutedUserIds — keep previous list if we already had one
    // (e.g. role demotion mid-session) so mute UI does not flicker empty.
    if (!map.containsKey('mutedUserIds') && state.room != null) {
      state = state.copyWith(
        room: room.copyWith(mutedUserIds: state.room!.mutedUserIds),
      );
      return;
    }
    final unlockedHistory = prevRoom?.chatHistoryVisibleOnJoin == false &&
        room.chatHistoryVisibleOnJoin &&
        room.chatVisibleSince != null;
    state = state.copyWith(
      room: unlockedHistory ? room.copyWith(clearChatVisibleSince: true) : room,
      hasMoreOlder: unlockedHistory ? true : state.hasMoreOlder,
    );
  }

  void _onPresence(dynamic data) {
    if (data is! Map || state.room == null) return;
    final usersRaw = data['users'];
    final users = usersRaw is List
        ? usersRaw
            .whereType<Map>()
            .map((e) => RoomUser.fromJson(Map<String, dynamic>.from(e)))
            .toList()
        : state.room!.users;
    final count = (data['userCount'] as num?)?.toInt() ?? users.length;
    state = state.copyWith(
      room: state.room!.copyWith(users: users, userCount: count),
    );
  }

  void _onPlayback(dynamic data) {
    if (data is! Map) return;
    final pb = PlaybackState.fromJson(Map<String, dynamic>.from(data));
    final prev = state.playback;
    // Drop stale snapshots so an older "playing" cannot undo a newer pause.
    if (prev != null &&
        prev.roomId == pb.roomId &&
        pb.version < prev.version) {
      return;
    }
    final room = state.room;
    // Server toggle_play only emits playback_state (not room_update). Mirror web
    // syncRoomPlaybackFromState so UI + nudge see the real play/pause flag.
    if (room != null &&
        room.id == pb.roomId &&
        (room.current == null || room.current!.queueId == pb.trackId)) {
      final nextPlaying = pb.isPlaying;
      // Prefer server play flag always; keep local currentTime if already close
      // to avoid scrubber snap-back while a seek is in flight.
      final nextTime = pb.estimatedPosition();
      final samePlay = room.isPlaying == nextPlaying;
      final sameTime = ((room.currentTime) - nextTime).abs() < 1.25;
      state = state.copyWith(
        playback: pb,
        room: (samePlay && sameTime)
            ? room
            : room.copyWith(
                isPlaying: nextPlaying,
                // Only jump clock when play state changes or drift is large.
                currentTime: sameTime ? room.currentTime : nextTime,
              ),
      );
      return;
    }
    state = state.copyWith(playback: pb);
  }

  void _onPlaybackMedia(dynamic data) {
    // Shared media URL — playback engine listens via provider.
    // Kept on room playback if track matches.
    if (data is! Map) return;
    final trackId = '${data['trackId'] ?? ''}';
    final url = '${data['url'] ?? ''}';
    final pb = state.playback;
    if (pb != null && pb.trackId == trackId && url.isNotEmpty) {
      state = state.copyWith(
        playback: PlaybackState(
          roomId: pb.roomId,
          version: pb.version,
          trackId: pb.trackId,
          status: pb.status,
          positionSec: pb.positionSec,
          durationSec: pb.durationSec,
          serverNowMs: pb.serverNowMs,
          startedAt: pb.startedAt,
          currentTime: pb.currentTime,
          updatedAt: pb.updatedAt,
          mediaUrl: url,
          mediaQuality: data['qualityLabel'] as String? ?? pb.mediaQuality,
          receivedAtMs: pb.receivedAtMs,
        ),
      );
    }
  }

  void _onQueueSnapshot(dynamic data) {
    if (data is! Map || state.room == null) return;
    final queue = (data['queue'] is List)
        ? (data['queue'] as List)
            .whereType<Map>()
            .map((e) => QueueItem.fromJson(Map<String, dynamic>.from(e)))
            .toList()
        : state.room!.queue;
    QueueItem? current = state.room!.current;
    if (data['current'] is Map) {
      current = QueueItem.fromJson(
        Map<String, dynamic>.from(data['current'] as Map),
      );
    }
    state = state.copyWith(
      room: state.room!.copyWith(queue: queue, current: current),
    );
  }

  void _onChat(dynamic data) {
    if (data is! Map) return;
    final msg = ChatMessage.fromJson(Map<String, dynamic>.from(data));
    if (_shouldHideMessage(msg)) return;
    if (state.messages.any((m) => m.id == msg.id)) return;
    state = state.copyWith(messages: [...state.messages, msg]);
  }

  bool _shouldHideMessage(ChatMessage message) {
    final visibleSince = state.room?.chatVisibleSince;
    return visibleSince != null &&
        visibleSince > 0 &&
        message.timestamp > 0 &&
        message.timestamp < visibleSince;
  }

  void _onChatRecall(dynamic data) {
    if (data is! Map) return;
    final id = '${data['id'] ?? data['messageId'] ?? ''}';
    if (id.isEmpty) return;
    state = state.copyWith(
      messages: state.messages
          .map((m) => m.id == id
              ? ChatMessage(
                  id: m.id,
                  userId: m.userId,
                  nickname: m.nickname,
                  text: '消息已撤回',
                  timestamp: m.timestamp,
                  kind: 'recall',
                  mentions: m.mentions,
                  imageUrl: m.imageUrl,
                  imageKey: m.imageKey,
                  asSticker: m.asSticker,
                  replyTo: m.replyTo,
                  reactions: m.reactions,
                  memberTier: m.memberTier,
                  targetUserId: m.targetUserId,
                  targetNickname: m.targetNickname,
                  confettiEnabled: m.confettiEnabled,
                )
              : m)
          .toList(),
    );
  }

  void _onChatReactionUpdate(dynamic data) {
    if (data is! Map) return;
    final messageId = '${data['messageId'] ?? ''}';
    if (messageId.isEmpty) return;
    final reactions = _mapChatReactions(data['reactions']);
    state = state.copyWith(
      messages: state.messages
          .map((m) => m.id == messageId
              ? ChatMessage(
                  id: m.id,
                  userId: m.userId,
                  nickname: m.nickname,
                  text: m.text,
                  timestamp: m.timestamp,
                  kind: m.kind,
                  imageUrl: m.imageUrl,
                  imageKey: m.imageKey,
                  asSticker: m.asSticker,
                  mentions: m.mentions,
                  replyTo: m.replyTo,
                  reactions: reactions,
                  memberTier: m.memberTier,
                  targetUserId: m.targetUserId,
                  targetNickname: m.targetNickname,
                  confettiEnabled: m.confettiEnabled,
                )
              : m)
          .toList(),
    );
  }

  void _onKicked(dynamic data) {
    final reason = data is Map ? '${data['reason'] ?? '你已被移出房间'}' : '你已被移出房间';
    state = state.copyWith(
      kickedReason: reason,
      clearRoom: true,
      clearPlayback: true,
      messages: const [],
    );
  }

  Future<void> joinRoom({
    required String roomId,
    required String nickname,
    String? password,
  }) async {
    state = state.copyWith(joining: true, clearError: true, kickedReason: null);
    try {
      final res = await OmSocket.emitAck('join_room', {
        'roomId': roomId,
        'nickname': nickname.trim(),
        if (password != null && password.trim().isNotEmpty)
          'password': password.trim(),
        'readOnly': false,
        'rejoin': false,
      });
      if (res['success'] != true || res['room'] is! Map) {
        throw StateError(res['error']?.toString() ?? '进房失败');
      }
      final room = RoomState.fromJson(Map<String, dynamic>.from(res['room'] as Map));
      final messages = (res['messages'] is List)
          ? (res['messages'] as List)
              .whereType<Map>()
              .map((e) => ChatMessage.fromJson(Map<String, dynamic>.from(e)))
              .where((message) {
                final visibleSince = room.chatVisibleSince;
                if (visibleSince == null || visibleSince <= 0) return true;
                return message.timestamp <= 0 || message.timestamp >= visibleSince;
              })
              .toList()
          : <ChatMessage>[];
      PlaybackState? playback;
      if (res['playbackState'] is Map) {
        playback = PlaybackState.fromJson(
          Map<String, dynamic>.from(res['playbackState'] as Map),
        );
      }
      state = RoomSessionState(
        room: room,
        playback: playback,
        mySocketId: res['socketId'] as String?,
        myConnectionId: res['connectionId'] as String?,
        messages: messages,
        hasMoreOlder: room.chatVisibleSince != null || messages.length >= 50,
        loadingOlder: false,
        joining: false,
      );
    } catch (e) {
      state = state.copyWith(joining: false, error: e.toString());
      rethrow;
    }
  }

  Future<void> leaveRoom() async {
    try {
      await OmSocket.emitAck('leave_room', {});
    } catch (_) {}
    state = const RoomSessionState();
  }

  Future<Map<String, dynamic>> addSong(Song song) async {
    return OmSocket.emitAck('add_song', {'song': song.toJson()});
  }

  Future<Map<String, dynamic>> removeSong(String queueId) async {
    return OmSocket.emitAck('remove_song', {'queueId': queueId});
  }

  Future<Map<String, dynamic>> clearQueue() async {
    return OmSocket.emitAck('clear_queue', {});
  }

  Future<Map<String, dynamic>> skipSong() async {
    return OmSocket.emitAck('skip_song', {});
  }

  Future<Map<String, dynamic>> togglePlay([bool? isPlaying]) async {
    final next = isPlaying ?? !(state.room?.isPlaying ?? false);
    return OmSocket.emitAck('toggle_play', {'isPlaying': next});
  }

  /// Instant UI/audio clock update — do not wait for socket ack.
  void applyOptimisticPlaying(bool play) {
    final room = state.room;
    if (room == null) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    final pb = state.playback;
    // Freeze at receive-anchor while still marked playing; do not keep extrapolating.
    final pos = () {
      if (pb == null) return room.currentTime;
      if (pb.isPlaying) return pb.estimatedPosition();
      if (pb.positionSec >= 0) return pb.positionSec;
      return pb.currentTime;
    }();
    final trackId = room.current?.queueId ?? pb?.trackId ?? '';
    // Bump local version so a delayed older "playing" snapshot cannot undo pause.
    final nextVersion = (pb?.version ?? 0) + 1;
    state = state.copyWith(
      room: room.copyWith(isPlaying: play, currentTime: pos),
      playback: PlaybackState(
        roomId: room.id,
        version: nextVersion,
        trackId: trackId,
        status: play ? 'playing' : 'paused',
        positionSec: pos,
        durationSec: pb?.durationSec ?? room.current?.duration,
        serverNowMs: now,
        startedAt: play ? now - (pos * 1000).round() : 0,
        currentTime: pos,
        updatedAt: now,
        mediaUrl: pb?.mediaUrl,
        mediaQuality: pb?.mediaQuality,
        receivedAtMs: now,
      ),
    );
  }

  /// Instant seek UI — mirrors web `optimisticSeekPosition`.
  void applyOptimisticSeek(double positionSec) {
    final room = state.room;
    if (room == null) return;
    final pos = positionSec < 0 ? 0.0 : positionSec;
    final now = DateTime.now().millisecondsSinceEpoch;
    final pb = state.playback;
    final playing = pb?.isPlaying ?? room.isPlaying;
    final trackId = room.current?.queueId ?? pb?.trackId ?? '';
    // Bump so a delayed pre-seek snapshot cannot yank the scrubber back.
    final nextVersion = (pb?.version ?? 0) + 1;
    state = state.copyWith(
      room: room.copyWith(currentTime: pos),
      playback: PlaybackState(
        roomId: room.id,
        version: nextVersion,
        trackId: trackId,
        status: playing ? 'playing' : 'paused',
        positionSec: pos,
        durationSec: pb?.durationSec ?? room.current?.duration,
        serverNowMs: now,
        startedAt: playing ? now - (pos * 1000).round() : 0,
        currentTime: pos,
        updatedAt: now,
        mediaUrl: pb?.mediaUrl,
        mediaQuality: pb?.mediaQuality,
        receivedAtMs: now,
      ),
    );
  }

  Future<Map<String, dynamic>> seek(double positionSec) async {
    return OmSocket.emitAck('seek', {'time': positionSec});
  }

  Future<Map<String, dynamic>> finishSong() async {
    return OmSocket.emitAck('finish_song', {});
  }

  Future<Map<String, dynamic>> reportPlaybackMedia({
    required String trackId,
    required String url,
    String? qualityLabel,
  }) async {
    return OmSocket.emitAck('report_playback_media', {
      'trackId': trackId,
      'url': url,
      if (qualityLabel != null) 'qualityLabel': qualityLabel,
    });
  }

  Future<Map<String, dynamic>> sendChat(
    String text, {
    List<ChatMention>? mentions,
    ChatReplyRef? replyTo,
    String? imageUrl,
    String? imageKey,
    bool? asSticker,
  }) async {
    return OmSocket.emitAck('send_chat', {
      'text': text,
      if (mentions != null && mentions.isNotEmpty)
        'mentions': mentions.map((m) => m.toJson()).toList(),
      if (replyTo != null) 'replyTo': replyTo.toJson(),
      if (imageUrl != null && imageUrl.isNotEmpty) 'imageUrl': imageUrl,
      if (imageKey != null && imageKey.isNotEmpty) 'imageKey': imageKey,
      if (asSticker != null) 'asSticker': asSticker,
    });
  }

  Future<Map<String, dynamic>> recallChat(String messageId) async {
    return OmSocket.emitAck('recall_chat', {'messageId': messageId});
  }

  Future<Map<String, dynamic>> toggleChatReaction(String messageId, String emoji) async {
    return OmSocket.emitAck('toggle_chat_reaction', {
      'messageId': messageId,
      'emoji': emoji,
    });
  }

  Future<Map<String, dynamic>> renameUser(String nickname) async {
    final res = await OmSocket.emitAck('rename_user', {'nickname': nickname.trim()});
    if (res['success'] == true && res['room'] is Map) {
      state = state.copyWith(
        room: RoomState.fromJson(Map<String, dynamic>.from(res['room'] as Map)),
      );
    }
    return res;
  }

  Future<Map<String, dynamic>> setUserAvatar(String avatarUrl) async {
    final trimmed = avatarUrl.trim();
    final res = await OmSocket.emitAck('set_user_avatar', {'avatar_url': trimmed});
    if (res['success'] == true) {
      await LocalCache.setAvatarUrl(trimmed);
      if (res['room'] is Map) {
        state = state.copyWith(
          room: RoomState.fromJson(Map<String, dynamic>.from(res['room'] as Map)),
        );
      }
    }
    return res;
  }

  /// 进房/重连后把本机缓存头像同步到房间（对齐网页端 localStorage）。
  Future<void> syncLocalAvatar() async {
    final local = (await LocalCache.getAvatarUrl()).trim();
    if (local.isEmpty || state.room == null) return;
    try {
      await setUserAvatar(local);
    } catch (_) {}
  }

  Future<Map<String, dynamic>> setChatMute({
    bool? muteAll,
    String? userId,
    bool? muted,
  }) async {
    return OmSocket.emitAck('set_chat_mute', {
      if (muteAll != null) 'muteAll': muteAll,
      if (userId != null) 'userId': userId,
      if (muted != null) 'muted': muted,
    });
  }

  Future<Map<String, dynamic>> setRoomChatAvatars(bool enabled) async {
    return OmSocket.emitAck('set_room_chat_avatars', {'enabled': enabled});
  }

  Future<Map<String, dynamic>> setChatHistoryVisibleOnJoin(bool enabled) async {
    return OmSocket.emitAck('set_room_chat_history', {'enabled': enabled});
  }

  Future<Map<String, dynamic>> setRoomJoinNotice({
    required bool enabled,
    required int cooldownSec,
  }) async {
    return OmSocket.emitAck('set_room_join_notice', {
      'enabled': enabled,
      'cooldownSec': cooldownSec,
    });
  }

  Future<Map<String, dynamic>> kickUser(String userId) async {
    return OmSocket.emitAck('kick_user', {'userId': userId});
  }

  Future<Map<String, dynamic>> setRoomMemberTier(String userId, RoomMemberTier tier) async {
    final res = await OmSocket.emitAck('set_room_member_tier', {
      'userId': userId,
      'tier': tier.toPayload(),
    });
    if (res['success'] == true && res['room'] is Map) {
      state = state.copyWith(
        room: RoomState.fromJson(Map<String, dynamic>.from(res['room'] as Map)),
      );
    }
    return res;
  }

  Future<Map<String, dynamic>> removeRoomMemberTier(String userId) async {
    final res = await OmSocket.emitAck('remove_room_member_tier', {'userId': userId});
    if (res['success'] == true && res['room'] is Map) {
      state = state.copyWith(
        room: RoomState.fromJson(Map<String, dynamic>.from(res['room'] as Map)),
      );
    }
    return res;
  }

  Future<Map<String, dynamic>> setRoomMemberSettings(RoomMemberSettings settings) async {
    final res = await OmSocket.emitAck('set_room_member_settings', {
      'welcomeEnabled': settings.welcomeEnabled,
      'welcomeTemplateId': settings.welcomeTemplateId,
      'welcomeCustomText': settings.welcomeCustomText ?? '',
      'confettiEnabled': settings.confettiEnabled,
      'welcomeCooldownSec': settings.welcomeCooldownSec,
    });
    if (res['success'] == true && res['room'] is Map) {
      state = state.copyWith(
        room: RoomState.fromJson(Map<String, dynamic>.from(res['room'] as Map)),
      );
    }
    return res;
  }

  Future<Map<String, dynamic>> setRoomAdmin(String userId, bool admin) async {
    final res = await OmSocket.emitAck('set_room_admin', {
      'userId': userId,
      'admin': admin,
    });
    if (res['success'] == true && res['room'] is Map) {
      state = state.copyWith(
        room: RoomState.fromJson(Map<String, dynamic>.from(res['room'] as Map)),
      );
    }
    return res;
  }

  Future<Map<String, dynamic>> transferOwner(String userId) async {
    final res = await OmSocket.emitAck('transfer_owner', {'userId': userId});
    if (res['success'] == true && res['room'] is Map) {
      state = state.copyWith(
        room: RoomState.fromJson(Map<String, dynamic>.from(res['room'] as Map)),
      );
    }
    return res;
  }

  Future<Map<String, dynamic>> applyRoomPermanent({String? note}) async {
    final res = await OmSocket.emitAck('apply_room_permanent', {
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    });
    if (res['success'] == true && res['room'] is Map) {
      state = state.copyWith(
        room: RoomState.fromJson(Map<String, dynamic>.from(res['room'] as Map)),
      );
    }
    return res;
  }

  Future<Map<String, dynamic>> cancelRoomPermanent() async {
    final res = await OmSocket.emitAck('cancel_room_permanent', {});
    if (res['success'] == true && res['room'] is Map) {
      state = state.copyWith(
        room: RoomState.fromJson(Map<String, dynamic>.from(res['room'] as Map)),
      );
    }
    return res;
  }

  Future<Map<String, dynamic>> setRoomLock(bool locked) async {
    return OmSocket.emitAck('set_room_lock', {'locked': locked});
  }

  Future<Map<String, dynamic>> renameRoom(String name) async {
    return OmSocket.emitAck('rename_room', {'name': name});
  }

  Future<Map<String, dynamic>> setRoomAnnouncement({
    required bool enabled,
    String? text,
  }) async {
    return OmSocket.emitAck('set_room_announcement', {
      'enabled': enabled,
      'text': text ?? '',
    });
  }

  Future<Map<String, dynamic>> setRoomCustomCover(String coverUrl) async {
    final res = await OmSocket.emitAck('set_room_custom_cover', {'coverUrl': coverUrl});
    if (res['success'] == true && res['room'] is Map) {
      state = state.copyWith(
        room: RoomState.fromJson(Map<String, dynamic>.from(res['room'] as Map)),
      );
    }
    return res;
  }

  Future<Map<String, dynamic>> setRoomFmMode(String mode) async {
    return OmSocket.emitAck('set_room_fm_mode', {'mode': mode});
  }

  Future<Map<String, dynamic>> setRoomPlayMode(String mode) async {
    return OmSocket.emitAck('set_room_play_mode', {'mode': mode});
  }

  Future<Map<String, dynamic>> setSongRequestEnabled(
    bool enabled, {
    bool? memberJumpEnabled,
    bool? memberSeekEnabled,
    bool? memberPauseEnabled,
    bool? systemMediaPlayBound,
    bool? systemMediaSkipBound,
    String? dislikeSkipMode,
    int? dislikeSkipThreshold,
    int? dislikeSkipPercent,
    bool? clearSongsOnLeaveEnabled,
    int? clearSongsOnLeaveDelaySec,
    int? minStaySec,
    int? maxPerUser,
    int? cooldownSec,
    int? queueMaxLength,
  }) async {
    return OmSocket.emitAck('set_room_song_request', {
      'enabled': enabled,
      if (memberJumpEnabled != null) 'memberJumpEnabled': memberJumpEnabled,
      if (memberSeekEnabled != null) 'memberSeekEnabled': memberSeekEnabled,
      if (memberPauseEnabled != null) 'memberPauseEnabled': memberPauseEnabled,
      if (systemMediaPlayBound != null) 'systemMediaPlayBound': systemMediaPlayBound,
      if (systemMediaSkipBound != null) 'systemMediaSkipBound': systemMediaSkipBound,
      if (dislikeSkipMode != null) 'dislikeSkipMode': dislikeSkipMode,
      if (dislikeSkipThreshold != null) 'dislikeSkipThreshold': dislikeSkipThreshold,
      if (dislikeSkipPercent != null) 'dislikeSkipPercent': dislikeSkipPercent,
      if (clearSongsOnLeaveEnabled != null)
        'clearSongsOnLeaveEnabled': clearSongsOnLeaveEnabled,
      if (clearSongsOnLeaveDelaySec != null)
        'clearSongsOnLeaveDelaySec': clearSongsOnLeaveDelaySec,
      if (minStaySec != null) 'minStaySec': minStaySec,
      if (maxPerUser != null) 'maxPerUser': maxPerUser,
      if (cooldownSec != null) 'cooldownSec': cooldownSec,
      if (queueMaxLength != null) 'queueMaxLength': queueMaxLength,
    });
  }

  Future<Map<String, dynamic>> listFavorites() async {
    return OmSocket.emitAck('list_favorites', {});
  }

  Future<Map<String, dynamic>> setFavorite(Song song, bool favorite) async {
    return OmSocket.emitAck('set_favorite', {
      'song': song.toJson(),
      'favorite': favorite,
    });
  }

  Future<Map<String, dynamic>> toggleQueueLike(String queueId) async {
    return OmSocket.emitAck('toggle_queue_like', {'queueId': queueId});
  }

  Future<Map<String, dynamic>> banRoomSong(Song song) async {
    final res = await OmSocket.emitAck('ban_room_song', {'song': song.toJson()});
    if (res['success'] == true && res['room'] is Map) {
      state = state.copyWith(
        room: RoomState.fromJson(Map<String, dynamic>.from(res['room'] as Map)),
      );
    }
    return res;
  }

  Future<Map<String, dynamic>> unbanRoomSong(String name) async {
    final res = await OmSocket.emitAck('unban_room_song', {'name': name});
    if (res['success'] == true && res['room'] is Map) {
      state = state.copyWith(
        room: RoomState.fromJson(Map<String, dynamic>.from(res['room'] as Map)),
      );
    }
    return res;
  }

  Future<Map<String, dynamic>> addRoomForbiddenWord(String word) async {
    final res = await OmSocket.emitAck('add_room_forbidden_word', {'word': word.trim()});
    if (res['success'] == true && res['room'] is Map) {
      state = state.copyWith(
        room: RoomState.fromJson(Map<String, dynamic>.from(res['room'] as Map)),
      );
    }
    return res;
  }

  Future<Map<String, dynamic>> removeRoomForbiddenWord(String word) async {
    final res = await OmSocket.emitAck('remove_room_forbidden_word', {'word': word});
    if (res['success'] == true && res['room'] is Map) {
      state = state.copyWith(
        room: RoomState.fromJson(Map<String, dynamic>.from(res['room'] as Map)),
      );
    }
    return res;
  }

  Future<Map<String, dynamic>> toggleCurrentDislike() async {
    return OmSocket.emitAck('toggle_current_dislike', {});
  }

  Future<Map<String, dynamic>> requestSkip() async {
    return OmSocket.emitAck('request_skip', {});
  }

  Future<Map<String, dynamic>> approveSkip(String requestId) async {
    return OmSocket.emitAck('approve_skip', {'requestId': requestId});
  }

  Future<Map<String, dynamic>> rejectSkip(String requestId) async {
    return OmSocket.emitAck('reject_skip', {'requestId': requestId});
  }

  Future<Map<String, dynamic>> requestJump(String queueId) async {
    return OmSocket.emitAck('request_jump', {'queueId': queueId});
  }

  Future<Map<String, dynamic>> approveJump(String requestId) async {
    return OmSocket.emitAck('approve_jump', {'requestId': requestId});
  }

  Future<Map<String, dynamic>> rejectJump(String requestId) async {
    return OmSocket.emitAck('reject_jump', {'requestId': requestId});
  }

  Future<List<Song>> loadSongHistory({int limit = 50}) async {
    final res = await OmSocket.emitAck('load_song_history', {'limit': limit});
    if (res['success'] == false) {
      throw StateError('${res['error'] ?? '加载播放历史失败'}');
    }
    final raw = res['songs'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((e) => Song.fromJson(Map<String, dynamic>.from(e)))
        .where((s) => s.id.isNotEmpty)
        .toList();
  }

  Future<void> loadChatHistory({
    required int before,
    required String beforeId,
    int limit = 50,
  }) async {
    if (state.loadingOlder) return;
    state = state.copyWith(loadingOlder: true);
    try {
      final res = await OmSocket.emitAck('load_chat_history', {
        'before': before,
        'beforeId': beforeId,
        'limit': limit,
      });
      if (res['success'] == false) {
        throw StateError('${res['error'] ?? '加载聊天记录失败'}');
      }
      final incoming = (res['messages'] is List)
          ? (res['messages'] as List)
              .whereType<Map>()
              .map((e) => ChatMessage.fromJson(Map<String, dynamic>.from(e)))
              .where((message) => !_shouldHideMessage(message))
              .toList()
          : const <ChatMessage>[];
      final merged = [...incoming, ...state.messages];
      final deduped = <ChatMessage>[];
      final seen = <String>{};
      for (final message in merged) {
        if (seen.add(message.id)) {
          deduped.add(message);
        }
      }
      deduped.sort((a, b) => a.timestamp.compareTo(b.timestamp));
      state = state.copyWith(
        messages: deduped,
        hasMoreOlder: res['hasMore'] == true,
        loadingOlder: false,
      );
    } catch (_) {
      state = state.copyWith(loadingOlder: false);
      rethrow;
    }
  }
}

final roomSessionProvider =
    StateNotifierProvider<RoomSessionNotifier, RoomSessionState>(
  (ref) => RoomSessionNotifier(),
);

List<ChatReactionGroup> _mapChatReactions(dynamic raw) {
  if (raw is! List) return const [];
  return raw
      .whereType<Map>()
      .map((e) => ChatReactionGroup.fromJson(Map<String, dynamic>.from(e)))
      .where((group) => group.emoji.isNotEmpty)
      .toList();
}
