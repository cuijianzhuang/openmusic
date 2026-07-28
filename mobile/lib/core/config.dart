/// App runtime configuration.
///
/// Server URL is fixed at build time via `--dart-define=OM_SERVER_URL=...`
/// or inferred from `OM_FLAVOR` (local → localhost, prod → production).
library;

import 'package:flutter/foundation.dart';

class AppConfig {
  AppConfig._();

  static const productionDefault = 'https://qqovo.top';

  /// Local `npm run dev` — Web must use localhost for cookies.
  static const localDesktopDefault = 'http://localhost:4000';

  /// Android emulator loopback to host machine.
  static const localAndroidEmulatorDefault = 'http://10.0.2.2:4000';

  static late String serverUrl;

  static const _fromDefine = String.fromEnvironment(
    'OM_SERVER_URL',
    defaultValue: '',
  );

  /// `--dart-define=OM_FLAVOR=local|prod`
  static const flavor = String.fromEnvironment(
    'OM_FLAVOR',
    defaultValue: '',
  );

  static Future<void> init() async {
    var url = _fromDefine.trim();
    if (url.isEmpty) {
      url = _defaultForRuntime();
    }
    serverUrl = _normalize(url);
  }

  static String _defaultForRuntime() {
    if (flavor == 'prod') return productionDefault;
    if (flavor == 'local') return _localDefaultForPlatform();

    // Release APK/IPA without explicit flavor → production.
    if (kReleaseMode) return productionDefault;

    // Debug/profile without flavor → local dev server.
    return _localDefaultForPlatform();
  }

  static String _localDefaultForPlatform() {
    if (kIsWeb) return localDesktopDefault;
    if (defaultTargetPlatform == TargetPlatform.android) {
      return localAndroidEmulatorDefault;
    }
    return localDesktopDefault;
  }

  static String _normalize(String url) {
    var out = url.trim();
    if (out.endsWith('/')) out = out.substring(0, out.length - 1);
    if (kIsWeb) {
      out = out
          .replaceFirst('http://127.0.0.1:', 'http://localhost:')
          .replaceFirst('https://127.0.0.1:', 'https://localhost:');
    }
    return out;
  }

  static Uri api(String path, [Map<String, String>? query]) {
    final normalized = path.startsWith('/') ? path : '/$path';
    return Uri.parse('$serverUrl$normalized').replace(queryParameters: query);
  }
}
