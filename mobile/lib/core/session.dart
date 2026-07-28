import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';
import 'package:openmusic/core/api_sign.dart';
import 'package:openmusic/core/http_client.dart';

/// Session bootstrap via HttpOnly Cookie — mirrors web `sessionBootstrap.ts`.
class SessionBootstrap {
  SessionBootstrap._();

  static Future<String?>? _inflight;
  static String? clientId;

  static Future<String?> ensure({bool force = false}) {
    if (force) _inflight = null;
    return _inflight ??= _run();
  }

  static Future<String> require({bool force = false}) async {
    var id = await ensure(force: force);
    if (id == null || id.isEmpty) {
      reset();
      id = await ensure(force: true);
    }
    if (id == null || id.isEmpty) {
      throw StateError('会话未就绪，请检查网络后重试');
    }
    return id;
  }

  static void reset() {
    _inflight = null;
    clientId = null;
    setApiSignKey(null);
  }

  static Future<String?> _run() async {
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        final id = await _request();
        if (id != null && id.isNotEmpty) return id;
      } catch (_) {
        // retry
      }
      if (attempt < 2) {
        await Future<void>.delayed(Duration(milliseconds: 250 * (attempt + 1)));
      }
    }
    return null;
  }

  static Future<String?> _request() async {
    final deviceId = await _deviceId();
    final res = await OmHttp.post<Map<String, dynamic>>(
      '/api/session/bootstrap',
      data: {'deviceId': deviceId},
    );
    final data = res.data;
    if (data == null) return null;
    setApiSignKey(data['apiSignKey'] as String?);
    final id = data['clientId'] as String?;
    if (id != null && id.isNotEmpty) {
      clientId = id;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('om_client_id', id);
    }
    return id;
  }

  static Future<String> _deviceId() async {
    final prefs = await SharedPreferences.getInstance();
    var id = prefs.getString('om_device_id');
    if (id == null || id.isEmpty) {
      id = const Uuid().v4();
      await prefs.setString('om_device_id', id);
    }
    return id;
  }
}
