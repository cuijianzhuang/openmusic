import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openmusic/app/theme.dart';
import 'package:openmusic/data/socket_room_repository.dart';
import 'package:openmusic/domain/models.dart';
import 'package:openmusic/domain/permissions.dart';
import 'package:openmusic/features/room/chat_utils.dart';
import 'package:openmusic/features/room/member_tier_ui.dart';
import 'package:openmusic/widgets/om_cover_image.dart';
import 'package:openmusic/widgets/om_dialog.dart';

Future<void> showUsersSheet(BuildContext context, WidgetRef ref) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (ctx) => const _UsersBody(),
  );
}

class _UsersBody extends ConsumerWidget {
  const _UsersBody();

  List<RoomUser> _displayUsers(RoomState room) {
    final users = [...room.users];
    final onlineIds = room.users.map((u) => u.id).toSet();
    for (final adminId in room.adminIds) {
      if (onlineIds.contains(adminId)) continue;
      users.add(
        RoomUser(
          id: adminId,
          nickname: room.nicknameFor(adminId),
          joinedAt: 0,
          avatarUrl: room.avatarUrlFor(adminId),
        ),
      );
    }
    return users;
  }

  String _roleLabel(RoomState room, RoomUser u) {
    final parts = <String>[];
    if (room.creatorId == u.id) parts.add('房主');
    if (room.adminIds.contains(u.id)) parts.add('管理');
    if (room.ownerId == u.id) parts.add('播放主控');
    if (u.location != null && u.location!.isNotEmpty) parts.add(u.location!);
    return parts.join(' · ');
  }

  Color _avatarColor(RoomState room, RoomUser u) {
    if (room.creatorId == u.id) return OmTheme.red;
    if (room.ownerId == u.id) return const Color(0xFFE8A838);
    return OmTheme.elevated;
  }

  String _stayDuration(int joinedAt) {
    if (joinedAt <= 0) return '';
    final diff = DateTime.now().millisecondsSinceEpoch - joinedAt;
    final minutes = diff ~/ 60000;
    if (minutes < 1) return '1 分钟内';
    if (minutes < 60) return '$minutes 分钟';
    final hours = minutes ~/ 60;
    final restMinutes = minutes % 60;
    if (hours < 24) {
      return restMinutes == 0 ? '$hours 小时' : '$hours 小时 $restMinutes 分';
    }
    final days = hours ~/ 24;
    final restHours = hours % 24;
    return restHours == 0 ? '$days 天' : '$days 天 $restHours 小时';
  }

  Future<void> _editMemberTier(
    BuildContext context,
    WidgetRef ref,
    RoomState room,
    RoomUser user,
  ) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _MemberTierEditor(
        user: user,
        initialTier: room.memberTiers[user.id],
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(roomSessionProvider);
    final room = session.room;
    if (room == null) return const SizedBox.shrink();
    final roles = session.rolesOrNull!;
    final mutedSet = room.mutedUserIds.toSet();
    final users = _displayUsers(room);

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
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                child: Row(
                  children: [
                    const Text(
                      '在线用户',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                        color: OmTheme.textPrimary,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: OmTheme.red.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        '${room.users.length}',
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: OmTheme.red,
                        ),
                      ),
                    ),
                    if (room.muteAll) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0x26FBBF24),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Text(
                          '全体禁言',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: Color(0xFFFBBF24),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Expanded(
                child: ListView.separated(
                  controller: scroll,
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 24),
                  itemCount: users.length,
                  separatorBuilder: (_, __) =>
                      const Divider(height: 1, indent: 56, color: OmTheme.divider),
                  itemBuilder: (context, i) {
                    final u = users[i];
                    final isMe = u.id == session.mySocketId;
                    final subtitle = _roleLabel(room, u);
                    final avatarColor = _avatarColor(room, u);
                    final userMuted = isChatMutedForUser(room, u.id);
                    final avatarUrl = room.avatarUrlFor(u.id) ?? u.avatarUrl;
                    final memberTier = room.memberTiers[u.id];
                    final isOffline = !room.users.any((online) => online.id == u.id);
                    final letter =
                        u.nickname.isNotEmpty ? u.nickname.substring(0, 1).toUpperCase() : '?';
                    final letterAvatar = Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: avatarColor,
                        shape: BoxShape.circle,
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        letter,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: avatarColor == OmTheme.elevated
                              ? OmTheme.textPrimary
                              : Colors.white,
                        ),
                      ),
                    );

                    return Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
                      child: Row(
                        children: [
                          if (avatarUrl != null && avatarUrl.trim().isNotEmpty)
                            ClipOval(
                              child: SizedBox(
                                width: 40,
                                height: 40,
                                child: OmCoverImage(
                                  url: avatarUrl,
                                  sizePx: 80,
                                  fit: BoxFit.cover,
                                  fallback: letterAvatar,
                                ),
                              ),
                            )
                          else
                            letterAvatar,
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Flexible(
                                      child: Text(
                                        u.nickname,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          fontSize: 15,
                                          fontWeight: FontWeight.w500,
                                          color: OmTheme.textPrimary,
                                        ),
                                      ),
                                    ),
                                    if (isMe) ...[
                                      const SizedBox(width: 6),
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 6,
                                          vertical: 1,
                                        ),
                                        decoration: BoxDecoration(
                                          color: OmTheme.elevated,
                                          borderRadius: BorderRadius.circular(4),
                                        ),
                                        child: const Text(
                                          '我',
                                          style: TextStyle(
                                            fontSize: 10,
                                            color: OmTheme.textHint,
                                          ),
                                        ),
                                      ),
                                    ],
                                    if (userMuted && room.creatorId != u.id) ...[
                                      const SizedBox(width: 6),
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 6,
                                          vertical: 1,
                                        ),
                                        decoration: BoxDecoration(
                                          color: const Color(0x26FBBF24),
                                          borderRadius: BorderRadius.circular(4),
                                        ),
                                        child: const Text(
                                          '禁言',
                                          style: TextStyle(
                                            fontSize: 10,
                                            color: Color(0xFFFBBF24),
                                          ),
                                        ),
                                      ),
                                    ],
                                    if (memberTier != null) ...[
                                      const SizedBox(width: 6),
                                      MemberTierBadge(tier: memberTier, compact: true),
                                    ],
                                    if (isOffline) ...[
                                      const SizedBox(width: 6),
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 6,
                                          vertical: 1,
                                        ),
                                        decoration: BoxDecoration(
                                          color: Colors.white.withValues(alpha: 0.08),
                                          borderRadius: BorderRadius.circular(4),
                                        ),
                                        child: const Text(
                                          '离线',
                                          style: TextStyle(
                                            fontSize: 10,
                                            color: OmTheme.textHint,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 2,
                                  children: [
                                    if (subtitle.isNotEmpty)
                                      Text(
                                        subtitle,
                                        style: const TextStyle(
                                          fontSize: 12,
                                          color: OmTheme.textHint,
                                        ),
                                      ),
                                    if (!isOffline && u.joinedAt > 0)
                                      Text(
                                        '停留 ${_stayDuration(u.joinedAt)}',
                                        style: const TextStyle(
                                          fontSize: 12,
                                          color: OmTheme.textHint,
                                        ),
                                      ),
                                    if (!isOffline &&
                                        u.location != null &&
                                        u.location!.trim().isNotEmpty)
                                      Text(
                                        u.location!,
                                        style: const TextStyle(
                                          fontSize: 12,
                                          color: OmTheme.textHint,
                                        ),
                                      ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                          if (canModerate(roles) && !isMe) ...[
                            if (roles.isOwner || room.adminIds.contains(session.mySocketId))
                              TextButton(
                                onPressed: () => _editMemberTier(context, ref, room, u),
                                style: TextButton.styleFrom(
                                  foregroundColor: memberTier != null
                                      ? memberTierColor(memberTier.badgeColor)
                                      : const Color(0xFFF6D365),
                                  padding: const EdgeInsets.symmetric(horizontal: 8),
                                ),
                                child: Text(
                                  memberTier != null ? '改贵宾' : '设贵宾',
                                  style: const TextStyle(fontSize: 13),
                                ),
                              ),
                            if (roles.isOwner && room.creatorId != u.id)
                              TextButton(
                                onPressed: () async {
                                  final nextAdmin = !room.adminIds.contains(u.id);
                                  final res = await ref
                                      .read(roomSessionProvider.notifier)
                                      .setRoomAdmin(u.id, nextAdmin);
                                  if (res['success'] != true && context.mounted) {
                                    omSnack(context, '${res['error'] ?? '操作失败'}');
                                  } else if (context.mounted && res['message'] is String) {
                                    omSnack(context, '${res['message']}');
                                  }
                                },
                                style: TextButton.styleFrom(
                                  foregroundColor: room.adminIds.contains(u.id)
                                      ? const Color(0xFF7DD3FC)
                                      : OmTheme.textSecondary,
                                  padding: const EdgeInsets.symmetric(horizontal: 8),
                                ),
                                child: Text(
                                  room.adminIds.contains(u.id) ? '退管理' : '设管理',
                                  style: const TextStyle(fontSize: 13),
                                ),
                              ),
                            if (room.creatorId != u.id)
                              TextButton(
                                onPressed: () async {
                                  final nextMuted = !mutedSet.contains(u.id);
                                  final res = await ref
                                      .read(roomSessionProvider.notifier)
                                      .setChatMute(userId: u.id, muted: nextMuted);
                                  if (res['success'] != true && context.mounted) {
                                    omSnack(context, '${res['error'] ?? '操作失败'}');
                                  }
                                },
                                style: TextButton.styleFrom(
                                  foregroundColor: mutedSet.contains(u.id)
                                      ? const Color(0xFFFBBF24)
                                      : OmTheme.textSecondary,
                                  padding: const EdgeInsets.symmetric(horizontal: 8),
                                ),
                                child: Text(
                                  mutedSet.contains(u.id) ? '解禁' : '禁言',
                                  style: const TextStyle(fontSize: 13),
                                ),
                              ),
                            TextButton(
                              onPressed: () async {
                                final ok = await OmDialog.confirm(
                                  context,
                                  title: '踢出用户',
                                  subtitle: '确定将 ${u.nickname} 移出房间？',
                                  confirmLabel: '踢出',
                                  content: const SizedBox.shrink(),
                                );
                                if (ok == true) {
                                  await ref
                                      .read(roomSessionProvider.notifier)
                                      .kickUser(u.id);
                                }
                              },
                              style: TextButton.styleFrom(
                                foregroundColor: OmTheme.red,
                                padding: const EdgeInsets.symmetric(horizontal: 8),
                              ),
                              child: const Text('踢出', style: TextStyle(fontSize: 13)),
                            ),
                          ],
                        ],
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _MemberTierEditor extends ConsumerStatefulWidget {
  const _MemberTierEditor({required this.user, required this.initialTier});

  final RoomUser user;
  final RoomMemberTier? initialTier;

  @override
  ConsumerState<_MemberTierEditor> createState() => _MemberTierEditorState();
}

class _MemberTierEditorState extends ConsumerState<_MemberTierEditor> {
  late final TextEditingController _labelCtrl;
  late final TextEditingController _customCtrl;
  late String _badgeColor;
  late String _templateId;
  late bool _confettiEnabled;
  late bool _welcomeEnabled;
  late int _cooldownMinutes;
  var _saving = false;

  RoomMemberTier get _fallback => buildDefaultMemberTier(widget.user.id);

  @override
  void initState() {
    super.initState();
    final tier = widget.initialTier ?? _fallback;
    _labelCtrl = TextEditingController(text: tier.badgeLabel);
    _customCtrl = TextEditingController(text: tier.welcomeCustomText ?? '');
    _badgeColor = normalizeMemberTierColor(tier.badgeColor);
    _templateId = normalizeMemberWelcomeTemplateId(tier.welcomeTemplateId ?? 'royal');
    _confettiEnabled = tier.confettiEnabled ?? true;
    _welcomeEnabled = tier.welcomeEnabled ?? true;
    _cooldownMinutes = (normalizeMemberWelcomeCooldownSec(tier.welcomeCooldownSec) / 60).round();
  }

  @override
  void dispose() {
    _labelCtrl.dispose();
    _customCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final notifier = ref.read(roomSessionProvider.notifier);
    final res = await notifier.setRoomMemberTier(
      widget.user.id,
      RoomMemberTier(
        userId: widget.user.id,
        badgeLabel: _labelCtrl.text.trim().isEmpty ? '贵宾' : _labelCtrl.text.trim(),
        badgeColor: _badgeColor,
        borderStyleId: 'solid',
        borderColor: _badgeColor,
        welcomeEnabled: _welcomeEnabled && _templateId != 'none',
        welcomeTemplateId: _templateId,
        welcomeCustomText: _customCtrl.text.trim(),
        confettiEnabled: _confettiEnabled,
        welcomeCooldownSec: _cooldownMinutes * 60,
      ),
    );
    if (!mounted) return;
    setState(() => _saving = false);
    if (res['success'] == true) {
      Navigator.pop(context);
      omSnack(context, '已更新 ${widget.user.nickname} 的贵宾设置');
      return;
    }
    omSnack(context, '${res['error'] ?? '保存失败'}');
  }

  Future<void> _remove() async {
    final ok = await OmDialog.confirm(
      context,
      title: '移除贵宾',
      subtitle: '确定移除 ${widget.user.nickname} 的贵宾身份？',
      confirmLabel: '移除',
      content: const SizedBox.shrink(),
    );
    if (ok != true) return;
    setState(() => _saving = true);
    final res = await ref.read(roomSessionProvider.notifier).removeRoomMemberTier(widget.user.id);
    if (!mounted) return;
    setState(() => _saving = false);
    if (res['success'] == true) {
      Navigator.pop(context);
      omSnack(context, '已移除贵宾设置');
      return;
    }
    omSnack(context, '${res['error'] ?? '操作失败'}');
  }

  @override
  Widget build(BuildContext context) {
    final previewTier = RoomMemberTier(
      userId: widget.user.id,
      badgeLabel: _labelCtrl.text.trim().isEmpty ? '贵宾' : _labelCtrl.text.trim(),
      badgeColor: _badgeColor,
      borderStyleId: 'solid',
      borderColor: _badgeColor,
    );
    final previewText = buildMemberWelcomePreview(
      templateId: _welcomeEnabled ? _templateId : 'none',
      customText: _customCtrl.text,
      badgeLabel: previewTier.badgeLabel,
      nickname: widget.user.nickname,
    );
    final hasExisting = widget.initialTier != null;

    return SafeArea(
      child: Container(
        decoration: const BoxDecoration(
          color: OmTheme.card,
          borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
        ),
        padding: EdgeInsets.fromLTRB(
          16,
          16,
          16,
          16 + MediaQuery.of(context).viewInsets.bottom,
        ),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '贵宾设置 · ${widget.user.nickname}',
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                        color: OmTheme.textPrimary,
                      ),
                    ),
                  ),
                  if (hasExisting)
                    TextButton(
                      onPressed: _saving ? null : _remove,
                      child: const Text('移除贵宾'),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _labelCtrl,
                maxLength: 8,
                decoration: const InputDecoration(
                  labelText: '角标名称',
                  hintText: '例如：贵宾 / SVIP / 老板',
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final color in memberTierColorPresets)
                    InkWell(
                      onTap: _saving ? null : () => setState(() => _badgeColor = color),
                      borderRadius: BorderRadius.circular(999),
                      child: Container(
                        width: 28,
                        height: 28,
                        decoration: BoxDecoration(
                          color: memberTierColor(color),
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: _badgeColor == color ? Colors.white : Colors.transparent,
                            width: 2,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  MemberTierBadge(tier: previewTier),
                  const SizedBox(width: 10),
                  Text(
                    widget.user.nickname,
                    style: const TextStyle(color: OmTheme.textPrimary),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              SwitchListTile(
                value: _welcomeEnabled,
                contentPadding: EdgeInsets.zero,
                title: const Text('启用进房欢迎'),
                subtitle: const Text('与网页端一致，按贵宾单独配置'),
                onChanged: _saving ? null : (value) => setState(() => _welcomeEnabled = value),
              ),
              DropdownButtonFormField<String>(
                initialValue: _templateId,
                decoration: const InputDecoration(labelText: '欢迎语模板'),
                items: memberWelcomeTemplateLabels.entries
                    .map(
                      (entry) => DropdownMenuItem<String>(
                        value: entry.key,
                        child: Text(entry.value),
                      ),
                    )
                    .toList(),
                onChanged: _saving
                    ? null
                    : (value) => setState(() => _templateId = value ?? 'royal'),
              ),
              if (_templateId == 'custom') ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _customCtrl,
                  maxLength: 200,
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: '自定义欢迎语',
                    hintText: '支持 {badge} 和 {nickname}',
                  ),
                ),
              ],
              const SizedBox(height: 12),
              DropdownButtonFormField<int>(
                initialValue: _cooldownMinutes,
                decoration: const InputDecoration(labelText: '重复欢迎冷却'),
                items: memberWelcomeCooldownMinuteOptions
                    .map(
                      (minute) => DropdownMenuItem<int>(
                        value: minute,
                        child: Text(minute == 0 ? '每次进房都欢迎' : '$minute 分钟'),
                      ),
                    )
                    .toList(),
                onChanged: _saving
                    ? null
                    : (value) => setState(() => _cooldownMinutes = value ?? 5),
              ),
              SwitchListTile(
                value: _confettiEnabled,
                contentPadding: EdgeInsets.zero,
                title: const Text('礼花效果'),
                subtitle: const Text('沿用网页端的贵宾进房礼花开关'),
                onChanged: _saving ? null : (value) => setState(() => _confettiEnabled = value),
              ),
              if (previewText.isNotEmpty) ...[
                const SizedBox(height: 4),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0x14F6D365),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0x40F6D365)),
                  ),
                  child: Text(
                    previewText,
                    style: const TextStyle(
                      color: OmTheme.textPrimary,
                      height: 1.4,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _saving ? null : _save,
                  child: Text(_saving ? '保存中...' : '保存'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
