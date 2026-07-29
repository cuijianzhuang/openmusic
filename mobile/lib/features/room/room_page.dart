import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:openmusic/app/brand.dart';
import 'package:openmusic/app/om_icons.dart';
import 'package:openmusic/app/theme.dart';
import 'package:openmusic/core/announcement_seen.dart';
import 'package:openmusic/core/random_nickname.dart';
import 'package:openmusic/data/local_cache.dart';
import 'package:openmusic/data/socket_room_repository.dart';
import 'package:openmusic/domain/models.dart';
import 'package:openmusic/domain/permissions.dart';
import 'package:openmusic/features/lobby/lobby_page.dart';
import 'package:openmusic/features/room/chat_tab.dart';
import 'package:openmusic/features/room/mini_player.dart';
import 'package:openmusic/features/room/queue_tab.dart';
import 'package:openmusic/features/room/search_tab.dart';
import 'package:openmusic/features/room/settings_sheet.dart';
import 'package:openmusic/features/room/users_sheet.dart';
import 'package:openmusic/widgets/om_dialog.dart';
import 'package:openmusic/widgets/om_ui.dart';

class RoomPage extends ConsumerStatefulWidget {
  const RoomPage({super.key, required this.roomId, this.password});

  final String roomId;
  final String? password;

  @override
  ConsumerState<RoomPage> createState() => _RoomPageState();
}

class _RoomPageState extends ConsumerState<RoomPage> {
  var _joined = false;
  String? _joinError;

  static const _tabs = [
    (OmIcons.listMusic, '播放队列'),
    (OmIcons.search, '点歌'),
    (OmIcons.messageCircle, '聊天'),
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _join());
  }

  Future<void> _join() async {
    var nick = ref.read(nicknameProvider).trim();
    if (nick.isEmpty) nick = await LocalCache.getNickname();
    if (nick.isEmpty) {
      // Mirror web Room.tsx — auto-fill random nickname when missing.
      nick = createRandomNickname();
      ref.read(nicknameProvider.notifier).state = nick;
      await LocalCache.setNickname(nick);
    }
    try {
      await ref.read(roomSessionProvider.notifier).joinRoom(
            roomId: widget.roomId,
            nickname: nick,
            password: widget.password,
          );
      if (!mounted) return;
      // 对齐网页：进房后同步本地头像
      await ref.read(roomSessionProvider.notifier).syncLocalAvatar();
      if (!mounted) return;
      setState(() => _joined = true);
      await _maybeShowAnnouncement();
    } catch (e) {
      if (mounted) setState(() => _joinError = e.toString());
    }
  }

  Future<void> _maybeShowAnnouncement() async {
    final room = ref.read(roomSessionProvider).room;
    if (room == null) return;
    final show = await shouldAutoShowAnnouncement(
      roomId: room.id,
      enabled: room.announcementEnabled,
      text: room.announcementText,
    );
    if (!show || !mounted) return;
    final text = room.announcementText?.trim() ?? '';
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: OmTheme.card,
        title: const Text('房间公告', style: TextStyle(color: OmTheme.textPrimary)),
        content: SingleChildScrollView(
          child: Text(text, style: const TextStyle(color: OmTheme.textSecondary, height: 1.45)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('知道了'),
          ),
        ],
      ),
    );
    await markAnnouncementSeen(
      roomId: room.id,
      enabled: room.announcementEnabled,
      text: room.announcementText,
    );
  }

  Future<void> _leave() async {
    ref.read(roomTabIndexProvider.notifier).state = 0;
    await ref.read(roomSessionProvider.notifier).leaveRoom();
    if (mounted) context.go('/');
  }

  Future<void> _copyRoomId(String roomId) async {
    await Clipboard.setData(ClipboardData(text: roomId));
    if (!mounted) return;
    omSnack(context, '房间号已复制');
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(roomSessionProvider);

    ref.listen(roomSessionProvider, (prev, next) {
      if (next.kickedReason != null && prev?.kickedReason == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(next.kickedReason!)),
        );
        context.go('/');
      }
    });

    if (_joinError != null) {
      return Scaffold(
        backgroundColor: OmTheme.bg,
        appBar: AppBar(title: const Text('进房失败')),
        body: OmEmptyState(
          icon: Icons.door_front_door_rounded,
          title: '无法进入房间',
          subtitle: _joinError,
          action: FilledButton(
            onPressed: () => context.go('/'),
            child: const Text('返回大厅'),
          ),
        ),
      );
    }

    if (!_joined || session.joining || session.room == null) {
      return Scaffold(
        backgroundColor: OmTheme.bg,
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const BrandMark(size: 52),
              const SizedBox(height: 24),
              const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2, color: OmTheme.red),
              ),
              const SizedBox(height: 16),
              const Text('正在加入房间…', style: TextStyle(color: OmTheme.textSecondary)),
            ],
          ),
        ),
      );
    }

    final room = session.room!;
    final roles = session.rolesOrNull!;
    final tab = ref.watch(roomTabIndexProvider);

    return Scaffold(
      backgroundColor: OmTheme.bg,
      appBar: AppBar(
        backgroundColor: OmTheme.bg,
        leading: IconButton(
          icon: omIcon(OmIcons.chevronLeft, size: 22),
          onPressed: _leave,
        ),
        title: Column(
          children: [
            Text(
              room.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
            Text(
              '${room.id} · ${room.userCount} 人在线',
              style: const TextStyle(
                fontSize: 11,
                color: OmTheme.textHint,
                fontWeight: FontWeight.w400,
              ),
            ),
          ],
        ),
        centerTitle: true,
        actions: [
          IconButton(
            icon: omIcon(OmIcons.copy, size: 20, color: OmTheme.textSecondary),
            tooltip: '复制房间号',
            onPressed: () => _copyRoomId(room.id),
          ),
          IconButton(
            icon: omIcon(OmIcons.users, size: 20, color: OmTheme.textSecondary),
            tooltip: '在线用户',
            onPressed: () => showUsersSheet(context, ref),
          ),
          IconButton(
            icon: omIcon(OmIcons.moreHorizontal, size: 22, color: OmTheme.textSecondary),
            tooltip: '房间设置',
            onPressed: () => showRoomSettingsSheet(context, ref),
          ),
        ],
      ),
      body: Column(
        children: [
          if (canModerate(roles) &&
              (room.skipRequests.isNotEmpty || room.jumpRequests.isNotEmpty))
            _PendingRequestsBar(
              skipRequests: room.skipRequests,
              jumpRequests: room.jumpRequests,
            ),
          Expanded(
            child: IndexedStack(
              index: tab,
              children: const [
                QueueTab(),
                SearchTab(),
                ChatTab(),
              ],
            ),
          ),
          // 聊天页不显示底部歌曲栏，避免挤占输入区。
          if (tab != 2) const MiniPlayerBar(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: tab,
        onDestinationSelected: (i) =>
            ref.read(roomTabIndexProvider.notifier).state = i,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        destinations: [
          for (final t in _tabs)
            NavigationDestination(
              icon: Icon(t.$1, size: 22, color: OmTheme.textHint),
              selectedIcon: Icon(t.$1, size: 22, color: OmTheme.textPrimary),
              label: t.$2,
            ),
        ],
      ),
    );
  }
}

/// Compact approval strip for host/admin — sits above the three tabs.
class _PendingRequestsBar extends ConsumerWidget {
  const _PendingRequestsBar({
    required this.skipRequests,
    required this.jumpRequests,
  });

  final List<SkipRequest> skipRequests;
  final List<JumpRequest> jumpRequests;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = <Widget>[
      for (final r in skipRequests)
        _RequestTile(
          icon: Icons.skip_next_rounded,
          title: '${r.nickname} 申请切歌',
          subtitle: r.songName,
          onApprove: () async {
            final res = await ref.read(roomSessionProvider.notifier).approveSkip(r.id);
            if (!context.mounted) return;
            omSnack(
              context,
              res['success'] == true ? '已同意切歌' : '${res['error'] ?? '操作失败'}',
            );
          },
          onReject: () async {
            final res = await ref.read(roomSessionProvider.notifier).rejectSkip(r.id);
            if (!context.mounted) return;
            omSnack(
              context,
              res['success'] == true ? '已拒绝切歌' : '${res['error'] ?? '操作失败'}',
            );
          },
        ),
      for (final r in jumpRequests)
        _RequestTile(
          icon: Icons.north_rounded,
          title: '${r.nickname} 申请插队',
          subtitle: r.songName,
          onApprove: () async {
            final res = await ref.read(roomSessionProvider.notifier).approveJump(r.id);
            if (!context.mounted) return;
            omSnack(
              context,
              res['success'] == true ? '已同意插队' : '${res['error'] ?? '操作失败'}',
            );
          },
          onReject: () async {
            final res = await ref.read(roomSessionProvider.notifier).rejectJump(r.id);
            if (!context.mounted) return;
            omSnack(
              context,
              res['success'] == true ? '已拒绝插队' : '${res['error'] ?? '操作失败'}',
            );
          },
        ),
    ];
    return Material(
      color: OmTheme.elevated,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 0; i < items.length; i++) ...[
            items[i],
            if (i < items.length - 1)
              const Divider(height: 1, color: OmTheme.divider),
          ],
        ],
      ),
    );
  }
}

class _RequestTile extends StatelessWidget {
  const _RequestTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onApprove,
    required this.onReject,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onApprove;
  final VoidCallback onReject;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      dense: true,
      leading: Icon(icon, color: OmTheme.red, size: 22),
      title: Text(title, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
      subtitle: Text(
        subtitle,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 12, color: OmTheme.textHint),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextButton(
            onPressed: onReject,
            style: TextButton.styleFrom(
              foregroundColor: OmTheme.textSecondary,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('拒绝'),
          ),
          const SizedBox(width: 6),
          FilledButton(
            onPressed: onApprove,
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('同意'),
          ),
        ],
      ),
    );
  }
}
