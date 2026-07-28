import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:openmusic/core/config.dart';
import 'package:openmusic/core/http_client.dart';
import 'package:openmusic/core/media_url.dart';

/// Room/song cover with signed API URLs and media-proxy fallback.
///
/// Flutter Web runs on a different origin than the API, so `<img>` cannot send
/// session cookies. Authenticated `/api/meting` / `/api/media-proxy` covers are
/// fetched via Dio (cookies + sign) and rendered from memory.
class OmCoverImage extends StatefulWidget {
  const OmCoverImage({
    super.key,
    required this.url,
    this.sizePx,
    this.fit = BoxFit.cover,
    this.fallback,
  });

  final String? url;
  final int? sizePx;
  final BoxFit fit;
  final Widget? fallback;

  @override
  State<OmCoverImage> createState() => _OmCoverImageState();
}

class _OmCoverImageState extends State<OmCoverImage> {
  _LoadStage _stage = _LoadStage.primary;
  String? _resolvedUrl;
  Uint8List? _bytes;
  String? _identity;
  var _gen = 0;

  @override
  void didUpdateWidget(covariant OmCoverImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    final id = '${widget.url}|${widget.sizePx}';
    if (id != _identity) {
      _identity = id;
      _stage = _LoadStage.primary;
      _resolvedUrl = null;
      _bytes = null;
      _resolve();
    }
  }

  @override
  void initState() {
    super.initState();
    _identity = '${widget.url}|${widget.sizePx}';
    _resolve();
  }

  bool _isApiMediaUrl(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null) return false;
    if (uri.path.startsWith('/api/')) return true;
    final server = Uri.tryParse(AppConfig.serverUrl);
    return server != null &&
        uri.hasScheme &&
        uri.host == server.host &&
        uri.path.startsWith('/api/');
  }

  Future<Uint8List?> _fetchBytes(String url) async {
    await OmHttp.init();
    final uri = Uri.parse(url.startsWith('/') ? '${AppConfig.serverUrl}$url' : url);
    final pathAndQuery = uri.hasQuery ? '${uri.path}?${uri.query}' : uri.path;
    // Prefer relative path so Dio baseUrl + cookie jar apply.
    final res = await OmHttp.client.get<List<int>>(
      pathAndQuery,
      options: Options(
        responseType: ResponseType.bytes,
        validateStatus: (code) => code != null && code >= 200 && code < 400,
      ),
    );
    final data = res.data;
    if (data == null || data.isEmpty) return null;
    return Uint8List.fromList(data);
  }

  Future<void> _resolve() async {
    final gen = ++_gen;
    final raw = widget.url?.trim();
    if (raw == null || raw.isEmpty) {
      if (mounted && gen == _gen) {
        setState(() {
          _resolvedUrl = null;
          _bytes = null;
        });
      }
      return;
    }

    String? target;
    if (_stage == _LoadStage.proxy) {
      if (preferCoverProxy(raw) && raw.startsWith('http')) {
        target = await resolveSignedApiUrl(raw);
      } else {
        target = await mediaProxyUrl(raw, sizePx: widget.sizePx);
      }
    } else if (preferCoverProxy(raw) && raw.startsWith('http')) {
      target = await mediaProxyUrl(raw, sizePx: widget.sizePx);
      target ??= await resolveSignedApiUrl(raw);
    } else {
      target = await resolveSignedApiUrl(raw);
    }

    if (!mounted || gen != _gen) return;

    if (target == null || target.isEmpty) {
      setState(() {
        _resolvedUrl = null;
        _bytes = null;
      });
      return;
    }

    if (_isApiMediaUrl(target) || (kIsWeb && preferCoverProxy(raw))) {
      // Always auth-fetch API/proxy covers on web (cross-origin img drops cookies).
      final apiTarget = _isApiMediaUrl(target)
          ? target
          : (await mediaProxyUrl(raw, sizePx: widget.sizePx)) ?? target;
      try {
        final bytes = await _fetchBytes(apiTarget);
        if (!mounted || gen != _gen) return;
        if (bytes != null) {
          setState(() {
            _bytes = bytes;
            _resolvedUrl = null;
          });
          return;
        }
      } catch (e) {
        debugPrint('cover auth fetch failed: $e');
      }
      if (!mounted || gen != _gen) return;
      // Fall through to direct URL attempt.
    }

    setState(() {
      _bytes = null;
      _resolvedUrl = target;
    });
  }

  void _onError() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (_stage == _LoadStage.primary) {
        setState(() {
          _stage = _LoadStage.proxy;
          _bytes = null;
          _resolvedUrl = null;
        });
        _resolve();
        return;
      }
      if (_stage == _LoadStage.proxy) {
        setState(() => _stage = _LoadStage.failed);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final fb = widget.fallback ?? const _DefaultCoverFallback();
    if (_stage == _LoadStage.failed) return fb;

    final raw = widget.url?.trim();
    if (raw == null || raw.isEmpty) return fb;

    final bytes = _bytes;
    if (bytes != null) {
      return Image.memory(
        bytes,
        fit: widget.fit,
        gaplessPlayback: true,
        errorBuilder: (_, __, ___) {
          _onError();
          return fb;
        },
      );
    }

    final src = _resolvedUrl;
    if (src == null) {
      return const ColoredBox(color: Colors.black26);
    }

    if (src.startsWith('data:')) {
      try {
        final comma = src.indexOf(',');
        if (comma < 0) return fb;
        final decoded = base64Decode(src.substring(comma + 1));
        return Image.memory(
          decoded,
          fit: widget.fit,
          errorBuilder: (_, __, ___) {
            _onError();
            return fb;
          },
        );
      } catch (_) {
        _onError();
        return fb;
      }
    }

    return CachedNetworkImage(
      imageUrl: src,
      fit: widget.fit,
      httpHeaders: const {'Referer': ''},
      errorWidget: (_, __, ___) {
        _onError();
        return fb;
      },
    );
  }
}

enum _LoadStage { primary, proxy, failed }

class _DefaultCoverFallback extends StatelessWidget {
  const _DefaultCoverFallback();

  @override
  Widget build(BuildContext context) {
    return const ColoredBox(
      color: Color(0xFF1A1A1E),
      child: Center(
        child: Icon(Icons.music_note_rounded, color: Color(0xFF5C5C66), size: 28),
      ),
    );
  }
}
