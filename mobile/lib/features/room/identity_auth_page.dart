import 'dart:io' as io;

import 'package:cookie_jar/cookie_jar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:openmusic/app/theme.dart';
import 'package:openmusic/core/http_client.dart';
import 'package:openmusic/core/http_platform.dart';

class IdentityAuthResult {
  const IdentityAuthResult({required this.success, required this.message, required this.isError});

  final bool success;
  final String message;
  final bool isError;
}

class IdentityAuthPage extends StatefulWidget {
  const IdentityAuthPage({
    super.key,
    required this.title,
    required this.startUrl,
    required this.resultQueryKey,
  });

  final String title;
  final Uri startUrl;
  final String resultQueryKey;

  @override
  State<IdentityAuthPage> createState() => _IdentityAuthPageState();
}

class _IdentityAuthPageState extends State<IdentityAuthPage> {
  var _loading = true;
  String? _error;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0E0E10),
      appBar: AppBar(
        title: Text(widget.title),
        backgroundColor: const Color(0xFF121316),
      ),
      body: Stack(
        children: [
          InAppWebView(
            initialUrlRequest: URLRequest(url: WebUri(widget.startUrl.toString())),
            initialSettings: InAppWebViewSettings(
              javaScriptEnabled: true,
              thirdPartyCookiesEnabled: true,
              clearCache: false,
              mediaPlaybackRequiresUserGesture: false,
            ),
            onLoadStop: (controller, url) async {
              if (!mounted) return;
              setState(() => _loading = false);
              if (url == null) return;
              await _maybeFinish(url);
            },
            onReceivedError: (_, request, error) {
              if (!mounted) return;
              setState(() => _error = error.description);
            },
          ),
          if (_loading)
            const Center(
              child: CircularProgressIndicator(),
            ),
          if (_error != null)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  '加载失败：$_error',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white70),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _maybeFinish(WebUri url) async {
    final result = Uri.parse(url.toString()).queryParameters[widget.resultQueryKey];
    if (result == null || result.isEmpty) return;
    await _syncCookies();
    if (!mounted) return;
    final resolved = _resolveMessage(widget.resultQueryKey, result);
    Navigator.pop(
      context,
      IdentityAuthResult(
        success: !resolved.$2,
        message: resolved.$1,
        isError: resolved.$2,
      ),
    );
  }

  Future<void> _syncCookies() async {
    final jar = await getSharedCookieJar();
    if (jar is! PersistCookieJar) return;
    final manager = CookieManager.instance();
    final cookies = await manager.getCookies(
      url: WebUri(OmHttp.client.options.baseUrl),
    );
    if (cookies.isEmpty) return;
    final uri = Uri.parse(OmHttp.client.options.baseUrl);
    final mapped = cookies
        .map(
          (cookie) => io.Cookie(cookie.name, cookie.value)
            ..domain = cookie.domain ?? uri.host
            ..path = cookie.path ?? '/'
            ..secure = cookie.isSecure ?? uri.scheme == 'https'
            ..httpOnly = cookie.isHttpOnly ?? false
            ..expires = cookie.expiresDate == null
                ? null
                : DateTime.fromMillisecondsSinceEpoch(cookie.expiresDate!),
        )
        .toList();
    await jar.saveFromResponse(uri, mapped);
    await OmHttp.reinit();
  }

  (String, bool) _resolveMessage(String key, String result) {
    final map = switch (key) {
      'linuxdo' => const {
          'bound': ('已绑定 Linux.do 账号', false),
          'recovered': ('已通过 Linux.do 找回房间身份', false),
          'notfound': ('这个 Linux.do 账号还没有绑定过任何身份', true),
          'expired': ('登录已过期或身份已变化，请重试', true),
          'error': ('Linux.do 登录失败，请稍后再试', true),
        },
      'github' => const {
          'bound': ('已绑定 GitHub 账号', false),
          'recovered': ('已通过 GitHub 找回房间身份', false),
          'notfound': ('这个 GitHub 账号还没有绑定过任何身份', true),
          'expired': ('登录已过期或身份已变化，请重试', true),
          'error': ('GitHub 登录失败，请稍后再试', true),
        },
      _ => const <String, (String, bool)>{},
    };
    return map[result] ?? ('操作完成，请返回房间确认身份状态', false);
  }
}
