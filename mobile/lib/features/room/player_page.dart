import 'dart:ui';

import 'package:audio_video_progress_bar/audio_video_progress_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openmusic/app/om_icons.dart';
import 'package:openmusic/app/theme.dart';
import 'package:openmusic/data/music_api.dart';
import 'package:openmusic/data/socket_room_repository.dart';
import 'package:openmusic/domain/models.dart';
import 'package:openmusic/domain/permissions.dart';
import 'package:openmusic/features/room/player/synced_lyrics_view.dart';
import 'package:openmusic/playback/audio_handler.dart';
import 'package:openmusic/playback/playback_sync_engine.dart';
import 'package:openmusic/widgets/om_cover_image.dart';
import 'package:openmusic/widgets/om_dialog.dart';
import 'package:openmusic/widgets/om_ui.dart';

const _playModes = ['order', 'shuffle', 'loop-one', 'loop-all', 'shuffle-loop'];

String _normalizePlayMode(String? mode) {
  final m = (mode ?? '').trim().toLowerCase();
  return _playModes.contains(m) ? m : 'order';
}

String _nextPlayMode(String? mode) {
  final cur = _normalizePlayMode(mode);
  final i = _playModes.indexOf(cur);
  return _playModes[(i + 1) % _playModes.length];
}

(IconData, String) _playModeMeta(String mode) => switch (_normalizePlayMode(mode)) {
      'shuffle' => (Icons.shuffle_rounded, '随机播放'),
      'loop-one' => (Icons.repeat_one_rounded, '单曲循环'),
      'loop-all' => (Icons.repeat_rounded, '列表循环'),
      'shuffle-loop' => (Icons.casino_rounded, '列表内随机'),
      _ => (Icons.queue_music_rounded, '顺序播放'),
    };

/// Mobile full-screen player — NetEase / QQ style (not desktop vinyl).
class PlayerPage extends ConsumerStatefulWidget {
  const PlayerPage({super.key});

  @override
  ConsumerState<PlayerPage> createState() => _PlayerPageState();
}

class _PlayerPageState extends ConsumerState<PlayerPage> {
  String? _lrc;
  String? _lrcTrack;
  var _lrcLoading = false;
  final Set<String> _favoriteKeys = {};
  var _favoritesLoaded = false;
  Duration? _dragProgress;

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
        final s = Song.fromJson(Map<String, dynamic>.from(e));
        if (s.id.isNotEmpty) keys.add(s.songKey);
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

  Future<void> _ensureLyrics(QueueItem current) async {
    if (_lrcTrack == current.queueId) return;
    final trackId = current.queueId;
    _lrcTrack = trackId;
    setState(() {
      _lrc = null;
      _lrcLoading = true;
    });
    final l = await MusicApi.getLyrics(current);
    if (!mounted || _lrcTrack != trackId) return;
    setState(() {
      _lrc = l;
      _lrcLoading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(roomSessionProvider);
    final room = session.room;
    final current = room?.current;
    if (room == null || current == null) {
      return Scaffold(
        backgroundColor: OmTheme.bg,
        appBar: AppBar(),
        body: const OmEmptyState(icon: Icons.music_off_rounded, title: '暂无播放'),
      );
    }

    final roles = session.rolesOrNull!;
    final pos = ref.watch(playerPositionProvider);
    final playerDur = ref.watch(playerDurationProvider);
    final metaDurSec = current.duration ?? session.playback?.durationSec ?? 0.0;
    final metaSec = metaDurSec > 10000 ? metaDurSec / 1000.0 : metaDurSec;
    // Ignore zero/invalid just_audio duration so ProgressBar doesn't show -0:01.
    final total = (playerDur != null && playerDur > Duration.zero)
        ? playerDur
        : (metaSec > 0
            ? Duration(milliseconds: (metaSec * 1000).round())
            : Duration.zero);
    final favorited = _favoriteKeys.contains(current.songKey);
    final pendingSkip =
        room.skipRequests.any((r) => r.requestedBy == session.mySocketId);

    if (_lrcTrack != current.queueId) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _ensureLyrics(current);
      });
    }

    final sync = ref.read(playbackSyncProvider);
    final localPlaying = openMusicAudioHandler?.player.playing ?? false;
    final effectivePlaying = session.playback?.isPlaying ?? room.isPlaying;
    final lyricsLoading = _lrcLoading || _lrcTrack != current.queueId;

    return Scaffold(
      backgroundColor: OmTheme.bg,
      body: Stack(
        fit: StackFit.expand,
        children: [
          _AmbientBackground(coverUrl: current.pic),
          SafeArea(
            child: Column(
              children: [
                _PlayerTopBar(
                  roomName: room.name,
                  roomId: room.id,
                  isPlaying: effectivePlaying,
                  onClose: () => Navigator.of(context).pop(),
                ),
                const SizedBox(height: 8),
                _SquareCover(coverUrl: current.pic, isPlaying: effectivePlaying),
                const SizedBox(height: 18),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 28),
                  child: Column(
                    children: [
                      Text(
                        current.name,
                        textAlign: TextAlign.center,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                          letterSpacing: -0.3,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        current.artist,
                        textAlign: TextAlign.center,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14,
                          color: Colors.white.withValues(alpha: 0.65),
                        ),
                      ),
                      const SizedBox(height: 4),
                      IconButton(
                        tooltip: favorited ? '取消收藏' : '收藏',
                        onPressed: !_favoritesLoaded
                            ? null
                            : () async {
                                final next = !favorited;
                                final res = await ref
                                    .read(roomSessionProvider.notifier)
                                    .setFavorite(current, next);
                                if (!mounted || !context.mounted) return;
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
                        icon: Icon(
                          favorited ? Icons.favorite : Icons.favorite_border,
                          color: favorited ? OmTheme.red : Colors.white70,
                        ),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: ClipRect(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: OmLyricPanel(
                        lrc: lyricsLoading ? null : _lrc,
                        loading: lyricsLoading,
                        isPlaying: effectivePlaying,
                        position: _dragProgress ?? pos,
                        onSeek: !canSeek(room, roles)
                            ? null
                            : (d) => sync.seekLocalAndRemote(d),
                      ),
                    ),
                  ),
                ),
                _PlayerControls(
                  progress: _dragProgress ?? pos,
                  total: total,
                  isPlaying: effectivePlaying,
                  playMode: room.playMode,
                  canControlPlayMode: roles.canControlPlayback,
                  canPause: canPause(room, roles),
                  canSeek: canSeek(room, roles),
                  canSkip: roles.canControlPlayback,
                  pendingSkip: pendingSkip,
                  onDragUpdate: (d) {
                    if (!canSeek(room, roles)) return;
                    setState(() => _dragProgress = d);
                    sync.holdSeekPreview(d);
                  },
                  onSeek: (d) {
                    if (!canSeek(room, roles)) {
                      omSnack(context, '房主未开启成员拖动进度');
                      setState(() => _dragProgress = null);
                      return;
                    }
                    // Seek (hold + optimistic) first so scrubber never flashes to stale stream value.
                    sync.seekLocalAndRemote(d);
                    setState(() => _dragProgress = null);
                  },
                  onCyclePlayMode: () async {
                    if (!roles.canControlPlayback) {
                      omSnack(context, '仅房主/管理员可切换播放模式');
                      return;
                    }
                    final next = _nextPlayMode(room.playMode);
                    final res = await ref
                        .read(roomSessionProvider.notifier)
                        .setRoomPlayMode(next);
                    if (!mounted || !context.mounted) return;
                    if (res['success'] != true) {
                      omSnack(context, '${res['error'] ?? '切换失败'}');
                    }
                  },
                  onTogglePlay: () {
                    if (canPause(room, roles)) {
                      // Fire-and-forget — optimistic UI flips instantly.
                      sync.togglePlayLocalAndRemote(!effectivePlaying);
                      return;
                    }
                    if (localPlaying && !effectivePlaying) {
                      openMusicAudioHandler?.softPause();
                      return;
                    }
                    if (effectivePlaying) {
                      sync.unlockLocalAudio();
                      omSnack(context, '已尝试开启本机声音');
                      return;
                    }
                    omSnack(context, '房主未开启成员暂停/播放权限');
                  },
                  onSkip: () => ref.read(roomSessionProvider.notifier).skipSong(),
                  onRequestSkip: () async {
                    final res = await ref.read(roomSessionProvider.notifier).requestSkip();
                    if (!mounted || !context.mounted) return;
                    omSnack(
                      context,
                      res['success'] == true
                          ? '已提交切歌申请'
                          : '${res['error'] ?? '申请失败'}',
                    );
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AmbientBackground extends StatelessWidget {
  const _AmbientBackground({required this.coverUrl});
  final String? coverUrl;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        ColoredBox(color: OmTheme.bg),
        if (coverUrl != null && coverUrl!.trim().isNotEmpty)
          ImageFiltered(
            imageFilter: ImageFilter.blur(sigmaX: 48, sigmaY: 48),
            child: Transform.scale(
              scale: 1.2,
              child: OmCoverImage(
                url: coverUrl,
                sizePx: 400,
                fit: BoxFit.cover,
                fallback: const ColoredBox(color: OmTheme.bg),
              ),
            ),
          ),
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                Colors.black.withValues(alpha: 0.35),
                Colors.black.withValues(alpha: 0.55),
                OmTheme.bg.withValues(alpha: 0.92),
                OmTheme.bg,
              ],
              stops: const [0, 0.35, 0.72, 1],
            ),
          ),
        ),
      ],
    );
  }
}

class _PlayerTopBar extends StatelessWidget {
  const _PlayerTopBar({
    required this.roomName,
    required this.roomId,
    required this.isPlaying,
    required this.onClose,
  });

  final String roomName;
  final String roomId;
  final bool isPlaying;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 4, 12, 0),
      child: Row(
        children: [
          IconButton(
            icon: Icon(OmIcons.chevronDown, size: 28),
            color: Colors.white,
            onPressed: onClose,
          ),
          Expanded(
            child: Column(
              children: [
                Text(
                  roomName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
                Text(
                  isPlaying ? '正在播放' : '已暂停',
                  style: TextStyle(
                    fontSize: 11,
                    color: Colors.white.withValues(alpha: 0.55),
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              roomId,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: Colors.white.withValues(alpha: 0.75),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SquareCover extends StatelessWidget {
  const _SquareCover({required this.coverUrl, required this.isPlaying});
  final String? coverUrl;
  final bool isPlaying;

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context).shortestSide.clamp(168.0, 220.0);
    return AnimatedScale(
      scale: isPlaying ? 1.0 : 0.96,
      duration: const Duration(milliseconds: 280),
      curve: Curves.easeOutCubic,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.45),
              blurRadius: 28,
              offset: const Offset(0, 14),
            ),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: OmCoverImage(
          url: coverUrl,
          sizePx: 520,
          fallback: ColoredBox(
            color: OmTheme.elevated,
            child: Icon(
              Icons.album_rounded,
              size: 64,
              color: Colors.white.withValues(alpha: 0.35),
            ),
          ),
        ),
      ),
    );
  }
}

class _PlayerControls extends StatelessWidget {
  const _PlayerControls({
    required this.progress,
    required this.total,
    required this.isPlaying,
    required this.playMode,
    required this.canControlPlayMode,
    required this.canPause,
    required this.canSeek,
    required this.canSkip,
    required this.pendingSkip,
    required this.onSeek,
    required this.onDragUpdate,
    required this.onCyclePlayMode,
    required this.onTogglePlay,
    required this.onSkip,
    required this.onRequestSkip,
  });

  final Duration progress;
  final Duration total;
  final bool isPlaying;
  final String playMode;
  final bool canControlPlayMode;
  final bool canPause;
  final bool canSeek;
  final bool canSkip;
  final bool pendingSkip;
  final ValueChanged<Duration> onSeek;
  final ValueChanged<Duration> onDragUpdate;
  final VoidCallback onCyclePlayMode;
  final VoidCallback onTogglePlay;
  final VoidCallback onSkip;
  final VoidCallback onRequestSkip;

  @override
  Widget build(BuildContext context) {
    final modeMeta = _playModeMeta(playMode);
    return Material(
      color: OmTheme.bg.withValues(alpha: 0.92),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(22, 8, 22, 12),
        child: Column(
          children: [
            ProgressBar(
              progress: total > Duration.zero && progress > total ? total : progress,
              total: total > Duration.zero ? total : const Duration(minutes: 4),
              onSeek: onSeek,
              onDragUpdate: (details) => onDragUpdate(details.timeStamp),
              barHeight: 3,
              baseBarColor: Colors.white24,
              progressBarColor: Colors.white,
              bufferedBarColor: Colors.white38,
              thumbColor: Colors.white,
              thumbRadius: 6,
              timeLabelLocation: TimeLabelLocation.below,
              timeLabelTextStyle: const TextStyle(fontSize: 11, color: Colors.white54),
              timeLabelPadding: 6,
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                IconButton(
                  iconSize: 28,
                  color: _normalizePlayMode(playMode) == 'order'
                      ? Colors.white70
                      : OmTheme.red,
                  tooltip: canControlPlayMode
                      ? modeMeta.$2
                      : '${modeMeta.$2}（仅房主/管理员可切换）',
                  onPressed: onCyclePlayMode,
                  icon: Icon(modeMeta.$1),
                ),
                Material(
                  color: Colors.white,
                  shape: const CircleBorder(),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: onTogglePlay,
                    child: SizedBox(
                      width: 64,
                      height: 64,
                      child: Icon(
                        isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
                        size: 36,
                        color: OmTheme.bg,
                      ),
                    ),
                  ),
                ),
                if (canSkip)
                  IconButton(
                    iconSize: 32,
                    color: Colors.white70,
                    onPressed: onSkip,
                    icon: const Icon(Icons.skip_next_rounded),
                  )
                else
                  IconButton(
                    iconSize: 26,
                    color: pendingSkip ? OmTheme.red : Colors.white70,
                    tooltip: pendingSkip ? '已申请切歌' : '申请切歌',
                    onPressed: pendingSkip ? null : onRequestSkip,
                    icon: Icon(pendingSkip ? Icons.flag : Icons.flag_outlined),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
