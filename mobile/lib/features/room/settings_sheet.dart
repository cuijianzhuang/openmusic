import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:openmusic/data/avatar_image.dart';
import 'package:openmusic/data/local_cache.dart';
import 'package:openmusic/data/identity_auth.dart';
import 'package:openmusic/app/theme.dart';
import 'package:openmusic/data/socket_room_repository.dart';
import 'package:openmusic/data/user_audio_quality.dart';
import 'package:openmusic/domain/models.dart';
import 'package:openmusic/domain/permissions.dart';
import 'package:openmusic/features/lobby/lobby_page.dart';
import 'package:openmusic/features/room/identity_auth_page.dart';
import 'package:openmusic/features/room/member_tier_ui.dart';
import 'package:openmusic/features/room/users_sheet.dart';
import 'package:openmusic/widgets/om_cover_image.dart';
import 'package:openmusic/widgets/om_dialog.dart';

Future<void> showRoomSettingsSheet(BuildContext context, WidgetRef ref) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (ctx) => const _SettingsBody(),
  );
}

class _SettingsBody extends ConsumerWidget {
  const _SettingsBody();

  Future<void> _showUserQualitySheet(BuildContext context, RoomAudioQuality? roomQuality) async {
    final svipEnabled = await QualityCapabilities.refresh();
    final base = await UserAudioQualityStore.resolve(roomQuality, svipEnabled: svipEnabled);
    if (!context.mounted) return;
    var draft = base;
    final neteaseOpts = qualityOptionsForSource('netease', svipEnabled: svipEnabled);
    final tencentOpts = qualityOptionsForSource('tencent', svipEnabled: svipEnabled);
    final ok = await OmDialog.showSheet<bool>(
      context,
      title: '我的音质',
      subtitle: '仅影响你自己拉取的播放音质，不会改别人。',
      child: StatefulBuilder(
        builder: (context, setLocal) => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const _SheetLabel('红点音质'),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final option in neteaseOpts)
                  _ChoicePill(
                    label: option.label,
                    selected: draft.netease == option.value,
                    onTap: () => setLocal(
                      () => draft = RoomAudioQuality(
                        netease: option.value,
                        tencent: draft.tencent,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 18),
            const _SheetLabel('绿点音质'),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final option in tencentOpts)
                  _ChoicePill(
                    label: option.label,
                    selected: draft.tencent == option.value,
                    onTap: () => setLocal(
                      () => draft = RoomAudioQuality(
                        netease: draft.netease,
                        tencent: option.value,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
      actions: [
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('取消'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('保存'),
              ),
            ),
          ],
        ),
      ],
    );
    if (ok == true) {
      await UserAudioQualityStore.write(draft);
    }
  }

  Future<void> _showAvatarSettingsSheet(
    BuildContext context,
    WidgetRef ref, {
    required String currentUrl,
    required String nickname,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _AvatarSettingsSheet(
        initialUrl: currentUrl,
        nickname: nickname,
      ),
    );
  }

  Future<void> _showMemberSettingsSheet(
    BuildContext context,
    WidgetRef ref,
    RoomMemberSettings settings,
  ) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _MemberSettingsSheet(initial: settings),
    );
  }

  Future<void> _showIdentitySettingsSheet(
    BuildContext context,
    RoomState room,
    String? myUserId,
  ) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _IdentitySettingsSheet(
        room: room,
        myUserId: myUserId,
      ),
    );
  }

  Future<String?> _pickOption(
    BuildContext context, {
    required String title,
    required List<(String, String)> options,
    String? current,
  }) {
    return OmDialog.showSheet<String>(
      context,
      title: title,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final opt in options)
            _OptionTile(
              label: opt.$2,
              selected: opt.$1 == current,
              onTap: () => Navigator.pop(context, opt.$1),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(roomSessionProvider);
    final room = session.room;
    if (room == null) return const SizedBox.shrink();
    final roles = session.rolesOrNull!;
    final notifier = ref.read(roomSessionProvider.notifier);
    RoomUser? currentUser() {
      final myId = session.mySocketId;
      if (myId == null || myId.isEmpty) return null;
      for (final user in room.users) {
        if (user.id == myId) return user;
      }
      return null;
    }
    Future<void> updateSongRequest({
      bool? enabled,
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
      final res = await notifier.setSongRequestEnabled(
        enabled ?? room.songRequestEnabled,
        memberJumpEnabled: memberJumpEnabled ?? room.memberJumpEnabled,
        memberSeekEnabled: memberSeekEnabled ?? room.memberSeekEnabled,
        memberPauseEnabled: memberPauseEnabled ?? room.memberPauseEnabled,
        systemMediaPlayBound: systemMediaPlayBound ?? room.systemMediaPlayBound,
        systemMediaSkipBound: systemMediaSkipBound ?? room.systemMediaSkipBound,
        dislikeSkipMode: dislikeSkipMode ?? room.dislikeSkipMode,
        dislikeSkipThreshold: dislikeSkipThreshold ?? room.dislikeSkipThreshold,
        dislikeSkipPercent: dislikeSkipPercent ?? room.dislikeSkipPercent,
        clearSongsOnLeaveEnabled:
            clearSongsOnLeaveEnabled ?? room.clearSongsOnLeaveEnabled,
        clearSongsOnLeaveDelaySec:
            clearSongsOnLeaveDelaySec ?? room.clearSongsOnLeaveDelaySec,
        minStaySec: minStaySec ?? room.songRequestMinStaySec,
        maxPerUser: maxPerUser ?? room.songRequestMaxPerUser,
        cooldownSec: cooldownSec ?? room.songRequestCooldownSec,
        queueMaxLength: queueMaxLength ?? room.queueMaxLength,
      );
      if (res['success'] != true && context.mounted) {
        omSnack(context, '${res['error'] ?? '设置失败'}');
      }
    }

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.72,
      minChildSize: 0.4,
      maxChildSize: 0.92,
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
                      '房间设置',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                        color: OmTheme.textPrimary,
                      ),
                    ),
                    const Spacer(),
                    Text(
                      room.id,
                      style: const TextStyle(fontSize: 12, color: OmTheme.textHint),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView(
                  controller: scroll,
                  padding: const EdgeInsets.fromLTRB(8, 0, 8, 24),
                  children: [
                    _SettingsGroup(
                      title: '个人',
                      children: [
                        _SettingsTile(
                          icon: Icons.edit_outlined,
                          title: '我的昵称',
                          value: currentUser()?.nickname ?? '未设置',
                          onTap: () async {
                            final current = currentUser()?.nickname ?? '';
                            final ctrl = TextEditingController(text: current);
                            final ok = await OmDialog.confirm(
                              context,
                              title: '修改昵称',
                              confirmLabel: '保存',
                              content: OmField(controller: ctrl, hint: '输入新的昵称'),
                            );
                            if (ok != true) return;
                            final next = ctrl.text.trim();
                            if (next.isEmpty) {
                              if (context.mounted) omSnack(context, '昵称不能为空');
                              return;
                            }
                            final res = await notifier.renameUser(next);
                            if (res['success'] == true) {
                              ref.read(nicknameProvider.notifier).state = next;
                              await LocalCache.setNickname(next);
                            } else if (context.mounted) {
                              omSnack(context, '${res['error'] ?? '设置失败'}');
                            }
                          },
                        ),
                        _SettingsTile(
                          icon: Icons.account_circle_outlined,
                          title: '我的头像',
                          value: room.avatarUrlFor(session.mySocketId ?? '')?.isNotEmpty == true
                              ? '已设置'
                              : '未设置',
                          onTap: () => _showAvatarSettingsSheet(
                            context,
                            ref,
                            currentUrl: room.avatarUrlFor(session.mySocketId ?? '') ?? '',
                            nickname: currentUser()?.nickname ?? '我',
                          ),
                        ),
                      ],
                    ),
                    _SettingsGroup(
                      title: '身份',
                      children: [
                        _SettingsTile(
                          icon: Icons.verified_user_outlined,
                          title: '房主身份绑定 / 找回',
                          value: room.creatorId == session.mySocketId ? '可绑定账号' : '可尝试找回',
                          onTap: () => _showIdentitySettingsSheet(
                            context,
                            room,
                            session.mySocketId,
                          ),
                        ),
                      ],
                    ),
                    _SettingsGroup(
                      title: '房主',
                      children: [
                        _SettingsTile(
                          icon: Icons.admin_panel_settings_outlined,
                          title: '管理员设置',
                          value: room.adminIds.isEmpty ? '暂无管理员' : '${room.adminIds.length} 人',
                          onTap: !roles.isOwner
                              ? null
                              : () => showUsersSheet(context, ref),
                        ),
                        _SettingsTile(
                          icon: Icons.auto_awesome_outlined,
                          title: '贵宾默认设置',
                          value: memberWelcomeTemplateLabels[
                                  normalizeMemberWelcomeTemplateId(
                                    room.memberSettings.welcomeTemplateId,
                                  )] ??
                              '已配置',
                          onTap: !canModerate(roles)
                              ? null
                              : () => _showMemberSettingsSheet(
                                    context,
                                    ref,
                                    room.memberSettings,
                                  ),
                        ),
                        _SettingsTile(
                          icon: Icons.swap_horiz_rounded,
                          title: '转让房主',
                          value: room.ownerId == room.creatorId ? '当前由你持有' : '已转让播放主控',
                          onTap: !roles.isOwner
                              ? null
                              : () async {
                                  final candidates = room.users
                                      .where(
                                        (u) => !u.readOnly && u.id != session.mySocketId,
                                      )
                                      .toList();
                                  if (candidates.isEmpty) {
                                    if (context.mounted) omSnack(context, '暂无可转让的成员');
                                    return;
                                  }
                                  final picked = await OmDialog.showSheet<String>(
                                    context,
                                    title: '转让房主',
                                    subtitle: '转让后你会降为管理员。',
                                    child: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        for (final user in candidates)
                                          _OptionTile(
                                            label: user.nickname,
                                            onTap: () => Navigator.pop(context, user.id),
                                          ),
                                      ],
                                    ),
                                  );
                                  if (picked == null) return;
                                  final target = candidates.firstWhere((u) => u.id == picked);
                                  final ok = await OmDialog.confirm(
                                    context,
                                    title: '确认转让房主',
                                    subtitle: '将房主身份转让给 ${target.nickname}',
                                    confirmLabel: '确认转让',
                                    content: const SizedBox.shrink(),
                                  );
                                  if (ok != true) return;
                                  final res = await notifier.transferOwner(picked);
                                  if (res['success'] != true && context.mounted) {
                                    omSnack(context, '${res['error'] ?? '转让失败'}');
                                  }
                                },
                        ),
                        _SettingsTile(
                          icon: Icons.push_pin_outlined,
                          title: '常驻房间申请',
                          value: room.protectedFromDestroy
                              ? '已常驻'
                              : room.permanentApplication?.status == 'pending'
                                  ? '审核中'
                                  : '未申请',
                          onTap: !roles.isOwner
                              ? null
                              : () async {
                                  if (room.protectedFromDestroy) {
                                    if (context.mounted) omSnack(context, '该房间已是常驻房间');
                                    return;
                                  }
                                  if (room.permanentApplication?.status == 'pending') {
                                    final ok = await OmDialog.confirm(
                                      context,
                                      title: '取消常驻申请',
                                      confirmLabel: '取消申请',
                                      content: const SizedBox.shrink(),
                                    );
                                    if (ok != true) return;
                                    final res = await notifier.cancelRoomPermanent();
                                    if (res['success'] != true && context.mounted) {
                                      omSnack(context, '${res['error'] ?? '取消失败'}');
                                    }
                                    return;
                                  }
                                  final ctrl = TextEditingController();
                                  final note = await OmDialog.showSheet<String>(
                                    context,
                                    title: '申请常驻房间',
                                    subtitle: '可填写备注，方便管理员审核。',
                                    child: OmField(controller: ctrl, hint: '备注（可选）'),
                                    actions: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: OutlinedButton(
                                              onPressed: () => Navigator.pop(context),
                                              child: const Text('取消'),
                                            ),
                                          ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: FilledButton(
                                              onPressed: () => Navigator.pop(
                                                context,
                                                ctrl.text.trim(),
                                              ),
                                              child: const Text('提交申请'),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  );
                                  if (note == null) return;
                                  final res = await notifier.applyRoomPermanent(note: note);
                                  if (res['success'] != true && context.mounted) {
                                    omSnack(context, '${res['error'] ?? '申请失败'}');
                                  }
                                },
                        ),
                      ],
                    ),
                    _SettingsGroup(
                      title: '治理',
                      children: [
                        _SettingsTile(
                          icon: Icons.block_outlined,
                          title: '禁播歌曲',
                          value: room.bannedSongs.isEmpty ? '暂无' : '${room.bannedSongs.length} 首',
                          onTap: !canModerate(roles)
                              ? null
                              : () async {
                                  await OmDialog.showSheet<void>(
                                    context,
                                    title: '禁播歌曲',
                                    subtitle: room.current == null
                                        ? '可管理当前禁播列表'
                                        : '可一键禁播当前歌曲或解除已有禁播',
                                    child: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        if (room.current != null)
                                          ListTile(
                                            contentPadding: EdgeInsets.zero,
                                            leading: const Icon(
                                              Icons.music_off_rounded,
                                              color: OmTheme.red,
                                            ),
                                            title: Text(
                                              '禁播当前歌曲《${room.current!.name}》',
                                              style: const TextStyle(color: OmTheme.textPrimary),
                                            ),
                                            subtitle: Text(
                                              room.current!.artist,
                                              style: const TextStyle(color: OmTheme.textHint),
                                            ),
                                            onTap: () async {
                                              final res = await notifier.banRoomSong(room.current!);
                                              if (context.mounted) {
                                                Navigator.pop(context);
                                                omSnack(
                                                  context,
                                                  res['success'] == true
                                                      ? '已加入禁播'
                                                      : '${res['error'] ?? '操作失败'}',
                                                );
                                              }
                                            },
                                          ),
                                        if (room.bannedSongs.isEmpty)
                                          const Padding(
                                            padding: EdgeInsets.symmetric(vertical: 24),
                                            child: Text('暂无禁播歌曲', style: TextStyle(color: OmTheme.textHint)),
                                          )
                                        else
                                          SizedBox(
                                            height: 280,
                                            child: ListView.separated(
                                              itemCount: room.bannedSongs.length,
                                              separatorBuilder: (_, __) =>
                                                  const Divider(height: 1, color: OmTheme.divider),
                                              itemBuilder: (_, i) {
                                                final song = room.bannedSongs[i];
                                                return ListTile(
                                                  contentPadding: EdgeInsets.zero,
                                                  title: Text(
                                                    song.name,
                                                    style: const TextStyle(color: OmTheme.textPrimary),
                                                  ),
                                                  subtitle: Text(
                                                    song.artist,
                                                    style: const TextStyle(color: OmTheme.textHint),
                                                  ),
                                                  trailing: TextButton(
                                                    onPressed: () async {
                                                      final res = await notifier.unbanRoomSong(song.name);
                                                      if (context.mounted) {
                                                        Navigator.pop(context);
                                                        omSnack(
                                                          context,
                                                          res['success'] == true
                                                              ? '已解除禁播'
                                                              : '${res['error'] ?? '操作失败'}',
                                                        );
                                                      }
                                                    },
                                                    child: const Text('解除'),
                                                  ),
                                                );
                                              },
                                            ),
                                          ),
                                      ],
                                    ),
                                  );
                                },
                        ),
                        _SettingsTile(
                          icon: Icons.gpp_maybe_outlined,
                          title: '违禁词',
                          value: room.forbiddenWords.isEmpty ? '暂无' : '${room.forbiddenWords.length} 个',
                          onTap: !canModerate(roles)
                              ? null
                              : () async {
                                  final ctrl = TextEditingController();
                                  await OmDialog.showSheet<void>(
                                    context,
                                    title: '违禁词',
                                    subtitle: '命中后将阻止发送。',
                                    child: StatefulBuilder(
                                      builder: (context, setLocal) => Column(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Row(
                                            children: [
                                              Expanded(
                                                child: OmField(
                                                  controller: ctrl,
                                                  hint: '输入违禁词',
                                                ),
                                              ),
                                              const SizedBox(width: 8),
                                              FilledButton(
                                                onPressed: () async {
                                                  final word = ctrl.text.trim();
                                                  if (word.isEmpty) return;
                                                  final res =
                                                      await notifier.addRoomForbiddenWord(word);
                                                  if (res['success'] == true) {
                                                    ctrl.clear();
                                                    if (context.mounted) {
                                                      Navigator.pop(context);
                                                      omSnack(context, '已添加违禁词');
                                                    }
                                                  } else if (context.mounted) {
                                                    omSnack(context, '${res['error'] ?? '添加失败'}');
                                                  }
                                                },
                                                child: const Text('添加'),
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 14),
                                          if (room.forbiddenWords.isEmpty)
                                            const Padding(
                                              padding: EdgeInsets.symmetric(vertical: 24),
                                              child: Text('暂无违禁词', style: TextStyle(color: OmTheme.textHint)),
                                            )
                                          else
                                            SizedBox(
                                              height: 260,
                                              child: ListView.separated(
                                                itemCount: room.forbiddenWords.length,
                                                separatorBuilder: (_, __) =>
                                                    const Divider(height: 1, color: OmTheme.divider),
                                                itemBuilder: (_, i) {
                                                  final item = room.forbiddenWords[i];
                                                  return ListTile(
                                                    contentPadding: EdgeInsets.zero,
                                                    title: Text(
                                                      item.word,
                                                      style:
                                                          const TextStyle(color: OmTheme.textPrimary),
                                                    ),
                                                    subtitle: Text(
                                                      item.isDefault ? '默认词' : '自定义词',
                                                      style: const TextStyle(color: OmTheme.textHint),
                                                    ),
                                                    trailing: TextButton(
                                                      onPressed: () async {
                                                        final res = await notifier
                                                            .removeRoomForbiddenWord(item.word);
                                                        if (res['success'] == true &&
                                                            context.mounted) {
                                                          Navigator.pop(context);
                                                          omSnack(context, '已移除违禁词');
                                                        } else if (context.mounted) {
                                                          omSnack(
                                                            context,
                                                            '${res['error'] ?? '移除失败'}',
                                                          );
                                                        }
                                                      },
                                                      child: const Text('移除'),
                                                    ),
                                                  );
                                                },
                                              ),
                                            ),
                                        ],
                                      ),
                                    ),
                                  );
                                },
                        ),
                      ],
                    ),
                    _SettingsGroup(
                      title: '房间',
                      children: [
                        _SettingsTile(
                          icon: Icons.meeting_room_outlined,
                          title: '房间名',
                          value: room.name,
                          onTap: !canModerate(roles)
                              ? null
                              : () async {
                                  final ctrl = TextEditingController(text: room.name);
                                  final ok = await OmDialog.confirm(
                                    context,
                                    title: '修改房间名',
                                    confirmLabel: '保存',
                                    content: OmField(controller: ctrl, hint: '房间名称'),
                                  );
                                  if (ok == true) {
                                    await notifier.renameRoom(ctrl.text.trim());
                                  }
                                },
                        ),
                        _SettingsTile(
                          icon: Icons.lock_outline_rounded,
                          title: '锁房',
                          trailing: Switch.adaptive(
                            value: room.isLocked,
                            activeTrackColor: OmTheme.red,
                            onChanged: !canModerate(roles)
                                ? null
                                : (v) => notifier.setRoomLock(v),
                          ),
                        ),
                        _SettingsTile(
                          icon: Icons.queue_music_rounded,
                          title: '允许成员点歌',
                          trailing: Switch.adaptive(
                            value: room.songRequestEnabled,
                            activeTrackColor: OmTheme.red,
                            onChanged: !canModerate(roles)
                                ? null
                                : (v) => notifier.setSongRequestEnabled(v),
                          ),
                        ),
                        _SettingsTile(
                          icon: Icons.image_outlined,
                          title: '房间封面',
                          value: room.customCoverUrl?.isNotEmpty == true ? '已自定义' : '跟随歌曲封面',
                          onTap: !roles.isOwner
                              ? null
                              : () async {
                                  final ctrl =
                                      TextEditingController(text: room.customCoverUrl ?? '');
                                  final saved = await OmDialog.showSheet<String>(
                                    context,
                                    title: '房间封面',
                                    subtitle: '填图片 URL，留空则恢复跟随当前歌曲封面。',
                                    child: OmField(
                                      controller: ctrl,
                                      hint: 'https://example.com/cover.jpg',
                                    ),
                                    actions: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: OutlinedButton(
                                              onPressed: () => Navigator.pop(context),
                                              child: const Text('取消'),
                                            ),
                                          ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: FilledButton(
                                              onPressed: () => Navigator.pop(
                                                context,
                                                ctrl.text.trim(),
                                              ),
                                              child: const Text('保存'),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  );
                                  if (saved == null) return;
                                  final res = await notifier.setRoomCustomCover(saved);
                                  if (res['success'] != true && context.mounted) {
                                    omSnack(context, '${res['error'] ?? '设置失败'}');
                                  }
                                },
                        ),
                      ],
                    ),
                    _SettingsGroup(
                      title: '播放',
                      children: [
                        _SettingsTile(
                          icon: Icons.shuffle_rounded,
                          title: '播放模式',
                          value: _playModeLabel(room.playMode),
                          onTap: !roles.canControlPlayback
                              ? null
                              : () async {
                                  final picked = await _pickOption(
                                    context,
                                    title: '播放模式',
                                    current: room.playMode,
                                    options: const [
                                      ('order', '顺序播放'),
                                      ('shuffle', '随机播放'),
                                      ('loop-one', '单曲循环'),
                                      ('loop-all', '列表循环'),
                                    ],
                                  );
                                  if (picked != null) await notifier.setRoomPlayMode(picked);
                                },
                        ),
                        _SettingsTile(
                          icon: Icons.radio_rounded,
                          title: 'FM 漫游',
                          value: _fmModeLabel(room.neteaseFmMode),
                          onTap: !roles.isOwner
                              ? null
                              : () async {
                                  final picked = await _pickOption(
                                    context,
                                    title: 'FM 漫游',
                                    current: _normalizeFmMode(room.neteaseFmMode),
                                    options: const [
                                      ('DEFAULT', '默认漫游'),
                                      ('FAMILIAR', '熟悉模式'),
                                      ('EXPLORE', '探索模式'),
                                      ('SCENE_RCMD:EXERCISE', '运动场景'),
                                      ('SCENE_RCMD:FOCUS', '专注场景'),
                                      ('SCENE_RCMD:NIGHT_EMO', '深夜场景'),
                                      ('aidj', 'AI DJ'),
                                      ('OFF', '关闭'),
                                    ],
                                  );
                                  if (picked != null) await notifier.setRoomFmMode(picked);
                                },
                        ),
                        FutureBuilder<RoomAudioQuality>(
                          future: UserAudioQualityStore.resolve(room.audioQuality),
                          builder: (context, snap) {
                            final quality = snap.data ?? room.audioQuality ?? defaultUserAudioQuality;
                            return _SettingsTile(
                              icon: Icons.high_quality_rounded,
                              title: '我的音质',
                              value: getAudioQualitySummary(quality),
                              onTap: () => _showUserQualitySheet(context, room.audioQuality),
                            );
                          },
                        ),
                        _SettingsTile(
                          icon: Icons.north_rounded,
                          title: '允许成员插队',
                          trailing: Switch.adaptive(
                            value: room.memberJumpEnabled,
                            activeTrackColor: OmTheme.red,
                            onChanged: !canModerate(roles)
                                ? null
                                : (v) => updateSongRequest(memberJumpEnabled: v),
                          ),
                        ),
                        _SettingsTile(
                          icon: Icons.timeline_rounded,
                          title: '允许成员拖动进度',
                          trailing: Switch.adaptive(
                            value: room.memberSeekEnabled,
                            activeTrackColor: OmTheme.red,
                            onChanged: !canModerate(roles)
                                ? null
                                : (v) => updateSongRequest(memberSeekEnabled: v),
                          ),
                        ),
                        _SettingsTile(
                          icon: Icons.pause_circle_outline_rounded,
                          title: '允许成员暂停/恢复',
                          trailing: Switch.adaptive(
                            value: room.memberPauseEnabled,
                            activeTrackColor: OmTheme.red,
                            onChanged: !canModerate(roles)
                                ? null
                                : (v) => updateSongRequest(memberPauseEnabled: v),
                          ),
                        ),
                        _SettingsTile(
                          icon: Icons.headset_rounded,
                          title: '系统媒体键播放/暂停',
                          trailing: Switch.adaptive(
                            value: room.systemMediaPlayBound,
                            activeTrackColor: OmTheme.red,
                            onChanged: !roles.isOwner
                                ? null
                                : (v) => updateSongRequest(systemMediaPlayBound: v),
                          ),
                        ),
                        _SettingsTile(
                          icon: Icons.skip_next_rounded,
                          title: '系统媒体键切歌',
                          trailing: Switch.adaptive(
                            value: room.systemMediaSkipBound,
                            activeTrackColor: OmTheme.red,
                            onChanged: !roles.isOwner
                                ? null
                                : (v) => updateSongRequest(systemMediaSkipBound: v),
                          ),
                        ),
                        _SettingsTile(
                          icon: Icons.thumb_down_alt_outlined,
                          title: '踩歌切歌规则',
                          value: room.dislikeSkipMode == 'percent'
                              ? '满 ${room.dislikeSkipPercent}% 跳过'
                              : '${room.dislikeSkipThreshold} 人踩歌跳过',
                          onTap: !canModerate(roles)
                              ? null
                              : () async {
                                  var mode = room.dislikeSkipMode;
                                  var count = room.dislikeSkipThreshold.clamp(1, 50);
                                  var percent = room.dislikeSkipPercent.clamp(1, 100);
                                  final ok = await OmDialog.showSheet<bool>(
                                    context,
                                    title: '踩歌切歌规则',
                                    subtitle: '成员踩歌达到阈值后自动切歌。',
                                    child: StatefulBuilder(
                                      builder: (context, setLocal) => Column(
                                        mainAxisSize: MainAxisSize.min,
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Wrap(
                                            spacing: 8,
                                            runSpacing: 8,
                                            children: [
                                              _ChoicePill(
                                                label: '按人数',
                                                selected: mode == 'count',
                                                onTap: () => setLocal(() => mode = 'count'),
                                              ),
                                              _ChoicePill(
                                                label: '按比例',
                                                selected: mode == 'percent',
                                                onTap: () => setLocal(() => mode = 'percent'),
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 16),
                                          Text(
                                            mode == 'percent' ? '阈值：$percent%' : '阈值：$count 人',
                                            style: const TextStyle(
                                              color: OmTheme.textPrimary,
                                              fontWeight: FontWeight.w600,
                                            ),
                                          ),
                                          Slider(
                                            value: (mode == 'percent' ? percent : count).toDouble(),
                                            min: 1,
                                            max: mode == 'percent' ? 100 : 50,
                                            divisions: mode == 'percent' ? 99 : 49,
                                            activeColor: OmTheme.red,
                                            onChanged: (v) => setLocal(() {
                                              if (mode == 'percent') {
                                                percent = v.round();
                                              } else {
                                                count = v.round();
                                              }
                                            }),
                                          ),
                                        ],
                                      ),
                                    ),
                                    actions: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: OutlinedButton(
                                              onPressed: () => Navigator.pop(context, false),
                                              child: const Text('取消'),
                                            ),
                                          ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: FilledButton(
                                              onPressed: () => Navigator.pop(context, true),
                                              child: const Text('保存'),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  );
                                  if (ok == true) {
                                    await updateSongRequest(
                                      dislikeSkipMode: mode,
                                      dislikeSkipThreshold: count,
                                      dislikeSkipPercent: percent,
                                    );
                                  }
                                },
                        ),
                        _SettingsTile(
                          icon: Icons.cleaning_services_outlined,
                          title: '离房后清除已点歌曲',
                          value: room.clearSongsOnLeaveEnabled
                              ? '开启 · 延迟 ${room.clearSongsOnLeaveDelaySec ~/ 60} 分钟'
                              : '关闭',
                          onTap: !canModerate(roles)
                              ? null
                              : () async {
                                  var enabled = room.clearSongsOnLeaveEnabled;
                                  var delaySec = room.clearSongsOnLeaveDelaySec.clamp(0, 24 * 60 * 60);
                                  final ok = await OmDialog.showSheet<bool>(
                                    context,
                                    title: '离房清歌',
                                    subtitle: '成员退出房间后自动清掉他点的待播歌曲。',
                                    child: StatefulBuilder(
                                      builder: (context, setLocal) => Column(
                                        mainAxisSize: MainAxisSize.min,
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            children: [
                                              const Text(
                                                '开启清理',
                                                style: TextStyle(color: OmTheme.textPrimary),
                                              ),
                                              const Spacer(),
                                              Switch.adaptive(
                                                value: enabled,
                                                activeTrackColor: OmTheme.red,
                                                onChanged: (v) => setLocal(() => enabled = v),
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 8),
                                          Text(
                                            '延迟：${(delaySec / 60).round()} 分钟',
                                            style: const TextStyle(color: OmTheme.textPrimary),
                                          ),
                                          Slider(
                                            value: delaySec.toDouble(),
                                            min: 0,
                                            max: 24 * 60 * 60,
                                            divisions: 24 * 60,
                                            activeColor: OmTheme.red,
                                            onChanged: (v) => setLocal(() => delaySec = v.round()),
                                          ),
                                        ],
                                      ),
                                    ),
                                    actions: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: OutlinedButton(
                                              onPressed: () => Navigator.pop(context, false),
                                              child: const Text('取消'),
                                            ),
                                          ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: FilledButton(
                                              onPressed: () => Navigator.pop(context, true),
                                              child: const Text('保存'),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  );
                                  if (ok == true) {
                                    await updateSongRequest(
                                      clearSongsOnLeaveEnabled: enabled,
                                      clearSongsOnLeaveDelaySec: delaySec,
                                    );
                                  }
                                },
                        ),
                        _SettingsTile(
                          icon: Icons.timer_outlined,
                          title: '进房多久后才能点歌',
                          value: room.songRequestMinStaySec <= 0
                              ? '不限制'
                              : '${room.songRequestMinStaySec ~/ 60} 分钟',
                          onTap: !canModerate(roles)
                              ? null
                              : () async {
                                  var minutes =
                                      (room.songRequestMinStaySec / 60).round().clamp(0, 24 * 60);
                                  final ok = await OmDialog.showSheet<bool>(
                                    context,
                                    title: '点歌停留时长',
                                    subtitle: '避免新号刚进房就立刻刷歌。',
                                    child: StatefulBuilder(
                                      builder: (context, setLocal) => Column(
                                        mainAxisSize: MainAxisSize.min,
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            minutes <= 0 ? '当前：不限制' : '当前：$minutes 分钟',
                                            style: const TextStyle(color: OmTheme.textPrimary),
                                          ),
                                          Slider(
                                            value: minutes.toDouble(),
                                            min: 0,
                                            max: 24 * 60,
                                            divisions: 24 * 12,
                                            activeColor: OmTheme.red,
                                            onChanged: (v) => setLocal(() => minutes = v.round()),
                                          ),
                                        ],
                                      ),
                                    ),
                                    actions: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: OutlinedButton(
                                              onPressed: () => Navigator.pop(context, false),
                                              child: const Text('取消'),
                                            ),
                                          ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: FilledButton(
                                              onPressed: () => Navigator.pop(context, true),
                                              child: const Text('保存'),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  );
                                  if (ok == true) {
                                    await updateSongRequest(minStaySec: minutes * 60);
                                  }
                                },
                        ),
                        _SettingsTile(
                          icon: Icons.person_2_outlined,
                          title: '每人最多保留几首',
                          value: room.songRequestMaxPerUser <= 0
                              ? '不限制'
                              : '${room.songRequestMaxPerUser} 首',
                          onTap: !canModerate(roles)
                              ? null
                              : () async {
                                  var count = room.songRequestMaxPerUser.clamp(0, 50);
                                  final ok = await OmDialog.showSheet<bool>(
                                    context,
                                    title: '每人保留上限',
                                    subtitle: '限制单个成员在队列中的待播数量。',
                                    child: StatefulBuilder(
                                      builder: (context, setLocal) => Column(
                                        mainAxisSize: MainAxisSize.min,
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            count <= 0 ? '当前：不限制' : '当前：$count 首',
                                            style: const TextStyle(color: OmTheme.textPrimary),
                                          ),
                                          Slider(
                                            value: count.toDouble(),
                                            min: 0,
                                            max: 50,
                                            divisions: 50,
                                            activeColor: OmTheme.red,
                                            onChanged: (v) => setLocal(() => count = v.round()),
                                          ),
                                        ],
                                      ),
                                    ),
                                    actions: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: OutlinedButton(
                                              onPressed: () => Navigator.pop(context, false),
                                              child: const Text('取消'),
                                            ),
                                          ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: FilledButton(
                                              onPressed: () => Navigator.pop(context, true),
                                              child: const Text('保存'),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  );
                                  if (ok == true) {
                                    await updateSongRequest(maxPerUser: count);
                                  }
                                },
                        ),
                        _SettingsTile(
                          icon: Icons.hourglass_bottom_outlined,
                          title: '每人点歌冷却',
                          value: room.songRequestCooldownSec <= 0
                              ? '不限制'
                              : '${room.songRequestCooldownSec} 秒',
                          onTap: !canModerate(roles)
                              ? null
                              : () async {
                                  var sec = room.songRequestCooldownSec.clamp(0, 600);
                                  final ok = await OmDialog.showSheet<bool>(
                                    context,
                                    title: '点歌冷却',
                                    subtitle: '限制同一成员连续点歌的间隔。',
                                    child: StatefulBuilder(
                                      builder: (context, setLocal) => Column(
                                        mainAxisSize: MainAxisSize.min,
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            sec <= 0 ? '当前：不限制' : '当前：$sec 秒',
                                            style: const TextStyle(color: OmTheme.textPrimary),
                                          ),
                                          Slider(
                                            value: sec.toDouble(),
                                            min: 0,
                                            max: 600,
                                            divisions: 60,
                                            activeColor: OmTheme.red,
                                            onChanged: (v) => setLocal(() => sec = v.round()),
                                          ),
                                        ],
                                      ),
                                    ),
                                    actions: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: OutlinedButton(
                                              onPressed: () => Navigator.pop(context, false),
                                              child: const Text('取消'),
                                            ),
                                          ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: FilledButton(
                                              onPressed: () => Navigator.pop(context, true),
                                              child: const Text('保存'),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  );
                                  if (ok == true) {
                                    await updateSongRequest(cooldownSec: sec);
                                  }
                                },
                        ),
                        _SettingsTile(
                          icon: Icons.queue_music_outlined,
                          title: '队列最大长度',
                          value: '${room.queueMaxLength} 首',
                          onTap: !canModerate(roles)
                              ? null
                              : () async {
                                  var count = room.queueMaxLength.clamp(1, 200);
                                  final ok = await OmDialog.showSheet<bool>(
                                    context,
                                    title: '队列上限',
                                    subtitle: '超出后新的点歌请求会被拒绝。',
                                    child: StatefulBuilder(
                                      builder: (context, setLocal) => Column(
                                        mainAxisSize: MainAxisSize.min,
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            '当前：$count 首',
                                            style: const TextStyle(color: OmTheme.textPrimary),
                                          ),
                                          Slider(
                                            value: count.toDouble(),
                                            min: 1,
                                            max: 200,
                                            divisions: 199,
                                            activeColor: OmTheme.red,
                                            onChanged: (v) => setLocal(() => count = v.round()),
                                          ),
                                        ],
                                      ),
                                    ),
                                    actions: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: OutlinedButton(
                                              onPressed: () => Navigator.pop(context, false),
                                              child: const Text('取消'),
                                            ),
                                          ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: FilledButton(
                                              onPressed: () => Navigator.pop(context, true),
                                              child: const Text('保存'),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  );
                                  if (ok == true) {
                                    await updateSongRequest(queueMaxLength: count);
                                  }
                                },
                        ),
                      ],
                    ),
                    _SettingsGroup(
                      title: '聊天',
                      children: [
                        _SettingsTile(
                          icon: Icons.history_toggle_off_rounded,
                          title: '新成员可看历史聊天',
                          trailing: Switch.adaptive(
                            value: room.chatHistoryVisibleOnJoin,
                            activeTrackColor: OmTheme.red,
                            onChanged: !canModerate(roles)
                                ? null
                                : (v) async {
                                    final res = await notifier.setChatHistoryVisibleOnJoin(v);
                                    if (res['success'] != true && context.mounted) {
                                      omSnack(
                                        context,
                                        '${res['error'] ?? '设置失败'}',
                                      );
                                    }
                                  },
                          ),
                        ),
                        _SettingsTile(
                          icon: Icons.account_circle_outlined,
                          title: '聊天室显示头像',
                          trailing: Switch.adaptive(
                            value: room.chatShowAvatars,
                            activeTrackColor: OmTheme.red,
                            onChanged: !roles.isOwner
                                ? null
                                : (v) async {
                                    final res = await notifier.setRoomChatAvatars(v);
                                    if (res['success'] != true && context.mounted) {
                                      omSnack(
                                        context,
                                        '${res['error'] ?? '设置失败'}',
                                      );
                                    }
                                  },
                          ),
                        ),
                        _SettingsTile(
                          icon: Icons.notifications_active_outlined,
                          title: '进房提醒',
                          value: room.joinNoticeEnabled
                              ? '已开启 · 冷却 ${room.joinNoticeCooldownMinutes} 分钟'
                              : '未开启',
                          onTap: !roles.isOwner
                              ? null
                              : () async {
                                  var enabled = room.joinNoticeEnabled;
                                  var minutes = room.joinNoticeCooldownMinutes.clamp(0, 24 * 60);
                                  final ok = await OmDialog.showSheet<bool>(
                                    context,
                                    title: '进房提醒',
                                    subtitle: '同一用户在冷却时间内重复进房时不再提醒。',
                                    child: StatefulBuilder(
                                      builder: (context, setLocal) => Column(
                                        mainAxisSize: MainAxisSize.min,
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            children: [
                                              const Text(
                                                '开启提醒',
                                                style: TextStyle(color: OmTheme.textPrimary),
                                              ),
                                              const Spacer(),
                                              Switch.adaptive(
                                                value: enabled,
                                                activeTrackColor: OmTheme.red,
                                                onChanged: (v) => setLocal(() => enabled = v),
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 8),
                                          Text(
                                            '冷却：$minutes 分钟',
                                            style: const TextStyle(color: OmTheme.textPrimary),
                                          ),
                                          Slider(
                                            value: minutes.toDouble(),
                                            min: 0,
                                            max: 24 * 60,
                                            divisions: 24 * 6,
                                            activeColor: OmTheme.red,
                                            onChanged: (v) => setLocal(() => minutes = v.round()),
                                          ),
                                        ],
                                      ),
                                    ),
                                    actions: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: OutlinedButton(
                                              onPressed: () => Navigator.pop(context, false),
                                              child: const Text('取消'),
                                            ),
                                          ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: FilledButton(
                                              onPressed: () => Navigator.pop(context, true),
                                              child: const Text('保存'),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  );
                                  if (ok != true) return;
                                  final res = await notifier.setRoomJoinNotice(
                                    enabled: enabled,
                                    cooldownSec: minutes * 60,
                                  );
                                  if (res['success'] != true && context.mounted) {
                                    omSnack(context, '${res['error'] ?? '设置失败'}');
                                  }
                                },
                        ),
                      ],
                    ),
                    _SettingsGroup(
                      title: '更多',
                      children: [
                        _SettingsTile(
                          icon: Icons.campaign_outlined,
                          title: '房间公告',
                          value: room.announcementEnabled
                              ? (room.announcementText ?? '已开启')
                              : '未开启',
                          onTap: !canModerate(roles)
                              ? null
                              : () async {
                                  final ctrl =
                                      TextEditingController(text: room.announcementText ?? '');
                                  var enabled = room.announcementEnabled;
                                  final ok = await OmDialog.showSheet<bool>(
                                    context,
                                    title: '房间公告',
                                    child: StatefulBuilder(
                                      builder: (d, setLocal) => Column(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Row(
                                            children: [
                                              const Text(
                                                '开启公告',
                                                style: TextStyle(color: OmTheme.textPrimary),
                                              ),
                                              const Spacer(),
                                              Switch.adaptive(
                                                value: enabled,
                                                activeTrackColor: OmTheme.red,
                                                onChanged: (v) => setLocal(() => enabled = v),
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 12),
                                          OmField(
                                            controller: ctrl,
                                            hint: '输入公告内容',
                                          ),
                                        ],
                                      ),
                                    ),
                                    actions: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: OutlinedButton(
                                              onPressed: () => Navigator.pop(context, false),
                                              child: const Text('取消'),
                                            ),
                                          ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: FilledButton(
                                              onPressed: () => Navigator.pop(context, true),
                                              child: const Text('保存'),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  );
                                  if (ok == true) {
                                    await notifier.setRoomAnnouncement(
                                      enabled: enabled,
                                      text: ctrl.text,
                                    );
                                  }
                                },
                        ),
                        _SettingsTile(
                          icon: Icons.favorite_border_rounded,
                          title: '我的收藏',
                          onTap: () async {
                            final res = await notifier.listFavorites();
                            if (!context.mounted) return;
                            final songs = res['songs'] ?? res['favorites'];
                            await OmDialog.showSheet<void>(
                              context,
                              title: '我的收藏',
                              child: songs is List && songs.isNotEmpty
                                  ? SizedBox(
                                      height: 320,
                                      child: ListView.separated(
                                        itemCount: songs.length,
                                        separatorBuilder: (_, __) =>
                                            const Divider(height: 1, color: OmTheme.divider),
                                        itemBuilder: (_, i) {
                                          final map = Map<String, dynamic>.from(songs[i] as Map);
                                          final song = Song.fromJson(map);
                                          return ListTile(
                                            dense: true,
                                            contentPadding: EdgeInsets.zero,
                                            title: Text(
                                              song.name,
                                              style: const TextStyle(
                                                color: OmTheme.textPrimary,
                                                fontSize: 14,
                                              ),
                                            ),
                                            subtitle: Text(
                                              song.artist,
                                              style: const TextStyle(
                                                color: OmTheme.textHint,
                                                fontSize: 12,
                                              ),
                                            ),
                                            trailing: IconButton(
                                              icon: const Icon(Icons.add_circle_outline, color: OmTheme.red),
                                              onPressed: () => notifier.addSong(song),
                                            ),
                                          );
                                        },
                                      ),
                                    )
                                  : const Padding(
                                      padding: EdgeInsets.symmetric(vertical: 24),
                                      child: Center(
                                        child: Text('暂无收藏', style: TextStyle(color: OmTheme.textHint)),
                                      ),
                                    ),
                            );
                          },
                        ),
                      ],
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

  static String _playModeLabel(String mode) => switch (mode) {
        'shuffle' => '随机播放',
        'loop-one' => '单曲循环',
        'loop-all' => '列表循环',
        _ => '顺序播放',
      };

  static String _normalizeFmMode(String? mode) {
    const valid = {
      'DEFAULT',
      'FAMILIAR',
      'EXPLORE',
      'SCENE_RCMD:EXERCISE',
      'SCENE_RCMD:FOCUS',
      'SCENE_RCMD:NIGHT_EMO',
      'aidj',
      'OFF',
    };
    final raw = (mode ?? '').trim();
    if (valid.contains(raw)) return raw;
    return 'DEFAULT';
  }

  static String _fmModeLabel(String? mode) => switch (_normalizeFmMode(mode)) {
        'FAMILIAR' => '熟悉模式',
        'EXPLORE' => '探索模式',
        'SCENE_RCMD:EXERCISE' => '运动场景',
        'SCENE_RCMD:FOCUS' => '专注场景',
        'SCENE_RCMD:NIGHT_EMO' => '深夜场景',
        'aidj' => 'AI DJ',
        'OFF' => '已关闭',
        _ => '默认漫游',
      };
}

class _MemberSettingsSheet extends ConsumerStatefulWidget {
  const _MemberSettingsSheet({required this.initial});

  final RoomMemberSettings initial;

  @override
  ConsumerState<_MemberSettingsSheet> createState() => _MemberSettingsSheetState();
}

class _MemberSettingsSheetState extends ConsumerState<_MemberSettingsSheet> {
  late final TextEditingController _customCtrl;
  late bool _welcomeEnabled;
  late bool _confettiEnabled;
  late String _templateId;
  late int _cooldownMinutes;
  var _saving = false;

  @override
  void initState() {
    super.initState();
    _customCtrl = TextEditingController(text: widget.initial.welcomeCustomText ?? '');
    _welcomeEnabled = widget.initial.welcomeEnabled;
    _confettiEnabled = widget.initial.confettiEnabled;
    _templateId = normalizeMemberWelcomeTemplateId(widget.initial.welcomeTemplateId);
    _cooldownMinutes =
        (normalizeMemberWelcomeCooldownSec(widget.initial.welcomeCooldownSec) / 60).round();
  }

  @override
  void dispose() {
    _customCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final settings = RoomMemberSettings(
      welcomeEnabled: _welcomeEnabled && _templateId != 'none',
      welcomeTemplateId: _templateId,
      welcomeCustomText: _customCtrl.text.trim(),
      confettiEnabled: _confettiEnabled,
      welcomeCooldownSec: _cooldownMinutes * 60,
    );
    final res = await ref.read(roomSessionProvider.notifier).setRoomMemberSettings(settings);
    if (!mounted) return;
    setState(() => _saving = false);
    if (res['success'] == true) {
      Navigator.pop(context);
      omSnack(context, '已保存贵宾默认设置');
      return;
    }
    omSnack(context, '${res['error'] ?? '保存失败'}');
  }

  @override
  Widget build(BuildContext context) {
    final preview = buildMemberWelcomePreview(
      templateId: _welcomeEnabled ? _templateId : 'none',
      customText: _customCtrl.text,
      badgeLabel: '贵宾',
      nickname: '新贵宾',
    );
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
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                '贵宾默认设置',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: OmTheme.textPrimary,
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                '影响未单独覆盖的贵宾进房欢迎语与礼花默认值。',
                style: TextStyle(fontSize: 12, color: OmTheme.textHint),
              ),
              const SizedBox(height: 16),
              SwitchListTile(
                value: _welcomeEnabled,
                contentPadding: EdgeInsets.zero,
                title: const Text('默认欢迎语'),
                subtitle: const Text('新贵宾默认继承此欢迎语配置'),
                onChanged: _saving ? null : (value) => setState(() => _welcomeEnabled = value),
              ),
              SwitchListTile(
                value: _confettiEnabled,
                contentPadding: EdgeInsets.zero,
                title: const Text('默认礼花'),
                subtitle: const Text('新贵宾默认继承此礼花开关'),
                onChanged: _saving ? null : (value) => setState(() => _confettiEnabled = value),
              ),
              DropdownButtonFormField<String>(
                initialValue: _templateId,
                decoration: const InputDecoration(labelText: '默认欢迎语模板'),
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
                    labelText: '默认自定义欢迎语',
                    hintText: '支持 {badge} 和 {nickname}',
                  ),
                ),
              ],
              const SizedBox(height: 12),
              DropdownButtonFormField<int>(
                initialValue: _cooldownMinutes,
                decoration: const InputDecoration(labelText: '默认重复欢迎冷却'),
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
              if (preview.isNotEmpty) ...[
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0x14F6D365),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0x40F6D365)),
                  ),
                  child: Text(
                    preview,
                    style: const TextStyle(color: OmTheme.textPrimary, height: 1.4),
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

class _AvatarSettingsSheet extends ConsumerStatefulWidget {
  const _AvatarSettingsSheet({
    required this.initialUrl,
    required this.nickname,
  });

  final String initialUrl;
  final String nickname;

  @override
  ConsumerState<_AvatarSettingsSheet> createState() => _AvatarSettingsSheetState();
}

class _AvatarSettingsSheetState extends ConsumerState<_AvatarSettingsSheet> {
  late String _draft;
  var _saving = false;
  var _picking = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _draft = widget.initialUrl.trim();
  }

  Future<void> _pick(ImageSource source) async {
    if (_picking || _saving) return;
    setState(() {
      _picking = true;
      _error = null;
    });
    try {
      final dataUrl = await pickAvatarDataUrl(source: source);
      if (!mounted || dataUrl == null) return;
      setState(() => _draft = dataUrl);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _picking = false);
    }
  }

  Future<void> _editUrl() async {
    final ctrl = TextEditingController(text: _draft.startsWith('http') ? _draft : '');
    final next = await OmDialog.showSheet<String>(
      context,
      title: '使用图片链接',
      subtitle: '也可粘贴 https 图片地址；留空表示清除。',
      child: OmField(
        controller: ctrl,
        hint: 'https://example.com/avatar.png',
      ),
      actions: [
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('取消'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: FilledButton(
                onPressed: () => Navigator.pop(context, ctrl.text.trim()),
                child: const Text('应用'),
              ),
            ),
          ],
        ),
      ],
    );
    if (next == null || !mounted) return;
    if (next.isNotEmpty && !isSupportedAvatarDataUrl(next)) {
      setState(() => _error = '仅支持 JPG/PNG 或 http(s) 链接');
      return;
    }
    setState(() {
      _draft = next;
      _error = null;
    });
  }

  Future<void> _save() async {
    if (_saving) return;
    final next = _draft.trim();
    if (next.isNotEmpty && !isSupportedAvatarDataUrl(next)) {
      setState(() => _error = '头像格式无效或过大');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final res = await ref.read(roomSessionProvider.notifier).setUserAvatar(next);
    if (!mounted) return;
    setState(() => _saving = false);
    if (res['success'] == true) {
      Navigator.pop(context);
      return;
    }
    setState(() => _error = '${res['error'] ?? '保存失败'}');
  }

  @override
  Widget build(BuildContext context) {
    final letter = widget.nickname.isNotEmpty
        ? widget.nickname.substring(0, 1).toUpperCase()
        : '?';
    final fallback = Container(
      width: 96,
      height: 96,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [OmTheme.red, OmTheme.red.withValues(alpha: 0.7)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: Text(
        letter,
        style: const TextStyle(
          fontSize: 36,
          fontWeight: FontWeight.w700,
          color: Colors.white,
        ),
      ),
    );

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: Container(
        margin: const EdgeInsets.fromLTRB(10, 0, 10, 10),
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
        decoration: BoxDecoration(
          color: OmTheme.card,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 36,
              height: 4,
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.18),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            const Text(
              '设置头像',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: OmTheme.textPrimary,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              '像 QQ 一样从相册或拍照选择，也会同步到聊天室。',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: OmTheme.textHint),
            ),
            const SizedBox(height: 18),
            GestureDetector(
              onTap: _picking ? null : () => _pick(ImageSource.gallery),
              child: Stack(
                alignment: Alignment.bottomRight,
                children: [
                  ClipOval(
                    child: SizedBox(
                      width: 96,
                      height: 96,
                      child: _draft.isEmpty
                          ? fallback
                          : OmCoverImage(
                              url: _draft,
                              sizePx: 192,
                              fit: BoxFit.cover,
                              fallback: fallback,
                            ),
                    ),
                  ),
                  Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: OmTheme.red,
                      shape: BoxShape.circle,
                      border: Border.all(color: OmTheme.card, width: 2),
                    ),
                    child: Icon(
                      _picking ? Icons.hourglass_top_rounded : Icons.camera_alt_rounded,
                      size: 14,
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _picking || _saving
                        ? null
                        : () => _pick(ImageSource.gallery),
                    icon: const Icon(Icons.photo_library_outlined, size: 18),
                    label: const Text('相册'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _picking || _saving
                        ? null
                        : () => _pick(ImageSource.camera),
                    icon: const Icon(Icons.photo_camera_outlined, size: 18),
                    label: const Text('拍照'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TextButton(
                    onPressed: _picking || _saving ? null : _editUrl,
                    child: const Text('使用图片链接'),
                  ),
                ),
                TextButton(
                  onPressed: _picking || _saving || _draft.isEmpty
                      ? null
                      : () => setState(() {
                            _draft = '';
                            _error = null;
                          }),
                  child: const Text('清除头像'),
                ),
              ],
            ),
            if (_error != null) ...[
              const SizedBox(height: 4),
              Text(
                _error!,
                style: const TextStyle(fontSize: 12, color: Color(0xFFF87171)),
              ),
            ],
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _picking || _saving ? null : _save,
                child: Text(_saving ? '保存中...' : '保存'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _IdentitySettingsSheet extends ConsumerStatefulWidget {
  const _IdentitySettingsSheet({required this.room, required this.myUserId});

  final RoomState room;
  final String? myUserId;

  @override
  ConsumerState<_IdentitySettingsSheet> createState() => _IdentitySettingsSheetState();
}

class _IdentitySettingsSheetState extends ConsumerState<_IdentitySettingsSheet> {
  OAuthStatus? _linuxdo;
  OAuthStatus? _github;
  var _loading = true;
  var _busy = false;

  bool get _isOwner => widget.room.creatorId == widget.myUserId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final results = await Future.wait([
      IdentityAuthApi.fetchLinuxdoStatus(),
      IdentityAuthApi.fetchGithubStatus(),
    ]);
    if (!mounted) return;
    setState(() {
      _linuxdo = results[0];
      _github = results[1];
      _loading = false;
    });
  }

  Future<void> _openAuth(
    String title,
    Uri url,
    String resultKey,
  ) async {
    final result = await Navigator.of(context).push<IdentityAuthResult>(
      MaterialPageRoute(
        builder: (_) => IdentityAuthPage(
          title: title,
          startUrl: url,
          resultQueryKey: resultKey,
        ),
      ),
    );
    if (!mounted || result == null) return;
    omSnack(context, result.message);
    await _load();
  }

  Future<void> _unbindLinuxdo() async {
    setState(() => _busy = true);
    final res = await IdentityAuthApi.unbindLinuxdo();
    if (!mounted) return;
    setState(() => _busy = false);
    omSnack(context, res['success'] == true ? '已解绑 Linux.do' : '${res['error'] ?? '解绑失败'}');
    if (res['success'] == true) await _load();
  }

  Future<void> _unbindGithub() async {
    setState(() => _busy = true);
    final res = await IdentityAuthApi.unbindGithub();
    if (!mounted) return;
    setState(() => _busy = false);
    omSnack(context, res['success'] == true ? '已解绑 GitHub' : '${res['error'] ?? '解绑失败'}');
    if (res['success'] == true) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final roomPath = '/room/${widget.room.id}';
    final linuxdo = _linuxdo ?? const OAuthStatus(enabled: false);
    final github = _github ?? const OAuthStatus(enabled: false);
    return SafeArea(
      child: Container(
        decoration: const BoxDecoration(
          color: OmTheme.card,
          borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
        ),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _isOwner ? '房主身份绑定' : '找回房主身份',
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: OmTheme.textPrimary,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              _isOwner
                  ? '绑定后换设备可用同一账号找回房主身份。'
                  : '换设备或清除 Cookie 后，可用此前绑定的账号找回房主身份。',
              style: const TextStyle(fontSize: 12, color: OmTheme.textHint),
            ),
            const SizedBox(height: 14),
            if (_loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(child: CircularProgressIndicator()),
              )
            else ...[
              _IdentityProviderTile(
                title: 'Linux.do',
                enabled: linuxdo.enabled,
                boundLabel: linuxdo.bound?.username,
                busy: _busy,
                onPrimary: !linuxdo.enabled
                    ? null
                    : () => _openAuth(
                          _isOwner ? '绑定 Linux.do' : 'Linux.do 找回',
                          _isOwner
                              ? IdentityAuthApi.buildLinuxdoBindUri(widget.room.id, roomPath)
                              : IdentityAuthApi.buildLinuxdoRecoverUri(roomPath),
                          'linuxdo',
                        ),
                primaryLabel: _isOwner
                    ? (linuxdo.bound == null ? '绑定' : '重新绑定')
                    : 'Linux.do 找回',
                onSecondary: _isOwner && linuxdo.bound != null ? _unbindLinuxdo : null,
                secondaryLabel: '解绑',
              ),
              const SizedBox(height: 10),
              _IdentityProviderTile(
                title: 'GitHub',
                enabled: github.enabled,
                boundLabel: github.bound?.username,
                busy: _busy,
                onPrimary: !github.enabled
                    ? null
                    : () => _openAuth(
                          _isOwner ? '绑定 GitHub' : 'GitHub 找回',
                          _isOwner
                              ? IdentityAuthApi.buildGithubBindUri(widget.room.id, roomPath)
                              : IdentityAuthApi.buildGithubRecoverUri(roomPath),
                          'github',
                        ),
                primaryLabel: _isOwner
                    ? (github.bound == null ? '绑定' : '重新绑定')
                    : 'GitHub 找回',
                onSecondary: _isOwner && github.bound != null ? _unbindGithub : null,
                secondaryLabel: '解绑',
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _IdentityProviderTile extends StatelessWidget {
  const _IdentityProviderTile({
    required this.title,
    required this.enabled,
    required this.primaryLabel,
    required this.busy,
    this.boundLabel,
    this.onPrimary,
    this.onSecondary,
    this.secondaryLabel,
  });

  final String title;
  final bool enabled;
  final String? boundLabel;
  final String primaryLabel;
  final bool busy;
  final VoidCallback? onPrimary;
  final VoidCallback? onSecondary;
  final String? secondaryLabel;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: OmTheme.elevated,
        borderRadius: BorderRadius.circular(14),
      ),
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: OmTheme.textPrimary,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  !enabled
                      ? '当前服务端未启用'
                      : (boundLabel?.isNotEmpty == true ? '已绑定：$boundLabel' : '未绑定'),
                  style: const TextStyle(fontSize: 12, color: OmTheme.textHint),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: busy ? null : onPrimary,
            child: Text(primaryLabel),
          ),
          if (onSecondary != null && secondaryLabel != null)
            TextButton(
              onPressed: busy ? null : onSecondary,
              child: Text(secondaryLabel!),
            ),
        ],
      ),
    );
  }
}

class _SettingsGroup extends StatelessWidget {
  const _SettingsGroup({this.title, required this.children});
  final String? title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (title != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 16, 24, 6),
            child: Text(
              title!,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: OmTheme.textHint,
                letterSpacing: 0.3,
              ),
            ),
          ),
        Container(
          margin: EdgeInsets.fromLTRB(12, title == null ? 8 : 0, 12, 0),
          decoration: BoxDecoration(
            color: OmTheme.elevated,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(children: children),
        ),
      ],
    );
  }
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.icon,
    required this.title,
    this.value,
    this.trailing,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String? value;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Icon(icon, size: 20, color: OmTheme.textSecondary),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(fontSize: 15, color: OmTheme.textPrimary),
                ),
              ),
              if (trailing != null)
                trailing!
              else if (value != null)
                Flexible(
                  child: Text(
                    value!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13, color: OmTheme.textHint),
                  ),
                ),
              if (onTap != null && trailing == null)
                const Icon(Icons.chevron_right_rounded, size: 18, color: OmTheme.textHint),
            ],
          ),
        ),
      ),
    );
  }
}

class _OptionTile extends StatelessWidget {
  const _OptionTile({
    required this.label,
    this.selected = false,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 14),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                    color: selected ? OmTheme.red : OmTheme.textPrimary,
                  ),
                ),
              ),
              if (selected) const Icon(Icons.check_rounded, color: OmTheme.red, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

class _SheetLabel extends StatelessWidget {
  const _SheetLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: OmTheme.textSecondary,
      ),
    );
  }
}

class _ChoicePill extends StatelessWidget {
  const _ChoicePill({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? OmTheme.red.withValues(alpha: 0.12) : OmTheme.elevated,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? OmTheme.red.withValues(alpha: 0.55) : Colors.transparent,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
            color: selected ? OmTheme.red : OmTheme.textPrimary,
          ),
        ),
      ),
    );
  }
}
