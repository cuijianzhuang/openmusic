import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _stickerManifestKey = 'openmusic.user_stickers.v1';
const maxStickerBytes = 5 * 1024 * 1024;

class UserSticker {
  const UserSticker({
    required this.id,
    required this.name,
    required this.path,
    required this.mimeType,
    required this.importedAt,
  });

  final String id;
  final String name;
  final String path;
  final String mimeType;
  final int importedAt;

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'path': path,
        'mimeType': mimeType,
        'importedAt': importedAt,
      };

  factory UserSticker.fromJson(Map<String, dynamic> json) => UserSticker(
        id: '${json['id'] ?? ''}',
        name: '${json['name'] ?? ''}',
        path: '${json['path'] ?? ''}',
        mimeType: '${json['mimeType'] ?? 'image/gif'}',
        importedAt: (json['importedAt'] as num?)?.toInt() ?? 0,
      );
}

class UserStickerImportResult {
  const UserStickerImportResult({required this.imported, required this.skipped});

  final int imported;
  final int skipped;
}

class UserStickerStore {
  UserStickerStore._();

  static Future<List<UserSticker>> list() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_stickerManifestKey);
    if (raw == null || raw.isEmpty) return const [];
    try {
      final list = (jsonDecode(raw) as List)
          .whereType<Map>()
          .map((e) => UserSticker.fromJson(Map<String, dynamic>.from(e)))
          .toList()
        ..sort((a, b) => b.importedAt.compareTo(a.importedAt));
      return list;
    } catch (_) {
      return const [];
    }
  }

  static Future<UserStickerImportResult> importFromChatImage(
    String imageUrl, {
    String? imageKey,
  }) async {
    final stickers = await list();
    final id = _stickerId(imageUrl, imageKey);
    if (stickers.any((sticker) => sticker.id == id)) {
      return const UserStickerImportResult(imported: 0, skipped: 1);
    }
    final response = await Dio().get<List<int>>(
      imageUrl,
      options: Options(responseType: ResponseType.bytes),
    );
    final bytes = response.data ?? const <int>[];
    if (bytes.isEmpty) {
      throw StateError('表情包下载失败');
    }
    if (bytes.length > maxStickerBytes) {
      throw StateError('表情包超过 5MB，无法保存');
    }
    final mime = '${response.headers.value('content-type') ?? 'image/gif'}'.split(';').first;
    final dir = await _stickerDir();
    final ext = _extForMime(mime);
    final file = File('${dir.path}/$id.$ext');
    await file.writeAsBytes(bytes, flush: true);
    final next = [
      UserSticker(
        id: id,
        name: '表情 ${stickers.length + 1}',
        path: file.path,
        mimeType: mime,
        importedAt: DateTime.now().millisecondsSinceEpoch,
      ),
      ...stickers,
    ];
    await _save(next);
    return const UserStickerImportResult(imported: 1, skipped: 0);
  }

  static Future<String?> buildDataUrl(String stickerId) async {
    final sticker = (await list()).where((item) => item.id == stickerId).firstOrNull;
    if (sticker == null) return null;
    final file = File(sticker.path);
    if (!await file.exists()) return null;
    final bytes = await file.readAsBytes();
    if (bytes.length > maxStickerBytes) return null;
    return 'data:${sticker.mimeType};base64,${base64Encode(bytes)}';
  }

  static String localStickerImageKey(String stickerId) => 'local-sticker:$stickerId';

  static Future<void> delete(String stickerId) async {
    final stickers = await list();
    final target = stickers.where((item) => item.id == stickerId).firstOrNull;
    if (target == null) return;
    final file = File(target.path);
    if (await file.exists()) {
      await file.delete();
    }
    final next = stickers.where((item) => item.id != stickerId).toList();
    await _save(next);
  }

  static Future<void> _save(List<UserSticker> stickers) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _stickerManifestKey,
      jsonEncode(stickers.map((s) => s.toJson()).toList()),
    );
  }

  static Future<Directory> _stickerDir() async {
    final dir = await getApplicationSupportDirectory();
    final stickers = Directory('${dir.path}/stickers');
    if (!await stickers.exists()) {
      await stickers.create(recursive: true);
    }
    return stickers;
  }

  static String _stickerId(String imageUrl, String? imageKey) {
    final raw = (imageKey?.trim().isNotEmpty == true ? imageKey!.trim() : imageUrl)
        .replaceAll(RegExp(r'[^A-Za-z0-9_\-]'), '_');
    return raw.length > 80 ? raw.substring(0, 80) : raw;
  }

  static String _extForMime(String mime) {
    switch (mime) {
      case 'image/png':
        return 'png';
      case 'image/jpeg':
      case 'image/jpg':
        return 'jpg';
      case 'image/webp':
        return 'webp';
      default:
        return 'gif';
    }
  }
}

extension<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
