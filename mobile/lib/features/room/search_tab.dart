import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openmusic/app/theme.dart';
import 'package:openmusic/data/local_cache.dart';
import 'package:openmusic/data/music_api.dart';
import 'package:openmusic/data/socket_room_repository.dart';
import 'package:openmusic/domain/models.dart';
import 'package:openmusic/domain/permissions.dart';
import 'package:openmusic/features/room/playlist_import_helper.dart';
import 'package:openmusic/features/room/playlist_import_sheet.dart';
import 'package:openmusic/features/room/room_widgets.dart';
import 'package:openmusic/widgets/om_dialog.dart';
import 'package:openmusic/widgets/om_ui.dart';

/// Shared room tab index — mini player can jump to「点歌」.
final roomTabIndexProvider = StateProvider<int>((ref) => 0);

class SearchTab extends ConsumerStatefulWidget {
  const SearchTab({super.key});

  @override
  ConsumerState<SearchTab> createState() => _SearchTabState();
}

class _SearchTabState extends ConsumerState<SearchTab> {
  final _ctrl = TextEditingController();
  var _loading = false;
  var _mode = 'song';
  var _filter = 'smart';
  var _playlistChannel = 'all';
  var _importProgressText = '';
  List<String> _searchableSources = const ['netease', 'tencent'];
  List<Song> _results = [];
  List<Song> _hot = [];
  List<Map<String, dynamic>> _hotRadios = [];
  List<Map<String, dynamic>> _playlistResults = [];
  List<Map<String, dynamic>> _radioResults = [];

  @override
  void initState() {
    super.initState();
    _loadHot();
    _loadHotRadios();
    _loadSources();
  }

  Future<void> _loadSources() async {
    final ids = await MusicApi.searchableSourceIds();
    if (!mounted) return;
    setState(() {
      _searchableSources = ids.isEmpty ? const ['netease', 'tencent'] : ids;
      if (_filter != 'smart' && !_searchableSources.contains(_filter)) {
        _filter = 'smart';
      }
    });
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _loadHot() async {
    final hot = await MusicApi.toplistNetease();
    if (mounted) setState(() => _hot = hot.take(30).toList());
  }

  Future<void> _loadHotRadios() async {
    final radios = await MusicApi.djRadios();
    if (mounted) setState(() => _hotRadios = radios.take(20).toList());
  }

  Future<void> _search() async {
    final q = _ctrl.text.trim();
    if (q.isEmpty) return;
    await LocalCache.pushSearchQuery(q);
    setState(() => _loading = true);
    try {
      if (_mode == 'playlist') {
        final list = await MusicApi.searchPlaylists(q);
        final filtered = _playlistChannel == 'all'
            ? list
            : list.where((e) {
                final platform = '${e['platform'] ?? e['source'] ?? ''}'.toLowerCase();
                return _playlistChannel == 'qq'
                    ? platform == 'qq' || platform == 'tencent'
                    : platform == _playlistChannel;
              }).toList();
        if (mounted) setState(() => _playlistResults = filtered);
      } else if (_mode == 'radio') {
        final list = await MusicApi.searchDjRadios(q);
        if (mounted) setState(() => _radioResults = list);
      } else {
        final list = await MusicApi.searchAll(
          q,
          filter: _filter,
          searchableSources: _searchableSources,
        );
        if (mounted) setState(() => _results = list);
      }
    } catch (e) {
      if (mounted) omSnack(context, '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _importPlaylist(Map<String, dynamic> playlist) async {
    final platform = normalizePlaylistPlatform(
      '${playlist['platform'] ?? playlist['source'] ?? 'netease'}',
    );
    final id = '${playlist['id'] ?? playlist['playlistId'] ?? ''}';
    if (id.isEmpty) {
      omSnack(context, '歌单 ID 缺失');
      return;
    }
    setState(() {
      _loading = true;
      _importProgressText = '';
    });
    try {
      final res = await MusicApi.importPlaylist(platform: platform, playlistId: id);
      final songs = parseImportedSongs(
        res['songs'] ?? res['tracks'],
        platform: platform,
      );
      if (songs.isEmpty) {
        if (mounted) omSnack(context, '这个歌单没有可导入的歌曲');
        return;
      }
      final added = await importSongsToQueue(
        ref,
        songs,
        onProgress: (attempted, addedCount, total) {
          if (!mounted) return;
          setState(() {
            _importProgressText = '正在导入 $attempted/$total，成功 $addedCount 首';
          });
        },
      );
      if (!mounted) return;
      final truncated = songs.length >= maxPlaylistImportSongs ? '（最多导入前 $maxPlaylistImportSongs 首）' : '';
      omSnack(context, '已导入 $added 首$truncated');
    } catch (e) {
      if (mounted) omSnack(context, '$e');
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
          _importProgressText = '';
        });
      }
    }
  }

  Future<void> _add(Song song) async {
    final session = ref.read(roomSessionProvider);
    final room = session.room;
    final roles = session.rolesOrNull;
    if (room == null || roles == null) return;
    final block = songRequestBlockReason(room: room, roles: roles);
    if (block != null) {
      omSnack(context, block);
      return;
    }
    final res = await ref.read(roomSessionProvider.notifier).addSong(song);
    if (!mounted) return;
    if (res['success'] == true) {
      omSnack(context, '已点《${song.name}》');
    } else {
      omSnack(context, '${res['error'] ?? '点歌失败'}');
    }
  }

  Future<void> _banSong(Song song) async {
    final session = ref.read(roomSessionProvider);
    final roles = session.rolesOrNull;
    if (roles == null || !canModerate(roles)) return;
    final ok = await OmDialog.confirm(
      context,
      title: '禁播歌曲',
      subtitle: '确定将《${song.name}》加入当前房间禁播列表？',
      confirmLabel: '禁播',
      content: Text(
        '${song.artist} · ${_sourceLabel(song.source)}',
        style: const TextStyle(color: OmTheme.textHint),
      ),
    );
    if (ok != true) return;
    final res = await ref.read(roomSessionProvider.notifier).banRoomSong(song);
    if (!mounted) return;
    omSnack(
      context,
      res['success'] == true ? '已加入禁播' : '${res['error'] ?? '操作失败'}',
    );
  }

  Future<void> _loadRadioPrograms(Map<String, dynamic> radio) async {
    final id = '${radio['id'] ?? ''}'.trim();
    if (id.isEmpty) {
      omSnack(context, '电台 ID 缺失');
      return;
    }
    setState(() => _loading = true);
    try {
      final result = await MusicApi.fetchDjPrograms(id);
      if (!mounted) return;
      setState(() {
        _results = result.songs;
        _mode = 'song';
      });
      omSnack(
        context,
        result.songs.isEmpty ? '电台暂无可用节目' : '已加载 ${result.songs.length} 期节目',
      );
    } catch (e) {
      if (mounted) omSnack(context, '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = _results.isEmpty && _ctrl.text.isEmpty ? _hot : _results;
    final isHot = _mode == 'song' && _results.isEmpty && _ctrl.text.isEmpty;
    final session = ref.watch(roomSessionProvider);
    final roles = session.rolesOrNull;
    final canManage = roles != null && canModerate(roles);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Row(
            children: [
              for (final item in const [('song', '歌曲'), ('playlist', '歌单'), ('radio', '电台')])
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(right: item.$1 == 'radio' ? 0 : 8),
                    child: GestureDetector(
                      onTap: () => setState(() {
                        _mode = item.$1;
                        _results = [];
                        _playlistResults = [];
                        _radioResults = [];
                      }),
                      child: Container(
                        height: 36,
                        decoration: BoxDecoration(
                          color: _mode == item.$1 ? OmTheme.red : OmTheme.elevated,
                          borderRadius: BorderRadius.circular(18),
                        ),
                        alignment: Alignment.center,
                        child: Text(
                          item.$2,
                          style: TextStyle(
                            color: _mode == item.$1 ? Colors.white : OmTheme.textSecondary,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Row(
            children: [
              Expanded(
                child: Container(
                  height: 40,
                  decoration: BoxDecoration(
                    color: OmTheme.elevated,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    children: [
                      const SizedBox(width: 14),
                      const Icon(Icons.search, size: 18, color: OmTheme.textHint),
                      Expanded(
                        child: TextField(
                          controller: _ctrl,
                          style: const TextStyle(color: OmTheme.textPrimary, fontSize: 14),
                          decoration: InputDecoration(
                            hintText: _mode == 'playlist'
                                ? '搜索网易/QQ歌单'
                                : _mode == 'radio'
                                    ? '搜索网易电台'
                                    : '搜索歌曲、歌手',
                            hintStyle: const TextStyle(color: OmTheme.textHint, fontSize: 14),
                            border: InputBorder.none,
                            enabledBorder: InputBorder.none,
                            focusedBorder: InputBorder.none,
                            filled: false,
                            contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                            isDense: true,
                          ),
                          onSubmitted: (_) => _search(),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 10),
              SizedBox(
                height: 40,
                child: FilledButton(
                  onPressed: _loading ? null : _search,
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 18),
                    minimumSize: Size.zero,
                  ),
                  child: _loading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Text('搜索'),
                ),
              ),
            ],
          ),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: Row(
            children: [
              if (_mode == 'song')
                for (final f in [
                  ('smart', '智能去重'),
                  ('netease', '网易'),
                  ('tencent', 'QQ'),
                  if (_searchableSources.contains('kugou')) ('kugou', '酷狗'),
                ])
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: OmFilterChip(
                      label: f.$2,
                      selected: _filter == f.$1,
                      onTap: () {
                        setState(() => _filter = f.$1);
                        if (_ctrl.text.trim().isNotEmpty) _search();
                      },
                    ),
                  ),
              if (_mode == 'playlist')
                for (final f in const [
                  ('all', '全部'),
                  ('netease', '网易'),
                  ('qq', 'QQ'),
                ])
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: OmFilterChip(
                      label: f.$2,
                      selected: _playlistChannel == f.$1,
                      onTap: () => setState(() => _playlistChannel = f.$1),
                    ),
                  ),
              OmFilterChip(
                label: '导入歌单',
                selected: false,
                onTap: () => showPlaylistImportSheet(context, ref),
              ),
            ],
          ),
        ),
        if (isHot && _hot.isNotEmpty) const OmSectionHeader('热门推荐'),
        Expanded(
          child: _mode == 'playlist'
              ? _PlaylistResultsList(
                  items: _playlistResults,
                  loading: _loading,
                  onImport: _importPlaylist,
                )
              : _mode == 'radio'
                  ? _RadioResultsList(
                      items: _radioResults.isEmpty && _ctrl.text.trim().isEmpty
                          ? _hotRadios
                          : _radioResults,
                      loading: _loading,
                      onSelect: _loadRadioPrograms,
                    )
                  : list.isEmpty
                      ? const OmEmptyState(
                          icon: Icons.search_rounded,
                          title: '搜索你想听的',
                          subtitle: '支持智能去重与多平台筛选',
                        )
                      : ListView.builder(
                          physics: const BouncingScrollPhysics(),
                          itemCount: list.length,
                          itemBuilder: (context, i) {
                            final s = list[i];
                            return OmSongRow(
                              title: s.name,
                              subtitle: '${s.artist} · ${_sourceLabel(s.source)}',
                              coverUrl: MusicApi.songCoverUrl(s),
                              showDivider: i < list.length - 1,
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  if (canManage)
                                    IconButton(
                                      icon: const Icon(
                                        Icons.block_outlined,
                                        color: OmTheme.textHint,
                                        size: 22,
                                      ),
                                      tooltip: '加入禁播',
                                      onPressed: () => _banSong(s),
                                    ),
                                  IconButton(
                                    icon: const Icon(
                                      Icons.add_circle_outline,
                                      color: OmTheme.red,
                                      size: 26,
                                    ),
                                    onPressed: () => _add(s),
                                  ),
                                ],
                              ),
                              onTap: () => _add(s),
                            );
                          },
                        ),
        ),
        if (_importProgressText.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
            child: Text(
              _importProgressText,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12, color: OmTheme.textHint),
            ),
          ),
      ],
    );
  }
}

String _sourceLabel(String source) => switch (source) {
      'netease' => '网易',
      'tencent' || 'qq' => 'QQ',
      'kugou' => '酷狗',
      _ => source,
    };

/// Opens play-history sheet (used by mini player + search tab).
Future<void> showSongHistorySheet(
  BuildContext context,
  WidgetRef ref, {
  Future<void> Function(Song song)? onPick,
}) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (sheetCtx) {
      return _SongHistorySheet(
        onPick: (song) async {
          Navigator.of(sheetCtx).pop();
          if (onPick != null) {
            await onPick(song);
            return;
          }
          final session = ref.read(roomSessionProvider);
          final room = session.room;
          final roles = session.rolesOrNull;
          if (room == null || roles == null) return;
          final block = songRequestBlockReason(room: room, roles: roles);
          if (block != null) {
            if (context.mounted) omSnack(context, block);
            return;
          }
          final res = await ref.read(roomSessionProvider.notifier).addSong(song);
          if (!context.mounted) return;
          omSnack(
            context,
            res['success'] == true
                ? '已点《${song.name}》'
                : '${res['error'] ?? '点歌失败'}',
          );
        },
      );
    },
  );
}

class _PlaylistResultsList extends StatelessWidget {
  const _PlaylistResultsList({
    required this.items,
    required this.loading,
    required this.onImport,
  });

  final List<Map<String, dynamic>> items;
  final bool loading;
  final Future<void> Function(Map<String, dynamic>) onImport;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const OmEmptyState(
        icon: Icons.queue_music_rounded,
        title: '搜索歌单',
        subtitle: '支持网易和QQ歌单导入',
      );
    }
    return ListView.builder(
      physics: const BouncingScrollPhysics(),
      itemCount: items.length,
      itemBuilder: (context, i) {
        final item = items[i];
        final platformRaw = '${item['platform'] ?? item['source'] ?? 'netease'}'.toLowerCase();
        final platform = platformRaw == 'qq' ? 'tencent' : platformRaw;
        final title = '${item['name'] ?? item['title'] ?? '未命名歌单'}';
        final creator = '${item['creatorName'] ?? item['creator'] ?? item['author'] ?? ''}';
        final count = item['trackCount'] ?? item['songCount'] ?? item['count'];
        final subtitle = [
          switch (platform) {
            'netease' => '网易',
            'tencent' => 'QQ',
            _ => platform,
          },
          if (creator.isNotEmpty) creator,
          if (count != null) '$count 首',
        ].join(' · ');
        return OmSongRow(
          title: title,
          subtitle: subtitle,
          coverUrl: item['pic'] as String? ?? item['cover'] as String? ?? item['coverImgUrl'] as String?,
          showDivider: i < items.length - 1,
          trailing: IconButton(
            icon: const Icon(Icons.playlist_add_rounded, color: OmTheme.red, size: 24),
            onPressed: loading ? null : () => onImport(item),
          ),
          onTap: loading ? null : () => onImport(item),
        );
      },
    );
  }
}

class _RadioResultsList extends StatelessWidget {
  const _RadioResultsList({
    required this.items,
    required this.loading,
    required this.onSelect,
  });

  final List<Map<String, dynamic>> items;
  final bool loading;
  final Future<void> Function(Map<String, dynamic>) onSelect;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const OmEmptyState(
        icon: Icons.radio_rounded,
        title: '搜索电台',
        subtitle: '加载节目后可从节目列表点歌',
      );
    }
    return ListView.builder(
      physics: const BouncingScrollPhysics(),
      itemCount: items.length,
      itemBuilder: (context, i) {
        final item = items[i];
        final title = '${item['name'] ?? item['title'] ?? '未命名电台'}';
        final creator = '${item['creatorName'] ?? item['author'] ?? item['artist'] ?? ''}';
        final count = item['trackCount'] ?? item['programCount'] ?? item['song_count'];
        final subtitle = [
          '网易电台',
          if (creator.isNotEmpty) creator,
          if (count != null) '$count 期',
        ].join(' · ');
        return OmSongRow(
          title: title,
          subtitle: subtitle,
          coverUrl: item['coverImgUrl'] as String? ?? item['pic'] as String? ?? item['cover'] as String?,
          showDivider: i < items.length - 1,
          trailing: IconButton(
            icon: const Icon(Icons.radio_rounded, color: OmTheme.red, size: 24),
            onPressed: loading ? null : () => onSelect(item),
          ),
          onTap: loading ? null : () => onSelect(item),
        );
      },
    );
  }
}

class _SongHistorySheet extends ConsumerStatefulWidget {
  const _SongHistorySheet({required this.onPick});

  final Future<void> Function(Song song) onPick;

  @override
  ConsumerState<_SongHistorySheet> createState() => _SongHistorySheetState();
}

class _SongHistorySheetState extends ConsumerState<_SongHistorySheet> {
  var _loading = true;
  String? _error;
  List<Song> _songs = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final songs = await ref.read(roomSessionProvider.notifier).loadSongHistory();
      if (!mounted) return;
      setState(() {
        _songs = songs;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.65,
        ),
        decoration: BoxDecoration(
          color: OmTheme.card,
          borderRadius: BorderRadius.circular(16),
        ),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: MediaQuery.of(context).size.height * 0.55,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: Container(
                      width: 36,
                      height: 4,
                      margin: const EdgeInsets.only(bottom: 16),
                      decoration: BoxDecoration(
                        color: OmTheme.divider,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const Text(
                    '播放历史',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                      color: OmTheme.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    '点选即可重新点歌',
                    style: TextStyle(fontSize: 13, color: OmTheme.textSecondary),
                  ),
                  const SizedBox(height: 12),
                  Expanded(
                    child: _loading
                        ? const Center(
                            child: SizedBox(
                              width: 24,
                              height: 24,
                              child: CircularProgressIndicator(strokeWidth: 2, color: OmTheme.red),
                            ),
                          )
                        : _error != null
                            ? Center(
                                child: Text(_error!, style: const TextStyle(color: OmTheme.textHint)),
                              )
                            : _songs.isEmpty
                                ? const Center(
                                    child: Text(
                                      '还没有播放过歌曲',
                                      style: TextStyle(color: OmTheme.textHint),
                                    ),
                                  )
                                : ListView.separated(
                                    itemCount: _songs.length,
                                    separatorBuilder: (_, __) =>
                                        const Divider(height: 1, color: OmTheme.divider),
                                    itemBuilder: (ctx, i) {
                                      final s = _songs[i];
                                      return ListTile(
                                        contentPadding: EdgeInsets.zero,
                                        title: Text(
                                          s.name,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            color: OmTheme.textPrimary,
                                            fontSize: 14,
                                          ),
                                        ),
                                        subtitle: Text(
                                          '${s.artist} · ${_historySourceLabel(s.source)}',
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            color: OmTheme.textHint,
                                            fontSize: 12,
                                          ),
                                        ),
                                        trailing: const Icon(
                                          Icons.add_circle_outline,
                                          color: OmTheme.red,
                                        ),
                                        onTap: () => widget.onPick(s),
                                      );
                                    },
                                  ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

String _historySourceLabel(String source) => switch (source) {
      'netease' => '网易',
      'tencent' || 'qq' => 'QQ',
      'kugou' => '酷狗',
      _ => source,
    };
