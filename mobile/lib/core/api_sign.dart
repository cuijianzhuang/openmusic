import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:uuid/uuid.dart';

const _signQueryKeys = {'om_ts', 'om_nonce', 'om_sign'};

const _publicApiPaths = {
  '/api/health',
  '/api/app-version',
  '/api/site-announcement',
  '/api/site-seo',
  '/api/session/bootstrap',
};

String? _apiSignKey;

void setApiSignKey(String? key) {
  final trimmed = key?.trim();
  _apiSignKey = (trimmed == null || trimmed.isEmpty) ? null : trimmed;
}

String? getApiSignKey() => _apiSignKey;

bool _isPublicApiPath(String pathname, String method) {
  if (_publicApiPaths.contains(pathname)) return true;
  if (pathname == '/api/rooms' && method.toUpperCase() == 'GET') return true;
  return false;
}

bool needsApiSign(Uri uri, [String method = 'GET']) {
  if (!uri.path.startsWith('/api/')) return false;
  return !_isPublicApiPath(uri.path, method);
}

String canonicalApiQuery(Map<String, String> params) {
  final entries = params.entries
      .where((e) => !_signQueryKeys.contains(e.key))
      .toList()
    ..sort((a, b) => a.key.compareTo(b.key));
  return entries.map((e) => '${e.key}=${e.value}').join('&');
}

String _sha256Hex(String text) {
  if (text.isEmpty) return '';
  return sha256.convert(utf8.encode(text)).toString();
}

String _hmacSha256Base64Url(String key, String message) {
  final hmac = Hmac(sha256, utf8.encode(key));
  final digest = hmac.convert(utf8.encode(message));
  return base64Url.encode(digest.bytes).replaceAll('=', '');
}

String _randomNonce() {
  try {
    return const Uuid().v4();
  } catch (_) {
    final r = Random.secure();
    return '${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}-'
        '${List.generate(8, (_) => r.nextInt(36).toRadixString(36)).join()}';
  }
}

/// Build `X-OM-*` headers matching web [`apiSign.ts`](client/src/lib/apiSign.ts).
Map<String, String> buildApiSignHeaders({
  required String method,
  required String path,
  String query = '',
  String body = '',
}) {
  final key = _apiSignKey;
  if (key == null) return {};

  final ts = DateTime.now().millisecondsSinceEpoch ~/ 1000;
  final nonce = _randomNonce();
  final bodyHash = _sha256Hex(body);
  final payload = [
    method.toUpperCase(),
    path,
    query,
    bodyHash,
    '$ts',
    nonce,
  ].join('\n');
  final sign = _hmacSha256Base64Url(key, payload);

  return {
    'X-OM-Ts': '$ts',
    'X-OM-Nonce': nonce,
    'X-OM-Sign': sign,
  };
}
