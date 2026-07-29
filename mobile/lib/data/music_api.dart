import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:openmusic/core/http_client.dart';
import 'package:openmusic/core/session.dart';
import 'package:openmusic/data/user_audio_quality.dart';
import 'package:openmusic/domain/models.dart';

class MusicSourceMeta {
  const MusicSourceMeta({
    required this.id,
    required this.name,
    required this.supportsSearch,
  });

  final String id;
  final String name;
  final bool supportsSearch;

  factory MusicSourceMeta.fromJson(Map<String, dynamic> j) => MusicSourceMeta(
        id: '${j['id'] ?? ''}',
        name: '${j['name'] ?? j['shortName'] ?? j['id'] ?? ''}',
        supportsSearch: j['supportsSearch'] == true,
      );
}

class MusicApi {
  static String _extractIdFromApiUrl(String url) {
    try {
      final match = RegExp(r'[?&]id=([^&]+)', caseSensitive: false).firstMatch(url);
      return match == null ? '' : Uri.decodeQueryComponent(match.group(1) ?? '');
    } catch (_) {
      return '';
    }
  }

  static Future<List<Song>> searchAll(
    String keyword, {
    String filter = 'smart',
    List<String>? searchableSources,
  }) async {
    if (keyword.trim().isEmpty) return [];
    await SessionBootstrap.require();
    final sources = filter == 'smart'
        ? (searchableSources ?? await searchableSourceIds())
        : [filter];

    if (sources.isEmpty) return [];

    if (filter != 'smart') {
      return _searchSource(sources.first, keyword);
    }

    final results = await Future.wait(
      sources.map(
        (s) => _searchSource(s, keyword).catchError((Object e, StackTrace st) {
          debugPrint('search $s failed: $e\n$st');
          return <Song>[];
        }),
      ),
    );
    return _interleave(results);
  }

  /// Platforms that currently support search (`/api/music/sources`).
  static Future<List<String>> searchableSourceIds() async {
    final sources = await getAvailableSources();
    // Only expose platforms the server marked searchable (蓝点 absent unless configured).
    return sources
        .where((s) => s.supportsSearch)
        .map((s) => s.id)
        .where((id) => id == 'netease' || id == 'tencent' || id == 'kugou')
        .toList(growable: false);
  }

  static Future<List<MusicSourceMeta>> getAvailableSources() async {
    try {
      await SessionBootstrap.require();
      final res = await OmHttp.get<dynamic>('/api/music/sources');
      final data = res.data;
      if (data is! List) return _fallbackSources;
      final parsed = data
          .whereType<Map>()
          .map((e) => MusicSourceMeta.fromJson(Map<String, dynamic>.from(e)))
          .where((s) => s.id.isNotEmpty)
          .toList();
      return parsed.isEmpty ? _fallbackSources : parsed;
    } catch (_) {
      return _fallbackSources;
    }
  }

  static const _fallbackSources = [
    MusicSourceMeta(id: 'netease', name: '红点', supportsSearch: true),
    MusicSourceMeta(id: 'tencent', name: '绿点', supportsSearch: true),
  ];

  /// Cover URL aligned with web `getCoverUrl` / meting `type=pic` fallback.
  static String? songCoverUrl(Song song) {
    final pic = _nonEmpty(song.pic);
    if (pic != null) return _localizeMetingPic(pic) ?? pic;
    if (song.id.isEmpty) return null;
    final server = song.source == 'tencent' || song.source == 'qq'
        ? 'tencent'
        : song.source == 'kugou'
            ? null
            : 'netease';
    if (server == null) return null;
    return '/api/meting?server=$server&type=pic&id=${Uri.encodeQueryComponent(song.id)}';
  }

  static Future<List<Song>> _searchSource(String source, String keyword) async {
    // Align with web providers: kugou uses `q`, meting uses type=search.
    if (source == 'kugou') {
      try {
        final res = await OmHttp.get<dynamic>(
          '/api/music/cyapi/kugou/search',
          query: {'q': keyword.trim(), 'num': '30'},
        );
        _throwIfApiError(res);
        final list = _parseSearchList(res.data, source);
        if (list.isNotEmpty) return list;
      } catch (e) {
        debugPrint('kugou cyapi search failed, try meting: $e');
      }
      // Fallback: some deployments expose kugou via meting/custom upstream.
      final res = await OmHttp.get<dynamic>(
        '/api/meting',
        query: {
          'server': 'kugou',
          'type': 'search',
          'id': keyword.trim(),
        },
      );
      _throwIfApiError(res);
      return _parseSearchList(res.data, source);
    }
    final res = await OmHttp.get<dynamic>(
      '/api/meting',
      query: {
        'server': source == 'tencent' ? 'tencent' : 'netease',
        'type': 'search',
        'id': keyword.trim(),
      },
    );
    _throwIfApiError(res);
    return _parseSearchList(res.data, source);
  }

  static void _throwIfApiError(Response<dynamic> res) {
    final data = res.data;
    if (data is Map && data['error'] != null) {
      final err = '${data['error']}'.trim();
      if (err.isNotEmpty) throw StateError(err);
    }
    final code = res.statusCode ?? 0;
    if (code >= 400) {
      throw StateError('搜索失败 ($code)');
    }
  }

  static List<Song> _parseSearchList(dynamic data, String source) {
    final list = _extractSongList(data);
    final out = <Song>[];
    for (final raw in list) {
      if (raw is! Map) continue;
      try {
        final j = Map<String, dynamic>.from(raw);
        final url = _nonEmpty(_asString(j['url']));
        final id = _nonEmpty(
              _asString(j['id']) ??
                  _asString(j['songmid']) ??
                  _asString(j['song_id']) ??
                  _asString(j['hash']) ??
                  _asString(j['FileHash']),
            ) ??
            _idFromUrl(url);
        final name = _nonEmpty(
          _asString(j['name']) ??
              _asString(j['title']) ??
              _asString(j['songname']) ??
              _asString(j['SongName']),
        );
        if (id == null || name == null) continue;
        out.add(
          Song(
            id: id,
            source: source,
            name: name,
            artist: _artist(j),
            album: _nonEmpty(
              _asString(j['album']) ??
                  _asString(j['albumname']) ??
                  _asString(j['album_name']) ??
                  _asString(j['AlbumName']),
            ),
            pic: _pickPic(j),
            duration: _durationSec(j),
            url: url,
            lrc: _nonEmpty(_asString(j['lrc'])),
          ),
        );
      } catch (e) {
        debugPrint('skip bad search row ($source): $e');
      }
    }
    return out;
  }

  static List<dynamic> _extractSongList(dynamic data) {
    if (data is List) return data;
    if (data is! Map) return const [];
    final map = data;
    for (final key in ['list', 'songs', 'data', 'result']) {
      final v = map[key];
      if (v is List) return v;
      if (v is Map && v['songs'] is List) return v['songs'] as List;
    }
    if (map['result'] is Map && (map['result'] as Map)['songs'] is List) {
      return (map['result'] as Map)['songs'] as List;
    }
    return const [];
  }

  static String? _pickPic(Map<String, dynamic> j) {
    final direct = _nonEmpty(
      _asString(j['pic']) ??
          _asString(j['cover']) ??
          _asString(j['Image']) ??
          _asString(j['album_pic']) ??
          _asString(j['albumImage']) ??
          _asString(j['img']),
    );
    if (direct != null) return direct;
    final al = j['al'];
    if (al is Map) {
      return _nonEmpty(_asString(al['picUrl']) ?? _asString(al['pic_url']));
    }
    return null;
  }

  static String? _asString(dynamic v) {
    if (v == null) return null;
    if (v is String) return v;
    if (v is num || v is bool) return '$v';
    return null;
  }

  static String? _nonEmpty(String? s) {
    if (s == null) return null;
    final t = s.trim();
    return t.isEmpty ? null : t;
  }

  static String? _idFromUrl(String? url) {
    if (url == null) return null;
    final uri = Uri.tryParse(url);
    if (uri == null) return null;
    final id = uri.queryParameters['id'];
    return _nonEmpty(id);
  }

  static String? _localizeMetingPic(String url) {
    final uri = Uri.tryParse(url.startsWith('/') ? 'http://local$url' : url);
    if (uri == null) return null;
    if (uri.queryParameters['type'] != 'pic') return null;
    final server = uri.queryParameters['server'];
    final id = uri.queryParameters['id'];
    if (server == null || id == null || id.isEmpty) return null;
    if (server != 'netease' && server != 'tencent') return null;
    return '/api/meting?server=$server&type=pic&id=${Uri.encodeQueryComponent(id)}';
  }

  static double? _durationSec(Map<String, dynamic> j) {
    final d = j['duration'] ?? j['Duration'] ?? j['dt'] ?? j['timeLength'];
    if (d is! num) return null;
    final v = d.toDouble();
    // Netease often sends ms in `dt`; kugou Duration is seconds.
    if (j.containsKey('dt') || j.containsKey('timeLength') || v > 10000) {
      return v / 1000.0;
    }
    return v;
  }

  static String _artist(Map<String, dynamic> j) {
    // Meting / QQ often uses `author`; kugou uses SingerName.
    final a = j['artist'] ??
        j['author'] ??
        j['ar'] ??
        j['singer'] ??
        j['SingerName'] ??
        j['artists'];
    if (a is String) {
      final t = a.trim();
      return t.isEmpty ? '未知歌手' : t;
    }
    if (a is List) {
      final joined = a.map((e) {
        if (e is Map) {
          return '${e['name'] ?? e['title'] ?? e['singer_name'] ?? ''}'.trim();
        }
        return '$e'.trim();
      }).where((s) => s.isNotEmpty).join(' / ');
      return joined.isEmpty ? '未知歌手' : joined;
    }
    return '未知歌手';
  }

  static List<Song> _interleave(List<List<Song>> groups) {
    final out = <Song>[];
    final seen = <String>{};
    var i = 0;
    var added = true;
    while (added) {
      added = false;
      for (final g in groups) {
        if (i < g.length) {
          final s = g[i];
          if (seen.add(s.songKey)) out.add(s);
          added = true;
        }
      }
      i++;
    }
    return out;
  }

  static Future<({String url, String? qualityLabel})> getSongUrl(
    Song song, {
    String? quality,
  }) async {
    await SessionBootstrap.require();
    if (song.url != null && song.url!.startsWith('http')) {
      return (url: song.url!, qualityLabel: null);
    }
    final source = song.source;
    var resolvedQuality = quality ?? await UserAudioQualityStore.resolve(null).then(
      (q) => source == 'tencent' ? q.tencent : source == 'netease' ? q.netease : null,
    );
    // Web HTML audio + just_audio demuxer is more reliable with lossy streams.
    if (kIsWeb && source == 'netease' &&
        (resolvedQuality == null ||
            resolvedQuality == 'jyeffect' ||
            resolvedQuality == 'sky' ||
            resolvedQuality == 'jymaster' ||
            resolvedQuality == 'hires' ||
            resolvedQuality == 'lossless' ||
            resolvedQuality == 'exhigh')) {
      resolvedQuality = 'standard';
    }
    if (kIsWeb && source == 'tencent' &&
        (resolvedQuality == null ||
            resolvedQuality == 'hires' ||
            resolvedQuality == 'flac' ||
            resolvedQuality == 'atmos' ||
            resolvedQuality == 'master')) {
      resolvedQuality = '128';
    }
    if (source == 'kugou') {
      final res = await OmHttp.get<Map<String, dynamic>>(
        '/api/music/cyapi/kugou/url',
        query: {'hash': song.id, if (resolvedQuality != null) 'quality': resolvedQuality},
      );
      final url = '${res.data?['url'] ?? ''}';
      if (url.isEmpty) throw StateError('无法获取播放地址');
      return (url: url, qualityLabel: res.data?['quality'] as String?);
    }
    final res = await OmHttp.get<dynamic>(
      '/api/meting',
      query: {
        'server': source == 'tencent' ? 'tencent' : 'netease',
        'type': 'url',
        'id': song.id,
        if (resolvedQuality != null) 'quality': resolvedQuality,
      },
    );
    final data = res.data;
    String url = '';
    String? label;
    if (data is Map) {
      url = '${data['url'] ?? ''}';
      label = data['quality'] as String? ?? data['br']?.toString();
    } else if (data is String) {
      url = data;
    }
    if (url.isEmpty) throw StateError('无法获取播放地址');
    return (url: url, qualityLabel: label);
  }

  static Future<String?> getLyrics(Song song) async {
    try {
      await SessionBootstrap.require();
      if (song.lrc != null && song.lrc!.contains('[')) return song.lrc;
      final source = song.source;
      if (source == 'kugou') {
        final res = await OmHttp.get<Map<String, dynamic>>(
          '/api/music/cyapi/kugou/lyric',
          query: {'hash': song.id},
        );
        return res.data?['lrc'] as String? ?? res.data?['lyric'] as String?;
      }
      final res = await OmHttp.get<dynamic>(
        '/api/meting',
        query: {
          'server': source == 'tencent' ? 'tencent' : 'netease',
          'type': 'lrc',
          'id': song.id,
        },
      );
      final data = res.data;
      if (data is Map) return data['lrc'] as String? ?? data['lyric'] as String?;
      if (data is String) return data;
      return null;
    } catch (_) {
      return null;
    }
  }

  static Future<Map<String, dynamic>> importPlaylist({
    required String platform,
    required String playlistId,
  }) async {
    await SessionBootstrap.require();
    final res = await OmHttp.post<Map<String, dynamic>>(
      '/api/music/playlist/import',
      data: {'platform': platform, 'id': playlistId},
    );
    return res.data ?? {};
  }

  static Future<List<Map<String, dynamic>>> searchPlaylists(String keyword) async {
    await SessionBootstrap.require();
    final res = await OmHttp.get<Map<String, dynamic>>(
      '/api/music/playlist/search',
      query: {'keyword': keyword},
    );
    final list = res.data?['playlists'] ?? res.data?['data'];
    if (list is! List) return [];
    return list.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  static Future<List<Map<String, dynamic>>> djRadios() async {
    try {
      await SessionBootstrap.require();
      final res = await OmHttp.get<dynamic>(
        '/api/meting',
        query: {'server': 'netease', 'type': 'djradio', 'id': 'recommend'},
      );
      final data = res.data;
      if (data is List) {
        return data.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
      }
      if (data is Map && data['djRadios'] is List) {
        return (data['djRadios'] as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  static Future<List<Map<String, dynamic>>> searchDjRadios(String keyword) async {
    final trimmed = keyword.trim();
    if (trimmed.isEmpty) return const [];
    await SessionBootstrap.require();
    final res = await OmHttp.get<dynamic>(
      '/api/meting',
      query: {'server': 'netease', 'type': 'search_dj', 'id': trimmed},
    );
    final data = res.data;
    final list = data is List ? data : const [];
    return list.whereType<Map>().map((e) {
      final map = Map<String, dynamic>.from(e);
      final url = '${map['url'] ?? ''}';
      final id = '${map['id'] ?? _extractIdFromApiUrl(url)}'.trim();
      return {
        ...map,
        'id': id,
      };
    }).where((e) => '${e['id']}'.trim().isNotEmpty).toList();
  }

  static Future<({String name, List<Song> songs})> fetchDjPrograms(String radioId) async {
    final id = radioId.trim();
    if (id.isEmpty) throw StateError('缺少电台 ID');
    await SessionBootstrap.require();
    final results = await Future.wait([
      OmHttp.get<dynamic>(
        '/api/meting',
        query: {'server': 'netease', 'type': 'dj', 'id': id},
      ),
      OmHttp.get<dynamic>(
        '/api/meting',
        query: {'server': 'netease', 'type': 'dj_detail', 'id': id},
      ).catchError((_) => null),
    ]);
    final programs = results[0]?.data;
    final detail = results[1]?.data;
    final songs = <Song>[];
    if (programs is List) {
      for (final raw in programs.whereType<Map>()) {
        final map = Map<String, dynamic>.from(raw);
        final songId = _extractIdFromApiUrl('${map['url'] ?? ''}');
        if (songId.isEmpty) continue;
        songs.add(
          Song(
            id: songId,
            source: 'netease',
            name: '${map['title'] ?? map['name'] ?? '未知节目'}',
            artist: '${map['author'] ?? map['artist'] ?? '未知主播'}',
            pic: _pickPic(map),
          ),
        );
      }
    }
    var radioName = '';
    if (detail is List && detail.isNotEmpty && detail.first is Map) {
      final map = Map<String, dynamic>.from(detail.first as Map);
      radioName = '${map['title'] ?? map['name'] ?? ''}'.trim();
    }
    return (name: radioName.isEmpty ? '电台 $id' : radioName, songs: songs);
  }

  static Future<List<Song>> toplistNetease() async {
    try {
      await SessionBootstrap.require();
      final res = await OmHttp.get<dynamic>('/api/music/toplist/netease');
      return _parseSearchList(res.data, 'netease');
    } catch (_) {
      return [];
    }
  }
}
