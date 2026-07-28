import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:openmusic/app/brand.dart';
import 'package:openmusic/app/om_icons.dart';
import 'package:openmusic/app/theme.dart';
import 'package:openmusic/core/random_nickname.dart';
import 'package:openmusic/data/local_cache.dart';
import 'package:openmusic/data/room_api.dart';
import 'package:openmusic/domain/models.dart';
import 'package:openmusic/widgets/om_cover_image.dart';
import 'package:openmusic/widgets/om_dialog.dart';
import 'package:openmusic/widgets/om_ui.dart';

final nicknameProvider = StateProvider<String>((ref) => '');
final roomsProvider = FutureProvider.autoDispose<List<RoomSummary>>((ref) async {
  return RoomApi.listRooms();
});

class LobbyPage extends ConsumerStatefulWidget {
  const LobbyPage({super.key});

  @override
  ConsumerState<LobbyPage> createState() => _LobbyPageState();
}

class _LobbyPageState extends ConsumerState<LobbyPage> {
  final _nickCtrl = TextEditingController();
  final _nickFocus = FocusNode();
  Timer? _pollTimer;
  String? _announcement;
  List<String> _recentRoomIds = const [];

  @override
  void initState() {
    super.initState();
    _bootstrap();
    _pollTimer = Timer.periodic(const Duration(seconds: 8), (_) {
      if (mounted) ref.invalidate(roomsProvider);
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _nickCtrl.dispose();
    _nickFocus.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    var nick = await LocalCache.getNickname();
    if (nick.trim().isEmpty) {
      nick = createRandomNickname();
      await LocalCache.setNickname(nick);
    }
    final recent = await LocalCache.getRecentRoomIds();
    _nickCtrl.text = nick;
    ref.read(nicknameProvider.notifier).state = nick;
    if (mounted) setState(() => _recentRoomIds = recent);
    try {
      final data = await RoomApi.siteAnnouncement();
      final text = data?['text'] as String? ?? data?['content'] as String?;
      if (mounted && text != null && text.trim().isNotEmpty) {
        setState(() => _announcement = text.trim());
      }
    } catch (_) {}
  }

  Future<void> _saveNick(String v) async {
    ref.read(nicknameProvider.notifier).state = v;
    await LocalCache.setNickname(v);
  }

  Future<void> _rememberRoom(String roomId) async {
    final next = await LocalCache.rememberRoom(roomId);
    if (mounted) setState(() => _recentRoomIds = next);
  }

  Future<void> _refreshRooms() async {
    ref.invalidate(roomsProvider);
    await ref.read(roomsProvider.future).catchError((_) => <RoomSummary>[]);
  }

  bool _requireNick() {
    final nick = _nickCtrl.text.trim();
    if (nick.isEmpty) {
      _nickFocus.requestFocus();
      omSnack(context, '请先填写昵称');
      return false;
    }
    _saveNick(nick);
    return true;
  }

  Future<void> _createRoom() async {
    if (!_requireNick()) return;
    final nameCtrl = TextEditingController();
    final pwdCtrl = TextEditingController();
    final nick = _nickCtrl.text.trim();
    final ok = await OmDialog.confirm(
      context,
      title: '创建房间',
      subtitle: '以 $nick 的身份创建',
      confirmLabel: '创建',
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          OmField(controller: nameCtrl, label: '房间名', hint: '$nick 的房间'),
          const SizedBox(height: 12),
          OmField(controller: pwdCtrl, label: '访问密码', hint: '留空即公开', obscure: true),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      final room = await RoomApi.createRoom(
        nameCtrl.text.trim().isEmpty ? '$nick 的房间' : nameCtrl.text.trim(),
        password: pwdCtrl.text,
      );
      await _rememberRoom(room.id);
      if (!mounted) return;
      final password = pwdCtrl.text.trim();
      final query = password.isEmpty ? '' : '?password=${Uri.encodeQueryComponent(password)}';
      context.push('/room/${room.id}$query');
    } catch (e) {
      if (mounted) omSnack(context, '$e');
    }
  }

  Future<void> _joinRoom() async {
    if (!_requireNick()) return;
    final codeCtrl = TextEditingController();
    final pwdCtrl = TextEditingController();
    final ok = await OmDialog.confirm(
      context,
      title: '加入房间',
      subtitle: '输入 6 位房间号',
      confirmLabel: '加入',
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          OmField(
            controller: codeCtrl,
            label: '房间号',
            hint: '例如 ABC123',
            textCapitalization: TextCapitalization.characters,
            autofocus: true,
          ),
          const SizedBox(height: 12),
          OmField(controller: pwdCtrl, label: '房间密码', hint: '如房间已上锁', obscure: true),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final code = codeCtrl.text.trim().toUpperCase();
    if (code.isEmpty) {
      omSnack(context, '请输入房间号');
      return;
    }
    try {
      final room = await RoomApi.checkRoom(code);
      if (!mounted) return;
      if (room['exists'] != true) {
        omSnack(context, '房间不存在，请检查房间号');
        return;
      }
      final password = pwdCtrl.text.trim();
      await _enterRoom(code, password: password.isEmpty ? null : password);
    } catch (e) {
      if (mounted) omSnack(context, '$e');
    }
  }

  Future<void> _enterRoom(String roomId, {String? password}) async {
    await _rememberRoom(roomId);
    if (!mounted) return;
    final query = (password == null || password.isEmpty)
        ? ''
        : '?password=${Uri.encodeQueryComponent(password)}';
    context.push('/room/$roomId$query');
  }

  List<RoomSummary> _sorted(List<RoomSummary> rooms) {
    final copy = [...rooms];
    copy.sort((a, b) {
      final playDiff = (b.isPlaying ? 1 : 0) - (a.isPlaying ? 1 : 0);
      if (playDiff != 0) return playDiff;
      return b.userCount.compareTo(a.userCount);
    });
    return copy;
  }

  @override
  Widget build(BuildContext context) {
    final roomsAsync = ref.watch(roomsProvider);
    final greeting = _greeting();

    return Scaffold(
      backgroundColor: OmTheme.bg,
      body: RefreshIndicator(
        color: OmTheme.red,
        backgroundColor: OmTheme.elevated,
        onRefresh: _refreshRooms,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
          slivers: [
            SliverToBoxAdapter(
              child: SafeArea(
                bottom: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const BrandMark(size: 36),
                          const SizedBox(width: 10),
                          const Expanded(
                            child: Text(
                              'OpenMusic',
                              style: TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.w800,
                                letterSpacing: -0.4,
                              ),
                            ),
                          ),
                          if (_announcement != null)
                            IconButton(
                              tooltip: '公告',
                              onPressed: () => OmDialog.showSheet<void>(
                                context,
                                title: '站点公告',
                                child: Text(
                                  _announcement!,
                                  style: const TextStyle(
                                    color: OmTheme.textSecondary,
                                    height: 1.55,
                                  ),
                                ),
                              ),
                              icon: omIcon(OmIcons.megaphone, color: OmTheme.textSecondary),
                            ),
                          IconButton(
                            tooltip: '刷新',
                            onPressed: _refreshRooms,
                            icon: omIcon(OmIcons.refresh, color: OmTheme.textSecondary),
                          ),
                        ],
                      ),
                      const SizedBox(height: 22),
                      Text(
                        greeting,
                        style: Theme.of(context).textTheme.headlineMedium,
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        '和朋友同步听同一首歌',
                        style: TextStyle(color: OmTheme.textSecondary, fontSize: 14),
                      ),
                      const SizedBox(height: 20),
                      _NickField(
                        controller: _nickCtrl,
                        focusNode: _nickFocus,
                        onChanged: _saveNick,
                      ),
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          Expanded(
                            child: FilledButton.icon(
                              onPressed: _createRoom,
                              icon: omIcon(OmIcons.plus, size: 18, color: Colors.black),
                              label: const Text('创建房间'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: _joinRoom,
                              icon: omIcon(OmIcons.logIn, size: 18),
                              label: const Text('加入房间'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
            ...roomsAsync.when(
              loading: () => [
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.all(48),
                    child: Center(
                      child: SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2, color: OmTheme.red),
                      ),
                    ),
                  ),
                ),
              ],
              error: (_, __) => [
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: OmEmptyState(
                      icon: Icons.wifi_off_rounded,
                      title: '加载失败',
                      subtitle: '下拉重试，或检查本地服务是否在跑',
                      action: TextButton(onPressed: _refreshRooms, child: const Text('重试')),
                    ),
                  ),
                ),
              ],
              data: (rooms) {
                final sorted = _sorted(rooms);
                final recent = <RoomSummary>[];
                final others = <RoomSummary>[];
                final recentSet = _recentRoomIds.toSet();
                for (final r in sorted) {
                  (recentSet.contains(r.id) ? recent : others).add(r);
                }
                recent.sort((a, b) =>
                    _recentRoomIds.indexOf(a.id).compareTo(_recentRoomIds.indexOf(b.id)));

                if (sorted.isEmpty) {
                  return [
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 32, 20, 0),
                        child: OmEmptyState(
                          icon: Icons.headphones_rounded,
                          title: '还没有活跃房间',
                          subtitle: '创建一个，邀请朋友一起听',
                          action: FilledButton(
                            onPressed: _createRoom,
                            child: const Text('创建我的房间'),
                          ),
                        ),
                      ),
                    ),
                  ];
                }

                return [
                  if (recent.isNotEmpty) ...[
                    const SliverToBoxAdapter(
                      child: Padding(
                        padding: EdgeInsets.fromLTRB(20, 28, 20, 12),
                        child: Text(
                          '最近去过',
                          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
                        ),
                      ),
                    ),
                    SliverToBoxAdapter(
                      child: SizedBox(
                        height: 168,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          padding: const EdgeInsets.symmetric(horizontal: 20),
                          itemCount: recent.length,
                          separatorBuilder: (_, __) => const SizedBox(width: 12),
                          itemBuilder: (context, i) => _RecentRoomCard(
                            room: recent[i],
                            onTap: () => _enterRoom(recent[i].id),
                          ),
                        ),
                      ),
                    ),
                  ],
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(20, recent.isEmpty ? 28 : 24, 20, 12),
                      child: Text(
                        recent.isEmpty ? '活跃房间' : '探索更多',
                        style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
                      ),
                    ),
                  ),
                  for (final room in (others.isEmpty ? sorted : others))
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 0, 20, 10),
                        child: _RoomListTile(
                          room: room,
                          onTap: () => _enterRoom(room.id),
                        ),
                      ),
                    ),
                  const SliverToBoxAdapter(child: SizedBox(height: 32)),
                ];
              },
            ),
          ],
        ),
      ),
    );
  }

  String _greeting() {
    final h = DateTime.now().hour;
    if (h < 5) return '夜深了';
    if (h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }
}

class _NickField extends StatelessWidget {
  const _NickField({
    required this.controller,
    required this.focusNode,
    required this.onChanged,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      focusNode: focusNode,
      onChanged: onChanged,
      style: const TextStyle(color: OmTheme.textPrimary, fontSize: 15),
      decoration: InputDecoration(
        hintText: '给自己起个昵称…',
        prefixIcon: Padding(
          padding: const EdgeInsets.only(left: 12, right: 8),
          child: omIcon(OmIcons.users, size: 18, color: OmTheme.textHint),
        ),
        prefixIconConstraints: const BoxConstraints(minWidth: 40),
        suffixIcon: IconButton(
          tooltip: '随机昵称',
          onPressed: () {
            final nick = createRandomNickname();
            controller.text = nick;
            controller.selection = TextSelection.collapsed(offset: nick.length);
            onChanged(nick);
          },
          icon: const Icon(Icons.casino_rounded, color: OmTheme.textSecondary, size: 20),
        ),
      ),
    );
  }
}

class _RecentRoomCard extends StatelessWidget {
  const _RecentRoomCard({required this.room, required this.onTap});

  final RoomSummary room;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(OmTheme.radiusMd),
      child: SizedBox(
        width: 128,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(OmTheme.radiusMd),
              child: SizedBox(
                width: 128,
                height: 128,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    OmCoverImage(
                      url: room.customCoverUrl ?? room.currentSongPic,
                      sizePx: 256,
                      fallback: ColoredBox(
                        color: OmTheme.elevated,
                        child: Icon(OmIcons.music, color: OmTheme.textHint.withValues(alpha: 0.5), size: 36),
                      ),
                    ),
                    if (room.isPlaying)
                      const Positioned(
                        right: 8,
                        bottom: 8,
                        child: Icon(OmIcons.play, color: Colors.white, size: 18),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              room.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
    );
  }
}

class _RoomListTile extends StatelessWidget {
  const _RoomListTile({required this.room, required this.onTap});

  final RoomSummary room;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: OmTheme.card,
      borderRadius: BorderRadius.circular(OmTheme.radiusMd),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(OmTheme.radiusMd),
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: SizedBox(
                  width: 56,
                  height: 56,
                  child: OmCoverImage(
                    url: room.customCoverUrl ?? room.currentSongPic,
                    sizePx: 112,
                    fallback: ColoredBox(
                      color: OmTheme.elevated,
                      child: Icon(OmIcons.music, color: OmTheme.textHint, size: 22),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      room.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      [
                        room.id,
                        '${room.userCount} 人',
                        if (room.isPlaying) '播放中',
                        if (room.hasPassword) '有密码',
                      ].join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12, color: OmTheme.textHint),
                    ),
                  ],
                ),
              ),
              Icon(OmIcons.play, size: 18, color: OmTheme.textSecondary),
            ],
          ),
        ),
      ),
    );
  }
}
