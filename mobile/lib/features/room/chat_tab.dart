import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openmusic/app/theme.dart';
import 'package:openmusic/data/chat_media_api.dart';
import 'package:openmusic/data/socket_room_repository.dart';
import 'package:openmusic/data/sticker_api.dart';
import 'package:openmusic/data/user_sticker_store.dart';
import 'package:openmusic/domain/models.dart';
import 'package:openmusic/domain/permissions.dart';
import 'package:openmusic/features/room/chat_utils.dart';
import 'package:openmusic/features/room/member_tier_ui.dart';
import 'package:openmusic/features/room/qq_face.dart';
import 'package:openmusic/widgets/om_cover_image.dart';
import 'package:openmusic/widgets/om_dialog.dart';
import 'package:openmusic/widgets/om_ui.dart';
import 'package:image_picker/image_picker.dart';

class ChatTab extends ConsumerStatefulWidget {
  const ChatTab({super.key});

  @override
  ConsumerState<ChatTab> createState() => _ChatTabState();
}

class _MentionOption {
  const _MentionOption.all()
      : type = _MentionKind.all,
        user = null;
  const _MentionOption.user(this.user) : type = _MentionKind.user;

  final _MentionKind type;
  final RoomUser? user;

  String get label =>
      type == _MentionKind.all ? mentionAllLabel : (user?.nickname ?? '');
}

enum _MentionKind { all, user }

class _PendingChatImage {
  const _PendingChatImage({
    required this.localPath,
    required this.url,
    required this.key,
  });

  final String localPath;
  final String url;
  final String key;
}

class _ChatTabState extends ConsumerState<ChatTab> {
  final _ctrl = TextEditingController();
  final _focus = FocusNode();
  final _scroll = ScrollController();
  var _showEmoji = false;
  var _showMentionPicker = false;
  var _mentionQuery = '';
  var _mentionIndex = 0;
  var _followTail = true;
  var _lastMessageCount = 0;
  ChatReplyRef? _replyTo;
  List<QFaceItem> _faces = QFaceCatalog.popular();
  final ImagePicker _imagePicker = ImagePicker();
  _PendingChatImage? _pendingImage;
  var _uploadingImage = false;
  var _chatUploadEnabled = false;
  var _stickerSearchEnabled = false;

  @override
  void initState() {
    super.initState();
    _ctrl.addListener(_onDraftChanged);
    _scroll.addListener(_onScrollChanged);
    QFaceCatalog.load().then((faces) {
      if (mounted) setState(() => _faces = faces);
    });
    _loadChatUploadEnabled();
    _loadStickerSearchEnabled();
  }

  Future<void> _loadChatUploadEnabled() async {
    final enabled = await ChatMediaApi.fetchChatUploadEnabled();
    if (mounted) setState(() => _chatUploadEnabled = enabled);
  }

  Future<void> _loadStickerSearchEnabled() async {
    final enabled = await StickerApi.fetchStickerSearchEnabled();
    if (mounted) setState(() => _stickerSearchEnabled = enabled);
  }

  void _onScrollChanged() {
    if (!_scroll.hasClients) return;
    final distance = _scroll.position.maxScrollExtent - _scroll.offset;
    final nextFollowTail = distance < 72;
    if (nextFollowTail != _followTail) {
      setState(() => _followTail = nextFollowTail);
    }
  }

  void _maybeScrollToBottom({bool force = false}) {
    if (!_scroll.hasClients) return;
    if (!force && !_followTail) return;
    _scroll.animateTo(
      _scroll.position.maxScrollExtent,
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOutCubic,
    );
  }

  void _onDraftChanged() {
    final room = ref.read(roomSessionProvider).room;
    if (room == null) return;
    final cursor = _ctrl.selection.baseOffset;
    final query = getMentionQueryBeforeCursor(
      _ctrl.text,
      cursor < 0 ? _ctrl.text.length : cursor,
    );
    final nicknames = room.users.map((u) => u.nickname);
    if (query == null || isCompletedMentionQuery(query, nicknames)) {
      if (_showMentionPicker) {
        setState(() {
          _showMentionPicker = false;
          _mentionQuery = '';
          _mentionIndex = 0;
        });
      }
      return;
    }
    setState(() {
      _showMentionPicker = true;
      _showEmoji = false;
      _mentionQuery = query;
      _mentionIndex = 0;
    });
  }

  List<_MentionOption> _mentionOptions(RoomState room, RoomRoles roles, String? myId) {
    final options = <_MentionOption>[];
    if (roles.canControlPlayback && matchesMentionAllQuery(_mentionQuery)) {
      options.add(const _MentionOption.all());
    }
    for (final user in room.users) {
      if (user.id == myId || user.readOnly) continue;
      if (!mentionQueryMatchesNickname(_mentionQuery, user.nickname)) continue;
      options.add(_MentionOption.user(user));
      if (options.length >= 8) break;
    }
    return options;
  }

  Future<void> _send([String? overrideText]) async {
    final session = ref.read(roomSessionProvider);
    final room = session.room;
    if (room == null) return;
    if (isSelfChatMuted(room, session.mySocketId)) return;

    final text = (overrideText ?? _ctrl.text).trim();
    final replyTo = _replyTo;
    final pendingImage = _pendingImage;
    if (text.isEmpty && replyTo == null && pendingImage == null) return;
    if (text.length > maxChatLength) {
      omSnack(context, '消息最多 $maxChatLength 字');
      return;
    }

    final mentions = buildMentions(
      messageText: text,
      users: room.users,
      myUserId: session.mySocketId,
    );
    if (overrideText == null) {
      _ctrl.clear();
      setState(() {
        _showEmoji = false;
        _showMentionPicker = false;
        _followTail = true;
        _replyTo = null;
        _pendingImage = null;
      });
    } else {
      setState(() {
        _showEmoji = false;
        _followTail = true;
      });
    }

    final res = await ref.read(roomSessionProvider.notifier).sendChat(
          text,
          mentions: mentions,
          replyTo: replyTo,
          imageUrl: pendingImage?.url,
          imageKey: pendingImage?.key,
        );
    if (res['success'] != true && mounted) {
      if (overrideText == null) {
        _ctrl.text = text;
        _ctrl.selection = TextSelection.collapsed(offset: text.length);
      }
      setState(() {
        _replyTo = replyTo;
        _pendingImage = pendingImage;
      });
      omSnack(context, '${res['error'] ?? '发送失败'}');
    }
  }

  Future<void> _captureImage() async {
    final room = ref.read(roomSessionProvider).room;
    if (room == null || _uploadingImage) return;
    try {
      final picked = await _imagePicker.pickImage(
        source: ImageSource.camera,
        imageQuality: 92,
      );
      if (picked == null) return;
      setState(() => _uploadingImage = true);
      final uploaded = await ChatMediaApi.uploadChatImage(
        roomId: room.id,
        file: File(picked.path),
      );
      if (!mounted) return;
      setState(() {
        _uploadingImage = false;
        _pendingImage = _PendingChatImage(
          localPath: uploaded.localPath,
          url: uploaded.url,
          key: uploaded.key,
        );
        _showEmoji = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _uploadingImage = false);
      omSnack(context, '$e');
    }
  }

  Future<void> _openStickerSearch() async {
    final room = ref.read(roomSessionProvider).room;
    if (room == null) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _StickerSearchSheet(roomId: room.id),
    );
  }

  Future<void> _openMyStickers() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _MyStickerSheet(),
    );
  }

  void _insertFace(QFaceItem face) {
    final value = _ctrl.value;
    final start = value.selection.start >= 0 ? value.selection.start : value.text.length;
    final end = value.selection.end >= 0 ? value.selection.end : value.text.length;
    final next = value.text.replaceRange(start, end, face.token);
    final cursor = start + face.token.length;
    _ctrl.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: cursor),
    );
  }

  void _applyMention(_MentionOption option) {
    final value = _ctrl.value;
    final cursor = value.selection.baseOffset < 0
        ? value.text.length
        : value.selection.baseOffset;
    final before = value.text.substring(0, cursor);
    final atIndex = before.lastIndexOf('@');
    if (atIndex < 0) return;
    final token = buildMentionPrefix(option.label);
    final next = value.text.replaceRange(atIndex, cursor, token);
    final nextCursor = atIndex + token.length;
    _ctrl.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: nextCursor),
    );
    setState(() {
      _showMentionPicker = false;
      _mentionQuery = '';
      _mentionIndex = 0;
    });
    _focus.requestFocus();
  }

  void _mentionUser(RoomUser user) {
    final token = buildMentionPrefix(user.nickname);
    final value = _ctrl.value;
    final start = value.selection.start >= 0 ? value.selection.start : value.text.length;
    final end = value.selection.end >= 0 ? value.selection.end : value.text.length;
    final next = value.text.replaceRange(start, end, token);
    final cursor = start + token.length;
    _ctrl.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: cursor),
    );
    setState(() {
      _showEmoji = false;
      _showMentionPicker = false;
    });
    _focus.requestFocus();
  }

  Future<void> _openMuteSheet() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _ChatMuteSheet(),
    );
  }

  Future<void> _loadOlder() async {
    final session = ref.read(roomSessionProvider);
    final messages = session.messages;
    if (messages.isEmpty) return;
    final first = messages.first;
    try {
      await ref.read(roomSessionProvider.notifier).loadChatHistory(
            before: first.timestamp,
            beforeId: first.id,
          );
    } catch (e) {
      if (mounted) omSnack(context, '$e');
    }
  }

  void _startReply(ChatMessage message) {
    setState(() {
      _replyTo = ChatReplyRef(
        id: message.id,
        userId: message.userId,
        nickname: message.nickname,
        text: message.text,
        imageUrl: message.imageUrl,
        asSticker: message.asSticker,
      );
      _showEmoji = false;
      _showMentionPicker = false;
    });
    _focus.requestFocus();
  }

  Future<void> _recallMessage(ChatMessage message) async {
    final res = await ref.read(roomSessionProvider.notifier).recallChat(message.id);
    if (!mounted) return;
    if (res['success'] != true) {
      omSnack(context, '${res['error'] ?? '撤回失败'}');
    }
  }

  Future<void> _toggleReaction(ChatMessage message, String emoji) async {
    final res = await ref.read(roomSessionProvider.notifier).toggleChatReaction(message.id, emoji);
    if (!mounted) return;
    if (res['success'] != true) {
      omSnack(context, '${res['error'] ?? '操作失败'}');
    }
  }

  bool _canRecall(ChatMessage message, RoomState? room, RoomRoles? roles, String? myId) {
    if (room == null || roles == null || myId == null || myId.isEmpty) return false;
    if (message.kind != 'chat') return false;
    final isSelf = message.userId == myId;
    if (!isSelf && !canModerate(roles)) return false;
    if (!isSelf && canModerate(roles)) {
      if (room.creatorId != null && message.userId == room.creatorId) return false;
      if (!roles.isOwner && room.adminIds.contains(message.userId)) return false;
      return true;
    }
    if (isSelf && !canModerate(roles)) {
      final now = DateTime.now().millisecondsSinceEpoch;
      return now - message.timestamp <= const Duration(minutes: 2).inMilliseconds;
    }
    return true;
  }

  Future<void> _openMessageActions(
    ChatMessage message, {
    required RoomState? room,
    required RoomRoles? roles,
    required String? myId,
    required bool muted,
  }) async {
    final canRecall = _canRecall(message, room, roles, myId);
    final canReply = !muted && message.kind == 'chat';
    final canReact = !muted && message.kind == 'chat';
    if (!canReply && !canRecall && !canReact) return;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => SafeArea(
        child: Container(
          margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          decoration: BoxDecoration(
            color: OmTheme.card,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (canReply)
                ListTile(
                  leading: const Icon(Icons.reply_rounded, color: OmTheme.textPrimary),
                  title: const Text('回复', style: TextStyle(color: OmTheme.textPrimary)),
                  onTap: () {
                    Navigator.pop(ctx);
                    _startReply(message);
                  },
                ),
              if (canReact)
                ListTile(
                  leading: const Icon(Icons.emoji_emotions_outlined, color: Color(0xFFF6D365)),
                  title: const Text('点评表情', style: TextStyle(color: OmTheme.textPrimary)),
                  onTap: () async {
                    Navigator.pop(ctx);
                    await showModalBottomSheet<void>(
                      context: context,
                      backgroundColor: Colors.transparent,
                      builder: (sheetCtx) => _ReactionPickerSheet(
                        onPick: (emoji) async {
                          Navigator.pop(sheetCtx);
                          await _toggleReaction(message, emoji);
                        },
                      ),
                    );
                  },
                ),
              if (canRecall)
                ListTile(
                  leading: const Icon(Icons.undo_rounded, color: Color(0xFFFBBF24)),
                  title: const Text('撤回消息', style: TextStyle(color: OmTheme.textPrimary)),
                  onTap: () {
                    Navigator.pop(ctx);
                    _recallMessage(message);
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _ctrl.removeListener(_onDraftChanged);
    _scroll.removeListener(_onScrollChanged);
    _ctrl.dispose();
    _focus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(roomSessionProvider);
    final room = session.room;
    final messages = session.messages;
    final myId = session.mySocketId;
    final roles = session.rolesOrNull;
    final muted = isSelfChatMuted(room, myId);
    final hasMoreOlder = session.hasMoreOlder;
    final loadingOlder = session.loadingOlder;
    final nicknames = room?.users.map((u) => u.nickname).toList() ?? const <String>[];
    final mentionOptions = room != null && roles != null
        ? _mentionOptions(room, roles, myId)
        : const <_MentionOption>[];

    if (messages.length != _lastMessageCount) {
      _lastMessageCount = messages.length;
      WidgetsBinding.instance.addPostFrameCallback((_) => _maybeScrollToBottom());
    }

    return Column(
      children: [
        if (room?.muteAll == true)
          Container(
            width: double.infinity,
            color: const Color(0x26FBBF24),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: const Text(
              '全体禁言中',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: Color(0xFFFBBF24)),
            ),
          ),
        if (room?.chatVisibleSince != null)
          Container(
            width: double.infinity,
            color: const Color(0x1F60A5FA),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: const Text(
              '当前仅显示你进房后的消息',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: Color(0xFF93C5FD)),
            ),
          ),
        Expanded(
          child: messages.isEmpty
              ? const OmEmptyState(
                  icon: Icons.chat_bubble_outline_rounded,
                  title: '还没有消息',
                  subtitle: '和大家打个招呼吧',
                )
              : ListView.builder(
                  controller: _scroll,
                  physics: const BouncingScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
                  itemCount: messages.length + (hasMoreOlder ? 1 : 0),
                  itemBuilder: (context, i) {
                    if (hasMoreOlder && i == 0) {
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Center(
                          child: OutlinedButton(
                            onPressed: loadingOlder ? null : _loadOlder,
                            child: Text(loadingOlder ? '加载中…' : '加载更早消息'),
                          ),
                        ),
                      );
                    }
                    final index = hasMoreOlder ? i - 1 : i;
                    final m = messages[index];
                    final isSystem = m.kind == 'system' || m.kind == 'notice';
                    if (m.kind == 'welcome') {
                      return _WelcomeBubble(message: m);
                    }
                    if (isSystem || m.kind == 'recall') {
                      return _SystemBubble(
                        text: m.kind == 'recall' ? '消息已撤回' : m.text,
                      );
                    }
                    final isMe = myId != null && m.userId == myId;
                    final showName = !isMe &&
                        (index == 0 ||
                            messages[index - 1].userId != m.userId ||
                            _isSystem(messages[index - 1]));
                    final stillInRoom = room?.users.any((u) => u.id == m.userId) == true;
                    final isOwner = room?.creatorId == m.userId;
                    final isAdmin = room != null &&
                        !isOwner &&
                        (room.adminIds.contains(m.userId) ||
                            room.autoPromotedAdminIds.contains(m.userId) ||
                            room.ownerId == m.userId);
                    return _ChatBubble(
                      message: m,
                      myUserId: myId,
                      isMe: isMe,
                      showName: showName,
                      showAvatar: room?.chatShowAvatars == true,
                      avatarUrl: room?.avatarUrlFor(m.userId),
                      nicknames: nicknames,
                      memberTier: room?.memberTiers[m.userId] ?? m.memberTier,
                      isOwner: isOwner,
                      isAdmin: isAdmin,
                      onToggleReaction: (emoji) => _toggleReaction(m, emoji),
                      onLongPress: () => _openMessageActions(
                        m,
                        room: room,
                        roles: roles,
                        myId: myId,
                        muted: muted,
                      ),
                      onMention: (!isMe && stillInRoom && !muted)
                          ? () {
                              final user = room!.users.firstWhere((u) => u.id == m.userId);
                              _mentionUser(user);
                            }
                          : null,
                    );
                  },
                ),
        ),
        if (!_followTail && messages.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            child: Align(
              alignment: Alignment.centerRight,
              child: FilledButton.tonalIcon(
                onPressed: () {
                  setState(() => _followTail = true);
                  WidgetsBinding.instance.addPostFrameCallback(
                    (_) => _maybeScrollToBottom(force: true),
                  );
                },
                icon: const Icon(Icons.south_rounded, size: 18),
                label: const Text('回到底部'),
              ),
            ),
          ),
        if (_showMentionPicker && mentionOptions.isNotEmpty)
          _MentionPicker(
            options: mentionOptions,
            selectedIndex: _mentionIndex.clamp(0, mentionOptions.length - 1),
            onSelect: _applyMention,
            onHoverIndex: (i) => setState(() => _mentionIndex = i),
          ),
        if (_replyTo != null)
          Container(
            decoration: const BoxDecoration(
              color: OmTheme.card,
              border: Border(top: BorderSide(color: OmTheme.divider, width: 0.5)),
            ),
            padding: const EdgeInsets.fromLTRB(14, 10, 8, 2),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '回复 ${_replyTo!.nickname}',
                        style: const TextStyle(
                          fontSize: 12,
                          color: Color(0xFF7DD3FC),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _replyPreview(_replyTo!),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12, color: OmTheme.textHint),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => setState(() => _replyTo = null),
                  icon: const Icon(Icons.close_rounded, size: 18, color: OmTheme.textHint),
                ),
              ],
            ),
          ),
        if (_pendingImage != null)
          Container(
            decoration: const BoxDecoration(
              color: OmTheme.card,
              border: Border(top: BorderSide(color: OmTheme.divider, width: 0.5)),
            ),
            padding: const EdgeInsets.fromLTRB(14, 10, 8, 8),
            child: Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: Image.file(
                    File(_pendingImage!.localPath),
                    width: 56,
                    height: 56,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => Container(
                      width: 56,
                      height: 56,
                      color: OmTheme.elevated,
                      alignment: Alignment.center,
                      child: const Icon(Icons.image_not_supported_outlined, color: OmTheme.textHint),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                const Expanded(
                  child: Text(
                    '已拍照，可附带文字一起发送',
                    style: TextStyle(fontSize: 12, color: OmTheme.textHint),
                  ),
                ),
                IconButton(
                  onPressed: () => setState(() => _pendingImage = null),
                  icon: const Icon(Icons.close_rounded, size: 18, color: OmTheme.textHint),
                ),
              ],
            ),
          ),
        Container(
          decoration: const BoxDecoration(
            color: OmTheme.card,
            border: Border(top: BorderSide(color: OmTheme.divider, width: 0.5)),
          ),
          padding: const EdgeInsets.fromLTRB(4, 8, 12, 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              if (roles != null && canModerate(roles))
                IconButton(
                  tooltip: '禁言管理',
                  onPressed: _openMuteSheet,
                  icon: Icon(
                    Icons.voice_over_off_outlined,
                    color: room?.muteAll == true
                        ? const Color(0xFFFBBF24)
                        : OmTheme.textSecondary,
                  ),
                ),
              IconButton(
                tooltip: 'QQ 表情',
                onPressed: muted
                    ? null
                    : () => setState(() {
                          _showEmoji = !_showEmoji;
                          if (_showEmoji) _showMentionPicker = false;
                        }),
                icon: Icon(
                  _showEmoji ? Icons.keyboard_alt_outlined : Icons.emoji_emotions_outlined,
                  color: muted
                      ? OmTheme.textHint
                      : (_showEmoji ? OmTheme.red : OmTheme.textSecondary),
                ),
              ),
              if (_chatUploadEnabled)
                IconButton(
                  tooltip: '拍照发送',
                  onPressed: muted || _uploadingImage ? null : _captureImage,
                  icon: Icon(
                    Icons.photo_camera_outlined,
                    color: muted || _uploadingImage ? OmTheme.textHint : OmTheme.textSecondary,
                  ),
                ),
              if (_stickerSearchEnabled)
                IconButton(
                  tooltip: '贴纸搜索',
                  onPressed: muted ? null : _openStickerSearch,
                  icon: Icon(
                    Icons.gif_box_outlined,
                    color: muted ? OmTheme.textHint : OmTheme.textSecondary,
                  ),
                ),
              IconButton(
                tooltip: '我的表情',
                onPressed: muted ? null : _openMyStickers,
                icon: Icon(
                  Icons.collections_outlined,
                  color: muted ? OmTheme.textHint : OmTheme.textSecondary,
                ),
              ),
              Expanded(
                child: Container(
                  constraints: const BoxConstraints(minHeight: 40),
                  decoration: BoxDecoration(
                    color: OmTheme.elevated,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: TextField(
                    controller: _ctrl,
                    focusNode: _focus,
                    enabled: !muted,
                    minLines: 1,
                    maxLines: 4,
                    style: TextStyle(
                      color: muted ? OmTheme.textHint : OmTheme.textPrimary,
                      fontSize: 14,
                    ),
                    decoration: InputDecoration(
                      hintText: muted
                          ? (room?.muteAll == true
                              ? '房主已开启全体禁言'
                              : '你已被禁言，无法发送消息')
                          : '说点什么… 输入 @ 可提及',
                      hintStyle: const TextStyle(color: OmTheme.textHint, fontSize: 14),
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      disabledBorder: InputBorder.none,
                      filled: false,
                      contentPadding:
                          const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      isDense: true,
                    ),
                    onTap: () {
                      if (_showEmoji) setState(() => _showEmoji = false);
                    },
                    onSubmitted: muted ? null : (_) => _send(),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              GestureDetector(
                onTap: muted || _uploadingImage ? null : _send,
                child: Opacity(
                  opacity: muted || _uploadingImage ? 0.4 : 1,
                  child: Container(
                    width: 40,
                    height: 40,
                    decoration: const BoxDecoration(
                      color: OmTheme.red,
                      shape: BoxShape.circle,
                    ),
                    child: _uploadingImage
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                            ),
                          )
                        : const Icon(Icons.send_rounded, size: 18, color: Colors.white),
                  ),
                ),
              ),
            ],
          ),
        ),
        if (_showEmoji && !muted)
          Container(
            height: 200,
            color: OmTheme.card,
            child: GridView.builder(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                maxCrossAxisExtent: 44,
                mainAxisSpacing: 6,
                crossAxisSpacing: 6,
                childAspectRatio: 1,
              ),
              itemCount: _faces.length,
              itemBuilder: (context, i) {
                final face = _faces[i];
                return InkWell(
                  borderRadius: BorderRadius.circular(8),
                  onTap: () => _insertFace(face),
                  onLongPress: () => _send(face.token),
                  child: Center(
                    child: SizedBox(
                      width: 32,
                      height: 32,
                      child: Image.network(
                        face.url,
                        fit: BoxFit.contain,
                        errorBuilder: (_, __, ___) => Text(
                          face.text.replaceFirst('/', ''),
                          style: const TextStyle(fontSize: 9, color: OmTheme.textHint),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
      ],
    );
  }

  bool _isSystem(ChatMessage m) =>
      m.kind == 'system' || m.kind == 'welcome' || m.kind == 'notice' || m.kind == 'recall';
}

class _MentionPicker extends StatelessWidget {
  const _MentionPicker({
    required this.options,
    required this.selectedIndex,
    required this.onSelect,
    required this.onHoverIndex,
  });

  final List<_MentionOption> options;
  final int selectedIndex;
  final ValueChanged<_MentionOption> onSelect;
  final ValueChanged<int> onHoverIndex;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxHeight: 220),
      decoration: const BoxDecoration(
        color: OmTheme.card,
        border: Border(top: BorderSide(color: OmTheme.divider, width: 0.5)),
      ),
      child: ListView.builder(
        shrinkWrap: true,
        padding: const EdgeInsets.symmetric(vertical: 4),
        itemCount: options.length,
        itemBuilder: (context, i) {
          final opt = options[i];
          final selected = i == selectedIndex;
          return InkWell(
            onTap: () => onSelect(opt),
            onHover: (_) => onHoverIndex(i),
            child: Container(
              color: selected ? OmTheme.elevated : Colors.transparent,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Row(
                children: [
                  Icon(
                    opt.type == _MentionKind.all
                        ? Icons.groups_outlined
                        : Icons.alternate_email_rounded,
                    size: 18,
                    color: const Color(0xFF7DD3FC),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      '@${opt.label}',
                      style: const TextStyle(
                        fontSize: 14,
                        color: Color(0xFF7DD3FC),
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _ChatMuteSheet extends ConsumerWidget {
  const _ChatMuteSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(roomSessionProvider);
    final room = session.room;
    if (room == null) return const SizedBox.shrink();
    final myId = session.mySocketId;
    final roles = session.rolesOrNull!;
    final mutedSet = room.mutedUserIds.toSet();
    final users = room.users
        .where((u) => u.id != myId)
        .toList()
      ..sort((a, b) => a.joinedAt.compareTo(b.joinedAt));

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.55,
      minChildSize: 0.35,
      maxChildSize: 0.85,
      builder: (context, scroll) {
        return Container(
          decoration: const BoxDecoration(
            color: OmTheme.card,
            borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
          ),
          child: Column(
            children: [
              const SizedBox(height: 10),
              Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: OmTheme.divider,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const Padding(
                padding: EdgeInsets.fromLTRB(20, 16, 20, 8),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    '禁言管理',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                      color: OmTheme.textPrimary,
                    ),
                  ),
                ),
              ),
              Expanded(
                child: ListView(
                  controller: scroll,
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 24),
                  children: [
                    if (roles.isOwner)
                      _MuteTile(
                        title: '全体禁言',
                        active: room.muteAll,
                        onTap: () async {
                          final res = await ref
                              .read(roomSessionProvider.notifier)
                              .setChatMute(muteAll: !room.muteAll);
                          if (res['success'] != true && context.mounted) {
                            omSnack(context, '${res['error'] ?? '操作失败'}');
                          }
                        },
                      ),
                    for (final user in users)
                      if (room.creatorId != user.id)
                        _MuteTile(
                          title: user.nickname,
                          active: mutedSet.contains(user.id),
                          onTap: () async {
                            final next = !mutedSet.contains(user.id);
                            final res = await ref
                                .read(roomSessionProvider.notifier)
                                .setChatMute(userId: user.id, muted: next);
                            if (res['success'] != true && context.mounted) {
                              omSnack(context, '${res['error'] ?? '操作失败'}');
                            }
                          },
                        ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _MuteTile extends StatelessWidget {
  const _MuteTile({
    required this.title,
    required this.active,
    required this.onTap,
  });

  final String title;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: active ? const Color(0x26FBBF24) : OmTheme.elevated,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      color: active ? const Color(0xFFFBBF24) : OmTheme.textPrimary,
                    ),
                  ),
                ),
                Text(
                  active ? '点击解禁' : '点击禁言',
                  style: const TextStyle(fontSize: 12, color: OmTheme.textHint),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SystemBubble extends StatelessWidget {
  const _SystemBubble({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(
            color: OmTheme.elevated.withValues(alpha: 0.6),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(
            text,
            style: const TextStyle(fontSize: 12, color: OmTheme.textHint),
          ),
        ),
      ),
    );
  }
}

class _WelcomeBubble extends StatelessWidget {
  const _WelcomeBubble({required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final targetName = (message.targetNickname ?? '').trim().isNotEmpty
        ? message.targetNickname!.trim()
        : message.nickname;
    final accent = message.memberTier == null
        ? const Color(0xFFF6D365)
        : memberTierColor(message.memberTier!.badgeColor);
    if (message.text.trim().isEmpty) {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 20),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: accent.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: accent.withValues(alpha: 0.45)),
        ),
        child: Column(
          children: [
            Wrap(
              alignment: WrapAlignment.center,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 8,
              runSpacing: 8,
              children: [
                if (message.memberTier != null) MemberTierBadge(tier: message.memberTier!),
                Text(
                  targetName,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: OmTheme.textPrimary,
                  ),
                ),
                if (message.confettiEnabled == true)
                  const Icon(Icons.auto_awesome_rounded, size: 16, color: Color(0xFFF6D365)),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              message.text,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 14,
                height: 1.45,
                color: OmTheme.textPrimary,
              ),
            ),
            finalTime(message.timestamp),
          ],
        ),
      ),
    );
  }

  Widget finalTime(int timestamp) {
    if (timestamp <= 0) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Text(
        _ChatBubble._formatTimestamp(timestamp),
        style: const TextStyle(fontSize: 10, color: OmTheme.textHint),
      ),
    );
  }
}

class _ChatBubble extends StatelessWidget {
  const _ChatBubble({
    required this.message,
    required this.myUserId,
    required this.isMe,
    required this.showName,
    required this.showAvatar,
    required this.nicknames,
    required this.onToggleReaction,
    required this.isOwner,
    required this.isAdmin,
    this.memberTier,
    this.avatarUrl,
    this.onLongPress,
    this.onMention,
  });

  final ChatMessage message;
  final String? myUserId;
  final bool isMe;
  final bool showName;
  final bool showAvatar;
  final List<String> nicknames;
  final ValueChanged<String> onToggleReaction;
  final bool isOwner;
  final bool isAdmin;
  final RoomMemberTier? memberTier;
  final String? avatarUrl;
  final VoidCallback? onLongPress;
  final VoidCallback? onMention;

  @override
  Widget build(BuildContext context) {
    final maxW = MediaQuery.of(context).size.width * (showAvatar && !isMe ? 0.68 : 0.72);
    final timeLabel = _formatTimestamp(message.timestamp);
    final style = TextStyle(
      fontSize: 14,
      color: isMe ? Colors.white : OmTheme.textPrimary,
      height: 1.45,
    );
    final mentionStyle = style.copyWith(
      color: isMe ? const Color(0xFFBAE6FD) : const Color(0xFF7DD3FC),
      fontWeight: FontWeight.w600,
    );

    final bubble = GestureDetector(
      onLongPress: onLongPress,
      child: Container(
        constraints: BoxConstraints(maxWidth: maxW),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: isMe ? OmTheme.red : OmTheme.card,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(14),
            topRight: const Radius.circular(14),
            bottomLeft: Radius.circular(isMe ? 14 : 4),
            bottomRight: Radius.circular(isMe ? 4 : 14),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (message.replyTo != null) ...[
              Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: isMe
                      ? Colors.white.withValues(alpha: 0.14)
                      : Colors.white.withValues(alpha: 0.06),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      message.replyTo!.nickname,
                      style: TextStyle(
                        fontSize: 11,
                        color: isMe ? const Color(0xFFDBEAFE) : const Color(0xFF7DD3FC),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _replyPreview(message.replyTo!),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        color: isMe ? Colors.white70 : OmTheme.textHint,
                        height: 1.35,
                      ),
                    ),
                  ],
                ),
              ),
            ],
            if (message.imageUrl != null && message.imageUrl!.trim().isNotEmpty) ...[
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: OmCoverImage(
                  url: message.imageUrl,
                  sizePx: 720,
                  fit: BoxFit.cover,
                  fallback: Container(
                    width: 180,
                    height: 120,
                    color: Colors.white.withValues(alpha: 0.08),
                    alignment: Alignment.center,
                    child: const Icon(
                      Icons.image_not_supported_outlined,
                      color: OmTheme.textHint,
                    ),
                  ),
                ),
              ),
              if (message.text.trim().isNotEmpty) const SizedBox(height: 8),
            ],
            if (message.text.trim().isNotEmpty)
              Text.rich(
                TextSpan(
                  children: buildChatTextSpans(
                    message.text,
                    textStyle: style,
                    mentionStyle: mentionStyle,
                    nicknames: nicknames,
                  ),
                ),
              ),
          ],
        ),
      ),
    );

    final reactionWrap = message.reactions.isEmpty
        ? null
        : Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final group in message.reactions)
                  _ReactionChip(
                    group: group,
                    mine: myUserId != null &&
                        group.users.any((user) => user.userId == myUserId),
                    onTap: () => onToggleReaction(group.emoji),
                    onLongPress: () => showModalBottomSheet<void>(
                      context: context,
                      backgroundColor: Colors.transparent,
                      builder: (_) => _ReactionDetailSheet(
                        reactions: message.reactions,
                        myUserId: myUserId,
                        onToggleReaction: onToggleReaction,
                      ),
                    ),
                  ),
              ],
            ),
          );
    final stickerSave = message.asSticker && message.imageUrl != null && message.imageUrl!.isNotEmpty
        ? Padding(
            padding: const EdgeInsets.only(top: 6),
            child: _SaveStickerButton(
              imageUrl: message.imageUrl!,
              imageKey: message.imageKey,
            ),
          )
        : null;

    final nameRow = showName
        ? Padding(
            padding: const EdgeInsets.only(left: 2, bottom: 4, right: 2),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      GestureDetector(
                        onTap: onMention,
                        child: Text(
                          message.nickname,
                          style: TextStyle(
                            fontSize: 11,
                            color: onMention != null
                                ? const Color(0xFF7DD3FC)
                                : OmTheme.textHint,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      if (isOwner) const _RolePill(label: '房主', color: Color(0xFFFBBF24)),
                      if (!isOwner && isAdmin)
                        const _RolePill(label: '管理', color: Color(0xFF7DD3FC)),
                      if (memberTier != null) MemberTierBadge(tier: memberTier!, compact: true),
                    ],
                  ),
                ),
                if (timeLabel.isNotEmpty) ...[
                  const SizedBox(width: 6),
                  Text(
                    timeLabel,
                    style: TextStyle(
                      fontSize: 10,
                      color: Colors.white.withValues(alpha: 0.35),
                    ),
                  ),
                ],
              ],
            ),
          )
        : null;

    return Padding(
      padding: EdgeInsets.only(bottom: showName ? 14 : 6, top: showName ? 4 : 0),
      child: Row(
        mainAxisAlignment: isMe ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!isMe && showAvatar) ...[
            GestureDetector(
              onTap: onMention,
              child: _Avatar(name: message.nickname, url: avatarUrl),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Column(
              crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
              children: [
                if (nameRow != null) nameRow,
                bubble,
                if (reactionWrap != null) reactionWrap,
                if (stickerSave != null) stickerSave,
                if (isMe && timeLabel.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4, right: 2),
                    child: Text(
                      timeLabel,
                      style: TextStyle(
                        fontSize: 10,
                        color: Colors.white.withValues(alpha: 0.35),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (isMe) const SizedBox(width: 4),
        ],
      ),
    );
  }

  static String _formatTimestamp(int ms) {
    if (ms <= 0) return '';
    final dt = DateTime.fromMillisecondsSinceEpoch(ms);
    final hour = dt.hour.toString().padLeft(2, '0');
    final minute = dt.minute.toString().padLeft(2, '0');
    return '$hour:$minute';
  }
}

String _replyPreview(ChatReplyRef reply) {
  final text = reply.text.trim().replaceAll(RegExp(r'\s+'), ' ');
  if (text.isNotEmpty) return text;
  if (reply.imageUrl != null && reply.imageUrl!.isNotEmpty) {
    return reply.asSticker ? '[表情包]' : '[图片]';
  }
  return '[消息]';
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.name, this.url});
  final String name;
  final String? url;

  @override
  Widget build(BuildContext context) {
    final letter = name.isNotEmpty ? name.substring(0, 1).toUpperCase() : '?';
    final fallback = Container(
      width: 34,
      height: 34,
      decoration: const BoxDecoration(
        color: OmTheme.elevated,
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: Text(
        letter,
        style: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: OmTheme.textSecondary,
        ),
      ),
    );

    if (url == null || url!.trim().isEmpty) return fallback;

    return ClipOval(
      child: SizedBox(
        width: 34,
        height: 34,
        child: OmCoverImage(
          url: url,
          sizePx: 68,
          fit: BoxFit.cover,
          fallback: fallback,
        ),
      ),
    );
  }
}

class _RolePill extends StatelessWidget {
  const _RolePill({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: color,
          height: 1.1,
        ),
      ),
    );
  }
}

class _StickerSearchSheet extends ConsumerStatefulWidget {
  const _StickerSearchSheet({required this.roomId});

  final String roomId;

  @override
  ConsumerState<_StickerSearchSheet> createState() => _StickerSearchSheetState();
}

class _StickerSearchSheetState extends ConsumerState<_StickerSearchSheet> {
  final _ctrl = TextEditingController();
  var _loading = false;
  var _sending = false;
  var _page = 1;
  var _maxPage = 1;
  List<String> _images = const [];

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _search([int page = 1]) async {
    final words = _ctrl.text.trim();
    if (words.isEmpty) {
      if (mounted) omSnack(context, '请输入贴纸关键词');
      return;
    }
    setState(() => _loading = true);
    try {
      final result = await StickerApi.search(words, page: page);
      if (!mounted) return;
      setState(() {
        _images = result.images;
        _page = result.page;
        _maxPage = result.maxPage;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      omSnack(context, '$e');
    }
  }

  Future<void> _sendSticker(String imageUrl) async {
    setState(() => _sending = true);
    final res = await ref.read(roomSessionProvider.notifier).sendChat(
          '',
          imageUrl: imageUrl,
          asSticker: true,
        );
    if (!mounted) return;
    setState(() => _sending = false);
    if (res['success'] == true) {
      Navigator.pop(context);
      return;
    }
    omSnack(context, '${res['error'] ?? '发送失败'}');
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Container(
        height: MediaQuery.of(context).size.height * 0.72,
        decoration: const BoxDecoration(
          color: OmTheme.card,
          borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
        ),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _ctrl,
                    decoration: const InputDecoration(
                      hintText: '搜索贴纸，例如：猫猫、晚安、打工',
                    ),
                    onSubmitted: (_) => _search(),
                  ),
                ),
                const SizedBox(width: 10),
                FilledButton(
                  onPressed: _loading || _sending ? null : _search,
                  child: const Text('搜索'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _images.isEmpty
                      ? const Center(
                          child: Text(
                            '输入关键词搜索贴纸',
                            style: TextStyle(color: OmTheme.textHint),
                          ),
                        )
                      : GridView.builder(
                          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 3,
                            mainAxisSpacing: 10,
                            crossAxisSpacing: 10,
                            childAspectRatio: 1,
                          ),
                          itemCount: _images.length,
                          itemBuilder: (context, index) {
                            final image = _images[index];
                            return InkWell(
                              onTap: _sending ? null : () => _sendSticker(image),
                              borderRadius: BorderRadius.circular(12),
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(12),
                                child: OmCoverImage(
                                  url: image,
                                  sizePx: 320,
                                  fit: BoxFit.cover,
                                  fallback: Container(
                                    color: OmTheme.elevated,
                                    alignment: Alignment.center,
                                    child: const Icon(
                                      Icons.broken_image_outlined,
                                      color: OmTheme.textHint,
                                    ),
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
            ),
            if (_images.isNotEmpty) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  OutlinedButton(
                    onPressed: _loading || _page <= 1 ? null : () => _search(_page - 1),
                    child: const Text('上一页'),
                  ),
                  const Spacer(),
                  Text(
                    '$_page / $_maxPage',
                    style: const TextStyle(color: OmTheme.textHint),
                  ),
                  const Spacer(),
                  OutlinedButton(
                    onPressed: _loading || _page >= _maxPage ? null : () => _search(_page + 1),
                    child: const Text('下一页'),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SaveStickerButton extends StatefulWidget {
  const _SaveStickerButton({
    required this.imageUrl,
    this.imageKey,
  });

  final String imageUrl;
  final String? imageKey;

  @override
  State<_SaveStickerButton> createState() => _SaveStickerButtonState();
}

class _SaveStickerButtonState extends State<_SaveStickerButton> {
  var _label = '保存表情';
  var _saving = false;

  Future<void> _save() async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      final result = await UserStickerStore.importFromChatImage(
        widget.imageUrl,
        imageKey: widget.imageKey,
      );
      if (!mounted) return;
      setState(() {
        _saving = false;
        _label = result.imported > 0 ? '已保存' : '已在表情里';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _label = '保存失败';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return TextButton.icon(
      onPressed: _saving ? null : _save,
      style: TextButton.styleFrom(
        visualDensity: VisualDensity.compact,
        foregroundColor: _label == '保存失败' ? const Color(0xFFF6D365) : OmTheme.textHint,
      ),
      icon: _saving
          ? const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.add_reaction_outlined, size: 16),
      label: Text(_label, style: const TextStyle(fontSize: 12)),
    );
  }
}

class _MyStickerSheet extends ConsumerStatefulWidget {
  const _MyStickerSheet();

  @override
  ConsumerState<_MyStickerSheet> createState() => _MyStickerSheetState();
}

class _MyStickerSheetState extends ConsumerState<_MyStickerSheet> {
  var _loading = true;
  var _sending = false;
  String? _deletingId;
  List<UserSticker> _stickers = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final stickers = await UserStickerStore.list();
    if (!mounted) return;
    setState(() {
      _stickers = stickers;
      _loading = false;
    });
  }

  Future<void> _sendSticker(UserSticker sticker) async {
    if (_sending) return;
    setState(() => _sending = true);
    final dataUrl = await UserStickerStore.buildDataUrl(sticker.id);
    if (!mounted) return;
    if (dataUrl == null) {
      setState(() => _sending = false);
      omSnack(context, '表情数据无效，无法发送');
      return;
    }
    final res = await ref.read(roomSessionProvider.notifier).sendChat(
          '',
          imageUrl: dataUrl,
          imageKey: UserStickerStore.localStickerImageKey(sticker.id),
          asSticker: true,
        );
    if (!mounted) return;
    setState(() => _sending = false);
    if (res['success'] == true) {
      Navigator.pop(context);
      return;
    }
    omSnack(context, '${res['error'] ?? '发送失败'}');
  }

  Future<void> _deleteSticker(UserSticker sticker) async {
    final ok = await OmDialog.confirm(
      context,
      title: '删除表情',
      subtitle: '确定删除已保存表情？',
      confirmLabel: '删除',
      content: const SizedBox.shrink(),
    );
    if (ok != true) return;
    setState(() => _deletingId = sticker.id);
    await UserStickerStore.delete(sticker.id);
    if (!mounted) return;
    setState(() => _deletingId = null);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Container(
        height: MediaQuery.of(context).size.height * 0.62,
        decoration: const BoxDecoration(
          color: OmTheme.card,
          borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
        ),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _stickers.isEmpty
                ? const Center(
                    child: Text('还没有保存的表情包', style: TextStyle(color: OmTheme.textHint)),
                  )
                : GridView.builder(
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 4,
                      mainAxisSpacing: 10,
                      crossAxisSpacing: 10,
                      childAspectRatio: 1,
                    ),
                    itemCount: _stickers.length,
                    itemBuilder: (context, index) {
                      final sticker = _stickers[index];
                      final deleting = _deletingId == sticker.id;
                      return Stack(
                        children: [
                          Positioned.fill(
                            child: InkWell(
                              onTap: _sending || deleting ? null : () => _sendSticker(sticker),
                              borderRadius: BorderRadius.circular(12),
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(12),
                                child: Image.file(
                                  File(sticker.path),
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) => Container(
                                    color: OmTheme.elevated,
                                    alignment: Alignment.center,
                                    child: const Icon(
                                      Icons.broken_image_outlined,
                                      color: OmTheme.textHint,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                          Positioned(
                            top: 4,
                            right: 4,
                            child: GestureDetector(
                              onTap: deleting ? null : () => _deleteSticker(sticker),
                              child: Container(
                                width: 24,
                                height: 24,
                                decoration: BoxDecoration(
                                  color: Colors.black.withValues(alpha: 0.55),
                                  shape: BoxShape.circle,
                                ),
                                alignment: Alignment.center,
                                child: deleting
                                    ? const SizedBox(
                                        width: 12,
                                        height: 12,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                                        ),
                                      )
                                    : const Icon(
                                        Icons.delete_outline_rounded,
                                        size: 14,
                                        color: Colors.white,
                                      ),
                              ),
                            ),
                          ),
                        ],
                      );
                    },
                  ),
      ),
    );
  }
}

class _ReactionChip extends StatelessWidget {
  const _ReactionChip({
    required this.group,
    required this.mine,
    required this.onTap,
    required this.onLongPress,
  });

  final ChatReactionGroup group;
  final bool mine;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  @override
  Widget build(BuildContext context) {
    final tooltip = group.users.isEmpty
        ? group.emoji
        : '${group.users.map((user) => user.nickname).join('、')} ${mine ? '已点评' : ''}'.trim();
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: mine ? const Color(0x26F6D365) : OmTheme.card,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: mine ? const Color(0x80F6D365) : OmTheme.divider,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text.rich(
                TextSpan(
                  children: buildChatTextSpans(
                    group.emoji,
                    textStyle: const TextStyle(fontSize: 13, color: OmTheme.textPrimary),
                    nicknames: const <String>[],
                    faceSize: 16,
                  ),
                ),
              ),
              const SizedBox(width: 4),
              Text(
                '${group.users.length}',
                style: TextStyle(
                  fontSize: 11,
                  color: mine ? const Color(0xFFF6D365) : OmTheme.textHint,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ReactionDetailSheet extends StatelessWidget {
  const _ReactionDetailSheet({
    required this.reactions,
    required this.myUserId,
    required this.onToggleReaction,
  });

  final List<ChatReactionGroup> reactions;
  final String? myUserId;
  final ValueChanged<String> onToggleReaction;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Container(
        margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
        decoration: BoxDecoration(
          color: OmTheme.card,
          borderRadius: BorderRadius.circular(18),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '点评详情',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: OmTheme.textPrimary,
              ),
            ),
            const SizedBox(height: 12),
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: reactions.length,
                separatorBuilder: (_, __) => const Divider(color: OmTheme.divider, height: 20),
                itemBuilder: (context, index) {
                  final group = reactions[index];
                  final mine = myUserId != null &&
                      group.users.any((user) => user.userId == myUserId);
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text.rich(
                            TextSpan(
                              children: buildChatTextSpans(
                                group.emoji,
                                textStyle: const TextStyle(
                                  fontSize: 18,
                                  color: OmTheme.textPrimary,
                                ),
                                nicknames: const <String>[],
                                faceSize: 22,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            '${group.users.length} 人',
                            style: const TextStyle(
                              fontSize: 12,
                              color: OmTheme.textHint,
                            ),
                          ),
                          const Spacer(),
                          TextButton(
                            onPressed: () {
                              Navigator.pop(context);
                              onToggleReaction(group.emoji);
                            },
                            child: Text(mine ? '取消' : '我也点一个'),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final user in group.users)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                              decoration: BoxDecoration(
                                color: user.userId == myUserId
                                    ? const Color(0x1A7DD3FC)
                                    : OmTheme.elevated,
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: Text(
                                user.nickname,
                                style: TextStyle(
                                  fontSize: 12,
                                  color: user.userId == myUserId
                                      ? const Color(0xFF7DD3FC)
                                      : OmTheme.textPrimary,
                                  fontWeight: user.userId == myUserId
                                      ? FontWeight.w700
                                      : FontWeight.w500,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ],
                  );
                },
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              '点击 reaction 切换，长按可查看详情。',
              style: TextStyle(fontSize: 12, color: OmTheme.textHint),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReactionPickerSheet extends StatelessWidget {
  const _ReactionPickerSheet({required this.onPick});

  final ValueChanged<String> onPick;

  static const List<String> _items = <String>[
    '[鼓掌]',
    '[666]',
    '[强]',
    '[玫瑰]',
    '[爱心]',
    '[OK]',
    '[可爱]',
    '[色]',
    '[流泪]',
    '[疑问]',
    '[耶]',
    '[礼物]',
  ];

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Container(
        margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
        decoration: BoxDecoration(
          color: OmTheme.card,
          borderRadius: BorderRadius.circular(18),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '点评表情',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: OmTheme.textPrimary,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              '与网页端一致，重复点击同一个表情可取消。',
              style: TextStyle(fontSize: 12, color: OmTheme.textHint),
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                for (final emoji in _items)
                  InkWell(
                    onTap: () => onPick(emoji),
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      decoration: BoxDecoration(
                        color: OmTheme.elevated,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: OmTheme.divider),
                      ),
                      child: Text.rich(
                        TextSpan(
                          children: buildChatTextSpans(
                            emoji,
                            textStyle: const TextStyle(
                              fontSize: 16,
                              color: OmTheme.textPrimary,
                            ),
                            nicknames: const <String>[],
                            faceSize: 22,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
