import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:openmusic/app/theme.dart';
import 'package:openmusic/data/dislike_skip.dart';
import 'package:openmusic/data/socket_room_repository.dart';
import 'package:openmusic/domain/models.dart';
import 'package:openmusic/domain/permissions.dart';
import 'package:openmusic/features/room/room_widgets.dart';
import 'package:openmusic/widgets/om_dialog.dart';
import 'package:openmusic/widgets/om_ui.dart';

class QueueTab extends ConsumerStatefulWidget {
  const QueueTab({super.key});

  @override
  ConsumerState<QueueTab> createState() => _QueueTabState();
}

class _QueueTabState extends ConsumerState<QueueTab> {
  final Set<String> _favoriteKeys = {};
  var _favoritesLoaded = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadFavorites());
  }

  Future<void> _loadFavorites() async {
    try {
      final res = await ref.read(roomSessionProvider.notifier).listFavorites();
      final raw = res['favorites'] ?? res['songs'] ?? res['items'];
      if (raw is! List) {
        if (mounted) setState(() => _favoritesLoaded = true);
        return;
      }
      final keys = <String>{};
      for (final e in raw.whereType<Map>()) {
        final id = '${e['id'] ?? ''}';
        final source = '${e['source'] ?? 'netease'}';
        if (id.isNotEmpty) keys.add('$source:$id');
      }
      if (mounted) {
        setState(() {
          _favoriteKeys
            ..clear()
            ..addAll(keys);
          _favoritesLoaded = true;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _favoritesLoaded = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(roomSessionProvider);
    final room = session.room;
    if (room == null) return const SizedBox.shrink();
    final roles = session.rolesOrNull!;
    final current = room.current;
    final queue = room.queue;
    final canManage = canModerate(roles);
    final canJump = canManage || room.memberJumpEnabled;
    final favorited = current != null && _favoriteKeys.contains(current.songKey);
    final dislikeCount = current?.dislikedByIds.length ?? 0;
    final dislikeNeed = resolveDislikeSkipThreshold(room);
    final dislikedByMe =
        current != null && current.dislikedByIds.contains(session.mySocketId);
    RoomMemberTier? resolveTier(String? userId, String fallbackNickname) {
      if (userId != null && userId.isNotEmpty) {
        return room.memberTiers[userId];
      }
      for (final user in room.users) {
        if (user.nickname == fallbackNickname) return room.memberTiers[user.id];
      }
      return null;
    }
    final currentTier = current == null ? null : resolveTier(current.requestedById, current.requestedBy);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (current != null)
          OmNowPlayingCard(
            title: current.name,
            artist: current.artist,
            coverUrl: current.pic,
            isPlaying: room.isPlaying,
            requestedBy: current.requestedBy,
            memberTier: currentTier,
            onTap: () => context.push('/room/${room.id}/player'),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Tooltip(
                  message: dislikedByMe
                      ? '取消踩（$dislikeCount/$dislikeNeed）'
                      : '踩歌（$dislikeCount/$dislikeNeed）',
                  child: InkWell(
                    onTap: () async {
                      final res = await ref
                          .read(roomSessionProvider.notifier)
                          .toggleCurrentDislike();
                      if (!context.mounted) return;
                      if (res['success'] != true) {
                        omSnack(context, '${res['error'] ?? '操作失败'}');
                      }
                    },
                    borderRadius: BorderRadius.circular(16),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            dislikedByMe
                                ? Icons.thumb_down_alt
                                : Icons.thumb_down_alt_outlined,
                            size: 18,
                            color: dislikedByMe ? OmTheme.red : OmTheme.textHint,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            '$dislikeCount/$dislikeNeed',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: dislikedByMe ? OmTheme.red : OmTheme.textHint,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                if (canManage)
                  IconButton(
                    icon: const Icon(
                      Icons.block_outlined,
                      size: 20,
                      color: OmTheme.textHint,
                    ),
                    tooltip: '禁播当前歌曲',
                    onPressed: () async {
                      final ok = await OmDialog.confirm(
                        context,
                        title: '禁播歌曲',
                        subtitle: '确定将《${current.name}》加入当前房间禁播列表？',
                        confirmLabel: '禁播',
                        content: Text(
                          current.artist,
                          style: const TextStyle(color: OmTheme.textHint),
                        ),
                      );
                      if (ok != true) return;
                      final res = await ref
                          .read(roomSessionProvider.notifier)
                          .banRoomSong(current);
                      if (!context.mounted) return;
                      omSnack(
                        context,
                        res['success'] == true ? '已加入禁播' : '${res['error'] ?? '操作失败'}',
                      );
                    },
                  ),
                IconButton(
                  icon: Icon(
                    favorited ? Icons.favorite : Icons.favorite_border,
                    size: 20,
                    color: favorited ? OmTheme.red : OmTheme.textHint,
                  ),
                  tooltip: favorited ? '取消收藏' : '收藏',
                  onPressed: !_favoritesLoaded
                      ? null
                      : () async {
                          final next = !favorited;
                          final res = await ref
                              .read(roomSessionProvider.notifier)
                              .setFavorite(current, next);
                          if (!context.mounted) return;
                          if (res['success'] == true) {
                            setState(() {
                              if (next) {
                                _favoriteKeys.add(current.songKey);
                              } else {
                                _favoriteKeys.remove(current.songKey);
                              }
                            });
                          } else {
                            omSnack(context, '${res['error'] ?? '收藏失败'}');
                          }
                        },
                ),
              ],
            ),
          ),
        OmSectionHeader(
          '待播放 ${queue.length}',
          trailing: canManage
              ? TextButton(
                  onPressed: () async {
                    final ok = await OmDialog.confirm(
                      context,
                      title: '清空队列',
                      subtitle: '确定清空所有待播歌曲？',
                      confirmLabel: '清空',
                      content: const SizedBox.shrink(),
                    );
                    if (ok == true) {
                      await ref.read(roomSessionProvider.notifier).clearQueue();
                    }
                  },
                  child: const Text('清空', style: TextStyle(color: OmTheme.textHint, fontSize: 13)),
                )
              : null,
        ),
        Expanded(
          child: queue.isEmpty
              ? const OmEmptyState(
                  icon: Icons.queue_music_rounded,
                  title: '队列为空',
                  subtitle: '切换到「点歌」搜索添加歌曲',
                )
              : ListView.builder(
                  physics: const BouncingScrollPhysics(),
                  itemCount: queue.length,
                  itemBuilder: (context, i) {
                    final item = queue[i];
                    final liked = item.likedByIds.contains(session.mySocketId);
                    final canRemove = canManage || item.requestedById == session.mySocketId;
                    final itemTier = resolveTier(item.requestedById, item.requestedBy);
                    return OmSongRow(
                      title: item.name,
                      subtitle:
                          '${item.artist} · ${item.requestedBy}${item.likedByIds.isNotEmpty ? ' · ${item.likedByIds.length} 赞' : ''}',
                      coverUrl: item.pic,
                      memberTier: itemTier,
                      showDivider: i < queue.length - 1,
                      dividerIndent: 68,
                      leading: SizedBox(
                        width: 36,
                        child: Text(
                          '${i + 1}',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 14,
                            color: OmTheme.textHint,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (canJump)
                            IconButton(
                              icon: const Icon(Icons.north_rounded, size: 20, color: OmTheme.textHint),
                              tooltip: '插队',
                              onPressed: () async {
                                final res = await ref
                                    .read(roomSessionProvider.notifier)
                                    .requestJump(item.queueId);
                                if (!context.mounted) return;
                                omSnack(
                                  context,
                                  res['success'] == true
                                      ? '已发送插队请求'
                                      : '${res['error'] ?? '插队失败'}',
                                );
                              },
                            ),
                          IconButton(
                            icon: Icon(
                              liked ? Icons.favorite : Icons.favorite_border,
                              size: 20,
                              color: liked ? OmTheme.red : OmTheme.textHint,
                            ),
                            onPressed: () => ref
                                .read(roomSessionProvider.notifier)
                                .toggleQueueLike(item.queueId),
                          ),
                          if (canRemove)
                            IconButton(
                              icon: const Icon(Icons.close_rounded, size: 18, color: OmTheme.textHint),
                              onPressed: () => ref
                                  .read(roomSessionProvider.notifier)
                                  .removeSong(item.queueId),
                            ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
