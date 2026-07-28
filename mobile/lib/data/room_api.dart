import 'package:dio/dio.dart';
import 'package:openmusic/core/http_client.dart';
import 'package:openmusic/core/session.dart';
import 'package:openmusic/domain/models.dart';

class RoomApi {
  static Future<List<RoomSummary>> listRooms() async {
    await SessionBootstrap.ensure();
    final res = await OmHttp.get<dynamic>('/api/rooms');
    final data = res.data;
    final list = data is List
        ? data
        : (data is Map ? (data['rooms'] as List? ?? const []) : const []);
    return list
        .whereType<Map>()
        .map((e) => RoomSummary.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  static Future<RoomSummary> createRoom(String name, {String? password}) async {
    for (var attempt = 0; attempt < 2; attempt++) {
      await SessionBootstrap.require(force: attempt > 0);
      final payload = <String, dynamic>{};
      if (name.trim().isNotEmpty) payload['name'] = name.trim();
      if (password != null && password.trim().isNotEmpty) {
        payload['password'] = password.trim();
      }
      try {
        final res = await OmHttp.post<Map<String, dynamic>>(
          '/api/rooms',
          data: payload,
        );
        final data = res.data;
        if (data == null || data['id'] == null) {
          throw StateError(data?['error']?.toString() ?? '创建房间失败');
        }
        return RoomSummary(
          id: '${data['id']}',
          name: '${data['name'] ?? name}',
          userCount: 0,
          hasPassword: password != null && password.trim().isNotEmpty,
          isPlaying: false,
          queueLength: 0,
        );
      } on DioException catch (e) {
        final msg = e.message?.trim() ?? '';
        final denied = e.response?.statusCode == 403 ||
            msg.contains('请求无效') ||
            msg.contains('会话');
        if (denied && attempt == 0) {
          SessionBootstrap.reset();
          continue;
        }
        if (msg.isNotEmpty) throw StateError(msg);
        rethrow;
      }
    }
    throw StateError('创建房间失败，请稍后重试');
  }

  static Future<Map<String, dynamic>> checkRoom(String roomId) async {
    await SessionBootstrap.ensure();
    try {
      final res = await OmHttp.get<Map<String, dynamic>>('/api/rooms/$roomId');
      final data = res.data ?? {};
      return {
        'exists': true,
        'hasPassword': data['hasPassword'] == true,
        'isLocked': data['isLocked'] == true,
        'name': data['name'],
      };
    } catch (_) {
      return {'exists': false, 'hasPassword': false};
    }
  }

  static Future<Map<String, dynamic>?> siteAnnouncement() async {
    try {
      final res = await OmHttp.get<Map<String, dynamic>>('/api/site-announcement');
      return res.data;
    } catch (_) {
      return null;
    }
  }
}
