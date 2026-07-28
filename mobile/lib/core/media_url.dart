import 'package:flutter/foundation.dart';
import 'package:openmusic/core/api_sign.dart';
import 'package:openmusic/core/config.dart';
import 'package:openmusic/core/session.dart';

/// Playback URL for just_audio.
///
/// On web, prefer **direct CDN** URLs: `<audio>` can play cross-origin media
/// without CORS. Routing through `/api/media-proxy` often hits Chrome ORB
/// (`ERR_BLOCKED_BY_ORB`) and fails with MEDIA_ELEMENT_ERROR.
///
/// Proxy only for mixed-content (HTTPS page + HTTP audio) or same-origin API paths.
Future<String> resolvePlaybackAudioUrl(String url) async {
  final trimmed = url.trim();
  if (trimmed.isEmpty) return trimmed;

  if (trimmed.startsWith('/')) {
    return (await resolveSignedApiUrl(trimmed)) ??
        '${AppConfig.serverUrl}$trimmed';
  }

  final uri = Uri.tryParse(trimmed);
  if (uri == null || !(uri.isScheme('http') || uri.isScheme('https'))) {
    return trimmed;
  }

  final serverHost = Uri.tryParse(AppConfig.serverUrl)?.host ?? '';
  if (serverHost.isNotEmpty && uri.host == serverHost) {
    return (await resolveSignedApiUrl(trimmed)) ?? trimmed;
  }

  // HTTPS app loading HTTP audio → mixed content; proxy to same-origin HTTPS API.
  if (kIsWeb && uri.isScheme('http')) {
    final pageHttps = Uri.base.isScheme('https');
    if (pageHttps) {
      final proxied = await mediaProxyUrl(trimmed);
      if (proxied != null && proxied.isNotEmpty) return proxied;
    }
  }

  return trimmed;
}

/// Resolve a cover/media URL for [`CachedNetworkImage`].
///
/// Mirrors web [`signedApiUrl.ts`](client/src/lib/signedApiUrl.ts) and
/// [`SongCover.tsx`](client/src/components/SongCover.tsx) proxy fallback.
Future<String?> resolveSignedApiUrl(String? url) async {
  if (url == null) return null;
  final trimmed = url.trim();
  if (trimmed.isEmpty) return null;
  if (trimmed.startsWith('data:')) return trimmed;

  final upgraded = _upgradeInsecureCoverUrl(trimmed);
  final absolute = _toAbsoluteApiUrl(upgraded);
  final uri = Uri.tryParse(absolute);
  if (uri == null) return trimmed;

  if (!needsApiSign(uri)) return absolute;
  return _signUrl(uri);
}

/// External CDN cover → signed `/api/media-proxy` URL.
Future<String?> mediaProxyUrl(String raw, {int? sizePx}) async {
  final trimmed = raw.trim();
  if (trimmed.isEmpty || trimmed.startsWith('data:')) return null;
  if (!trimmed.startsWith('http')) return null;

  final serverHost = Uri.tryParse(AppConfig.serverUrl)?.host ?? '';
  final rawHost = Uri.tryParse(trimmed)?.host ?? '';
  if (serverHost.isNotEmpty && rawHost == serverHost) return null;

  final query = <String, String>{'url': trimmed};
  if (sizePx != null && sizePx > 0) query['size'] = '$sizePx';
  final proxy = AppConfig.api('/api/media-proxy', query);
  return resolveSignedApiUrl(proxy.toString());
}

/// QQ / NetEase CDN often block hotlink Referer; prefer proxy on web for covers.
bool preferCoverProxy(String url) {
  final host = Uri.tryParse(url)?.host.toLowerCase() ?? '';
  if (host.isEmpty) return false;
  return host.contains('gtimg.com') ||
      host.contains('y.qq.com') ||
      host.contains('kugou.com') ||
      host.contains('kgimg.com');
}

String _upgradeInsecureCoverUrl(String url) {
  if (!url.startsWith('http://')) return url;
  // Kugou http nodes often have broken https certs — leave for proxy path.
  final host = Uri.tryParse(url)?.host.toLowerCase() ?? '';
  if (host.contains('kugou.com') || host.contains('kgimg.com')) return url;
  return 'https://${url.substring('http://'.length)}';
}

String _toAbsoluteApiUrl(String url) {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return '${AppConfig.serverUrl}$url';
  return url;
}

Future<String> _signUrl(Uri uri) async {
  await SessionBootstrap.ensure();
  final query = canonicalApiQuery(
    Map<String, String>.from(uri.queryParameters),
  );
  final headers = buildApiSignHeaders(
    method: 'GET',
    path: uri.path,
    query: query,
  );
  final sign = headers['X-OM-Sign'];
  if (sign == null || sign.isEmpty) {
    return uri.toString();
  }

  final params = Map<String, String>.from(uri.queryParameters);
  params['om_ts'] = headers['X-OM-Ts']!;
  params['om_nonce'] = headers['X-OM-Nonce']!;
  params['om_sign'] = sign;
  return uri.replace(queryParameters: params).toString();
}
