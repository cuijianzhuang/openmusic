import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:openmusic/core/config.dart';

const _background = Color(0xFF121212);
const _accent = Color(0xFFEC4141);

class WebPlayerState {
  const WebPlayerState(
      {this.title = '',
      this.artist = '',
      this.cover = '',
      this.playing = false,
      this.position = 0,
      this.duration = 0,
      this.canPause = false,
      this.canSkip = false,
      this.canSeek = false,
      this.lyric = '',
      this.playMode = 'order',
      this.playModeLabel = '顺序',
      this.canChangeMode = false,
      this.favorited = false});

  final String title;
  final String artist;
  final String cover;
  final bool playing;
  final double position;
  final double duration;
  final bool canPause;
  final bool canSkip;
  final bool canSeek;
  final String lyric;
  final String playMode;
  final String playModeLabel;
  final bool canChangeMode;
  final bool favorited;

  WebPlayerState copyWith(
          {String? title,
          String? artist,
          String? cover,
          bool? playing,
          double? position,
          double? duration,
          bool? canPause,
          bool? canSkip,
          bool? canSeek,
          String? lyric,
          String? playMode,
          String? playModeLabel,
          bool? canChangeMode,
          bool? favorited}) =>
      WebPlayerState(
        title: title ?? this.title,
        artist: artist ?? this.artist,
        cover: cover ?? this.cover,
        playing: playing ?? this.playing,
        position: position ?? this.position,
        duration: duration ?? this.duration,
        canPause: canPause ?? this.canPause,
        canSkip: canSkip ?? this.canSkip,
        canSeek: canSeek ?? this.canSeek,
        lyric: lyric ?? this.lyric,
        playMode: playMode ?? this.playMode,
        playModeLabel: playModeLabel ?? this.playModeLabel,
        canChangeMode: canChangeMode ?? this.canChangeMode,
        favorited: favorited ?? this.favorited,
      );
}

/// Web-first app shell. The web app owns its data/session; Flutter owns the
/// native surface and the small playback bar at the bottom.
class WebShellPage extends StatefulWidget {
  const WebShellPage({super.key, this.path = '/'});
  final String path;

  @override
  State<WebShellPage> createState() => _WebShellPageState();
}

class _WebShellPageState extends State<WebShellPage> {
  InAppWebViewController? _controller;
  var _loading = true;
  String? _error;
  var _player = const WebPlayerState();

  Uri get _url => Uri.parse(
      '${AppConfig.serverUrl}${widget.path.startsWith('/') ? widget.path : '/${widget.path}'}');

  @override
  void initState() {
    super.initState();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Colors.transparent,
      systemNavigationBarIconBrightness: Brightness.light,
      systemStatusBarContrastEnforced: false,
      systemNavigationBarContrastEnforced: false,
    ));
    _android.setMethodCallHandler(_handleNativeMethodCall);
  }

  @override
  void dispose() {
    _android.setMethodCallHandler(null);
    super.dispose();
  }

  Future<dynamic> _handleNativeMethodCall(MethodCall call) async {
    if (call.method != 'playbackAction') {
      throw MissingPluginException('Unsupported native method: ${call.method}');
    }
    final raw = call.arguments;
    if (raw is! Map) return {'ok': false, 'error': 'invalid_payload'};
    final payload = Map<String, dynamic>.from(raw);
    final action = '${payload.remove('action') ?? ''}';
    if (action.isEmpty) return {'ok': false, 'error': 'invalid_action'};
    await _command(action, payload);
    return {'ok': true};
  }

  Future<void> _command(String action, [Map<String, dynamic>? payload]) async {
    final body = <String, dynamic>{'action': action, ...?payload};
    await _controller?.evaluateJavascript(
        source:
            'window.dispatchEvent(new CustomEvent("omNativePlayerCommand", { detail: ${jsonEncode(body)} }));');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _background,
      resizeToAvoidBottomInset: false,
      body: SafeArea(
        top: true,
        bottom: false,
        child: Stack(children: [
          InAppWebView(
            initialUrlRequest: URLRequest(url: WebUri(_url.toString())),
            initialSettings: InAppWebViewSettings(
              javaScriptEnabled: true,
              mediaPlaybackRequiresUserGesture: false,
              allowsInlineMediaPlayback: true,
              allowBackgroundAudioPlaying: true,
              thirdPartyCookiesEnabled: true,
            ),
            onWebViewCreated: (controller) {
              _controller = controller;
              controller.addJavaScriptHandler(
                handlerName: 'omPlayerState',
                callback: (args) async {
                  if (args.isEmpty || args.first is! Map) return null;
                  final m = Map<String, dynamic>.from(args.first as Map);
                  if (!mounted) return null;
                  final next = _player.copyWith(
                    title: '${m['title'] ?? ''}',
                    artist: '${m['artist'] ?? ''}',
                    cover: '${m['cover'] ?? ''}',
                    playing: m['playing'] == true,
                    position: (m['position'] as num?)?.toDouble() ?? 0,
                    duration: (m['duration'] as num?)?.toDouble() ?? 0,
                    canPause: m['canPause'] == true,
                    canSkip: m['canSkip'] == true,
                    canSeek: m['canSeek'] == true,
                    lyric: '${m['lyric'] ?? ''}',
                    playMode: '${m['playMode'] ?? 'order'}',
                    playModeLabel: '${m['playModeLabel'] ?? '顺序'}',
                    canChangeMode: m['canChangeMode'] == true,
                    favorited: m['favorited'] == true,
                  );
                  setState(() => _player = next);
                  await _syncMediaNotification(next);
                  return {'ok': true};
                },
              );
              controller.addJavaScriptHandler(
                handlerName: 'omNative',
                callback: (args) async =>
                    _nativeCommand(args.isNotEmpty ? args.first : null),
              );
            },
            onLoadStart: (_, __) => mounted
                ? setState(() {
                    _loading = true;
                    _error = null;
                  })
                : null,
            onLoadStop: (_, __) =>
                mounted ? setState(() => _loading = false) : null,
            onReceivedError: (_, request, error) {
              if (!mounted || request.isForMainFrame != true) return;
              setState(() {
                _loading = false;
                _error = error.description;
              });
            },
          ),
          if (_loading)
            const Center(child: CircularProgressIndicator(color: _accent)),
          if (_error != null)
            Center(
                child: Text('网页加载失败：$_error',
                    style: const TextStyle(color: Colors.white70))),
        ]),
      ),
    );
  }

  Future<void> _syncMediaNotification(WebPlayerState state) async {
    try {
      if (state.title.isEmpty) {
        await _android.invokeMethod('clearPlaybackNotification');
        return;
      }
      await _android.invokeMethod('requestNotificationPermission');
      await _android.invokeMethod('updatePlaybackNotification', {
        'title': state.title,
        'artist': state.artist,
        'cover': state.cover,
        'playing': state.playing,
        'position': state.position,
        'duration': state.duration,
        'canPause': state.canPause,
        'canSkip': state.canSkip,
        'canSeek': state.canSeek,
        'lyric': state.lyric,
        'playMode': state.playMode,
        'playModeLabel': state.playModeLabel,
        'canChangeMode': state.canChangeMode,
        'favorited': state.favorited,
      });
    } on PlatformException {
      // The web player remains usable when the Android notification fails.
    }
  }

  Future<dynamic> _nativeCommand(dynamic raw) async {
    if (raw is! Map) return {'ok': false, 'error': 'invalid_payload'};
    final action = '${raw['action'] ?? ''}';
    if (action == 'vibrate') return _android.invokeMethod('vibrate');
    if (action == 'share') {
      return _android.invokeMethod('share', {'text': '${raw['text'] ?? ''}'});
    }
    if (action == 'openExternal') {
      return _android
          .invokeMethod('openExternal', {'url': '${raw['url'] ?? ''}'});
    }
    return {'ok': false, 'error': 'unsupported_action'};
  }
}

const _android = MethodChannel('com.openmusic.app/native');
