import 'dart:io';

import 'package:dio/dio.dart';
import 'package:openmusic/core/http_client.dart';

const maxChatImageBytes = 5 * 1024 * 1024;

class ChatImageUploadResult {
  const ChatImageUploadResult({
    required this.url,
    required this.key,
    required this.localPath,
  });

  final String url;
  final String key;
  final String localPath;
}

class ChatMediaApi {
  ChatMediaApi._();

  static Future<bool> fetchChatUploadEnabled() async {
    try {
      await OmHttp.init();
      final res = await OmHttp.get<dynamic>('/api/chat/upload-config');
      final data = res.data is Map ? Map<String, dynamic>.from(res.data as Map) : const <String, dynamic>{};
      return data['enabled'] == true;
    } catch (_) {
      return false;
    }
  }

  static Future<ChatImageUploadResult> uploadChatImage({
    required String roomId,
    required File file,
  }) async {
    final bytes = await file.length();
    if (bytes > maxChatImageBytes) {
      throw StateError('图片不能超过 5MB');
    }
    await OmHttp.init();
    final tokenRes = await OmHttp.post<dynamic>(
      '/api/chat/upload-token',
      data: {
        'roomId': roomId,
        'ext': _detectExt(file.path),
      },
    );
    final tokenData = tokenRes.data is Map
        ? Map<String, dynamic>.from(tokenRes.data as Map)
        : const <String, dynamic>{};
    final uploadUrl = '${tokenData['uploadUrl'] ?? ''}';
    final token = '${tokenData['token'] ?? ''}';
    final key = '${tokenData['key'] ?? ''}';
    final url = '${tokenData['url'] ?? ''}';
    if (uploadUrl.isEmpty || token.isEmpty || key.isEmpty || url.isEmpty) {
      throw StateError('获取上传凭证失败');
    }

    final uploader = Dio();
    final form = FormData.fromMap({
      'file': await MultipartFile.fromFile(file.path),
      'token': token,
      'key': key,
    });
    final uploadRes = await uploader.post<dynamic>(
      uploadUrl,
      data: form,
      options: Options(
        sendTimeout: const Duration(seconds: 30),
        receiveTimeout: const Duration(seconds: 30),
      ),
    );
    if (uploadRes.statusCode == null || uploadRes.statusCode! >= 400) {
      throw StateError('图片上传失败');
    }
    return ChatImageUploadResult(
      url: url,
      key: key,
      localPath: file.path,
    );
  }

  static String _detectExt(String path) {
    final lower = path.toLowerCase();
    if (lower.endsWith('.png')) return 'png';
    if (lower.endsWith('.gif')) return 'gif';
    if (lower.endsWith('.webp')) return 'webp';
    return 'jpg';
  }
}
