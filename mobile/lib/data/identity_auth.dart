import 'package:dio/dio.dart';
import 'package:openmusic/core/config.dart';
import 'package:openmusic/core/http_client.dart';

class OAuthBinding {
  const OAuthBinding({
    required this.id,
    required this.username,
    required this.avatarUrl,
    required this.boundAt,
  });

  final String id;
  final String username;
  final String avatarUrl;
  final int boundAt;
}

class OAuthStatus {
  const OAuthStatus({required this.enabled, this.bound});

  final bool enabled;
  final OAuthBinding? bound;
}

class IdentityAuthApi {
  IdentityAuthApi._();

  static Future<OAuthStatus> fetchLinuxdoStatus() => _fetchStatus(
        '/api/auth/linuxdo/status',
        idKey: 'linuxdoId',
      );

  static Future<OAuthStatus> fetchGithubStatus() => _fetchStatus(
        '/api/auth/github/status',
        idKey: 'githubId',
      );

  static Uri buildLinuxdoBindUri(String roomId, String returnPath) =>
      AppConfig.api('/api/auth/linuxdo/start', {
        'purpose': 'bind',
        'roomId': roomId,
        'returnPath': returnPath,
      });

  static Uri buildLinuxdoRecoverUri(String returnPath) =>
      AppConfig.api('/api/auth/linuxdo/start', {
        'purpose': 'recover',
        'returnPath': returnPath,
      });

  static Uri buildGithubBindUri(String roomId, String returnPath) =>
      AppConfig.api('/api/auth/github/start', {
        'purpose': 'bind',
        'roomId': roomId,
        'returnPath': returnPath,
      });

  static Uri buildGithubRecoverUri(String returnPath) =>
      AppConfig.api('/api/auth/github/start', {
        'purpose': 'recover',
        'returnPath': returnPath,
      });

  static Future<Map<String, dynamic>> unbindLinuxdo() => _unbind('/api/auth/linuxdo/unbind');

  static Future<Map<String, dynamic>> unbindGithub() => _unbind('/api/auth/github/unbind');

  static Future<OAuthStatus> _fetchStatus(
    String path, {
    required String idKey,
  }) async {
    try {
      await OmHttp.init();
      final res = await OmHttp.get<dynamic>(path);
      final data = res.data is Map ? Map<String, dynamic>.from(res.data as Map) : const <String, dynamic>{};
      final boundRaw = data['bound'];
      return OAuthStatus(
        enabled: data['enabled'] == true,
        bound: boundRaw is Map
            ? OAuthBinding(
                id: '${boundRaw[idKey] ?? ''}',
                username: '${boundRaw['username'] ?? ''}',
                avatarUrl: '${boundRaw['avatarUrl'] ?? ''}',
                boundAt: (boundRaw['boundAt'] as num?)?.toInt() ?? 0,
              )
            : null,
      );
    } catch (_) {
      return const OAuthStatus(enabled: false);
    }
  }

  static Future<Map<String, dynamic>> _unbind(String path) async {
    try {
      await OmHttp.init();
      final res = await OmHttp.post<dynamic>(path);
      final data = res.data is Map ? Map<String, dynamic>.from(res.data as Map) : const <String, dynamic>{};
      return {
        'success': true,
        ...data,
      };
    } on DioException catch (e) {
      return {
        'success': false,
        'error': e.message ?? '解绑失败',
      };
    } catch (_) {
      return const {
        'success': false,
        'error': '网络错误，解绑失败',
      };
    }
  }
}
