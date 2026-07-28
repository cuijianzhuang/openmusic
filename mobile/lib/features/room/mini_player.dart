import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:openmusic/app/om_icons.dart';
import 'package:openmusic/app/theme.dart';
import 'package:openmusic/data/socket_room_repository.dart';
import 'package:openmusic/domain/permissions.dart';
import 'package:openmusic/features/room/search_tab.dart';
import 'package:openmusic/playback/playback_sync_engine.dart';
import 'package:openmusic/widgets/om_cover_image.dart';
import 'package:openmusic/widgets/om_dialog.dart';
import 'package:openmusic/widgets/om_ui.dart';

/// Compact bottom mini player — cover / play / skip + history on the right.
class MiniPlayerBar extends ConsumerWidget {
  const MiniPlayerBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(roomSessionProvider);
    final room = session.room;
    final current = room?.current;
    if (room == null || current == null) return const SizedBox.shrink();

    final roles = session.rolesOrNull!;
    final pos = ref.watch(playerPositionProvider).valueOrNull ?? Duration.zero;
    final durSec = current.duration ?? session.playback?.durationSec ?? 0;
    final progress = durSec > 0 ? (pos.inMilliseconds / 1000) / durSec : 0.0;
    final pendingSkip =
        room.skipRequests.any((r) => r.requestedBy == session.mySocketId);

    return Container(
      decoration: const BoxDecoration(
        color: OmTheme.card,
        border: Border(top: BorderSide(color: OmTheme.divider, width: 0.5)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            height: 2,
            child: FractionallySizedBox(
              alignment: Alignment.centerLeft,
              widthFactor: progress.clamp(0.0, 1.0),
              child: const ColoredBox(color: OmTheme.red),
            ),
          ),
          Material(
            color: Colors.transparent,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 6, 4, 6),
              child: Row(
                children: [
                  Expanded(
                    child: InkWell(
                      onTap: () => context.push('/room/${room.id}/player'),
                      borderRadius: BorderRadius.circular(8),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 2),
                        child: Row(
                          children: [
                            ClipRRect(
                              borderRadius: BorderRadius.circular(6),
                              child: SizedBox(
                                width: 44,
                                height: 44,
                                child: OmCoverImage(
                                  url: current.pic,
                                  sizePx: 88,
                                  fallback: ColoredBox(
                                    color: OmTheme.elevated,
                                    child: const Icon(
                                      Icons.music_note,
                                      color: OmTheme.textHint,
                                      size: 20,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    current.name,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w500,
                                      color: OmTheme.textPrimary,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    current.artist,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 11,
                                      color: OmTheme.textHint,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  if (room.isPlaying || (session.playback?.isPlaying ?? false))
                    const Padding(
                      padding: EdgeInsets.only(right: 2),
                      child: OmPlayingBars(size: 12, color: OmTheme.red),
                    ),
                  IconButton(
                    icon: Icon(
                      (session.playback?.isPlaying ?? room.isPlaying)
                          ? OmIcons.pause
                          : OmIcons.play,
                      color: OmTheme.textPrimary,
                      size: 26,
                    ),
                    onPressed: () {
                      final sync = ref.read(playbackSyncProvider);
                      final playing = session.playback?.isPlaying ?? room.isPlaying;
                      if (canPause(room, roles)) {
                        sync.togglePlayLocalAndRemote(!playing);
                        return;
                      }
                      if (playing) {
                        sync.unlockLocalAudio();
                        if (context.mounted) omSnack(context, '已尝试开启本机声音');
                        return;
                      }
                      if (context.mounted) {
                        omSnack(context, '房主未开启成员暂停/播放权限');
                      }
                    },
                  ),
                  if (roles.canControlPlayback)
                    IconButton(
                      icon: Icon(OmIcons.skipForward, color: OmTheme.textSecondary, size: 24),
                      tooltip: '下一首',
                      onPressed: () => ref.read(roomSessionProvider.notifier).skipSong(),
                    )
                  else
                    IconButton(
                      icon: Icon(
                        OmIcons.flag,
                        color: pendingSkip ? OmTheme.red : OmTheme.textSecondary,
                        size: 20,
                      ),
                      tooltip: pendingSkip ? '已申请切歌' : '申请切歌',
                      onPressed: pendingSkip
                          ? null
                          : () async {
                              final res = await ref
                                  .read(roomSessionProvider.notifier)
                                  .requestSkip();
                              if (!context.mounted) return;
                              omSnack(
                                context,
                                res['success'] == true
                                    ? '已提交切歌申请'
                                    : '${res['error'] ?? '申请失败'}',
                              );
                            },
                    ),
                  IconButton(
                    tooltip: '播放历史',
                    icon: const Icon(Icons.history_rounded, color: OmTheme.textSecondary, size: 22),
                    onPressed: () => showSongHistorySheet(context, ref),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
