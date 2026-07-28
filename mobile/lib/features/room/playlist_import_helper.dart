import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openmusic/data/socket_room_repository.dart';
import 'package:openmusic/domain/models.dart';

const maxPlaylistImportSongs = 100;

typedef PlaylistImportProgress = void Function(int attempted, int added, int total);

String normalizePlaylistPlatform(String platform) {
  final raw = platform.trim().toLowerCase();
  if (raw == 'qq') return 'tencent';
  if (raw.isEmpty) return 'netease';
  return raw;
}

List<Song> parseImportedSongs(
  dynamic songsRaw, {
  required String platform,
  int limit = maxPlaylistImportSongs,
}) {
  if (songsRaw is! List) return const [];
  final normalizedPlatform = normalizePlaylistPlatform(platform);
  final songs = <Song>[];
  final seen = <String>{};
  for (final raw in songsRaw.whereType<Map>()) {
    final song = Song.fromJson({
      ...Map<String, dynamic>.from(raw),
      'source': raw['source'] ?? normalizedPlatform,
    });
    if (song.id.isEmpty) continue;
    if (!seen.add(song.songKey)) continue;
    songs.add(song);
    if (songs.length >= limit) break;
  }
  return songs;
}

Future<int> importSongsToQueue(
  WidgetRef ref,
  List<Song> songs, {
  PlaylistImportProgress? onProgress,
}) async {
  var added = 0;
  for (var i = 0; i < songs.length; i++) {
    final ack = await ref.read(roomSessionProvider.notifier).addSong(songs[i]);
    if (ack['success'] == true) added++;
    onProgress?.call(i + 1, added, songs.length);
    if ((i + 1) % 8 == 0) {
      await Future<void>.delayed(Duration.zero);
    }
  }
  return added;
}

