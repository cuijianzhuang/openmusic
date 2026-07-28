import 'package:openmusic/core/http_client.dart';

class StickerSearchResult {
  const StickerSearchResult({
    required this.images,
    required this.page,
    required this.maxPage,
    required this.count,
  });

  final List<String> images;
  final int page;
  final int maxPage;
  final int count;
}

class StickerApi {
  StickerApi._();

  static Future<bool> fetchStickerSearchEnabled() async {
    try {
      await OmHttp.init();
      final res = await OmHttp.get<dynamic>('/api/chat/sticker-search-config');
      final data = res.data is Map ? Map<String, dynamic>.from(res.data as Map) : const <String, dynamic>{};
      return data['enabled'] == true;
    } catch (_) {
      return false;
    }
  }

  static Future<StickerSearchResult> search(String words, {int page = 1}) async {
    await OmHttp.init();
    final res = await OmHttp.get<dynamic>(
      '/api/chat/sticker-search',
      query: {
        'words': words.trim(),
        'page': page,
        'limit': 15,
      },
    );
    final data = res.data is Map ? Map<String, dynamic>.from(res.data as Map) : const <String, dynamic>{};
    return StickerSearchResult(
      images: (data['images'] as List?)?.map((e) => '$e').where((e) => e.isNotEmpty).toList() ??
          const <String>[],
      page: (data['page'] as num?)?.toInt() ?? page,
      maxPage: (data['maxPage'] as num?)?.toInt() ?? 1,
      count: (data['count'] as num?)?.toInt() ?? 0,
    );
  }
}
