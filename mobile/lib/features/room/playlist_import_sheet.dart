import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openmusic/app/theme.dart';
import 'package:openmusic/data/music_api.dart';
import 'package:openmusic/features/room/playlist_import_helper.dart';
import 'package:openmusic/features/room/room_widgets.dart';

Future<void> showPlaylistImportSheet(BuildContext context, WidgetRef ref) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: OmTheme.card,
    builder: (ctx) => const _PlaylistImportBody(),
  );
}

class _PlaylistImportBody extends ConsumerStatefulWidget {
  const _PlaylistImportBody();

  @override
  ConsumerState<_PlaylistImportBody> createState() => _PlaylistImportBodyState();
}

class _PlaylistImportBodyState extends ConsumerState<_PlaylistImportBody> {
  final _ctrl = TextEditingController();
  var _loading = false;
  var _platform = 'netease';
  var _progressText = '';
  List<Map<String, dynamic>> _radios = [];

  /// 服务端 playlistImport 仅支持网易 / QQ，不提供酷狗歌单导入。
  static const _platforms = [
    ('netease', '网易'),
    ('tencent', 'QQ'),
  ];

  @override
  void initState() {
    super.initState();
    MusicApi.djRadios().then((r) {
      if (mounted) setState(() => _radios = r.take(20).toList());
    });
  }

  Future<void> _import() async {
    final id = _ctrl.text.trim();
    if (id.isEmpty) return;
    setState(() {
      _loading = true;
      _progressText = '';
    });
    try {
      final platform = normalizePlaylistPlatform(_platform);
      final res = await MusicApi.importPlaylist(platform: platform, playlistId: id);
      final songs = parseImportedSongs(
        res['songs'] ?? res['tracks'],
        platform: platform,
      );
      if (songs.isEmpty) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('这个歌单没有可导入的歌曲')),
          );
        }
        return;
      }
      final added = await importSongsToQueue(
        ref,
        songs,
        onProgress: (attempted, addedCount, total) {
          if (!mounted) return;
          setState(() => _progressText = '正在导入 $attempted/$total，成功 $addedCount 首');
        },
      );
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              songs.length >= maxPlaylistImportSongs
                  ? '已导入 $added 首（最多导入前 $maxPlaylistImportSongs 首）'
                  : '已导入 $added 首',
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
          _progressText = '';
        });
      }
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '导入歌单 / 电台',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color: OmTheme.textPrimary,
                ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            children: [
              for (final p in _platforms)
                OmFilterChip(
                  label: p.$2,
                  selected: _platform == p.$1,
                  onTap: () => setState(() => _platform = p.$1),
                ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _ctrl,
            style: const TextStyle(color: OmTheme.textPrimary),
            decoration: const InputDecoration(
              labelText: '歌单 ID 或链接中的数字 ID',
              labelStyle: TextStyle(color: OmTheme.textSecondary),
            ),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _loading ? null : _import,
            child: Text(_loading ? '导入中…' : '导入到队列'),
          ),
          if (_progressText.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              _progressText,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: OmTheme.textSecondary,
                  ),
            ),
          ],
          if (_radios.isNotEmpty) ...[
            const SizedBox(height: 16),
            Text(
              '推荐电台',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: OmTheme.textPrimary,
                  ),
            ),
            SizedBox(
              height: 120,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                itemCount: _radios.length,
                itemBuilder: (context, i) {
                  final r = _radios[i];
                  final name = '${r['name'] ?? r['title'] ?? '电台'}';
                  return Padding(
                    padding: const EdgeInsets.only(right: 8, top: 8),
                    child: ActionChip(
                      label: Text(
                        name,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: OmTheme.textPrimary),
                      ),
                      backgroundColor: OmTheme.elevated,
                      side: BorderSide.none,
                      onPressed: () {
                        _ctrl.text = '${r['id'] ?? ''}';
                        setState(() => _platform = 'netease');
                      },
                    ),
                  );
                },
              ),
            ),
          ],
        ],
      ),
    );
  }
}
