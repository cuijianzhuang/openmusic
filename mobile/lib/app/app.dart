import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openmusic/app/brand.dart';
import 'package:openmusic/app/router.dart';
import 'package:openmusic/app/theme.dart';
import 'package:openmusic/core/http_client.dart';
import 'package:openmusic/playback/playback_sync_engine.dart';

class OpenMusicApp extends ConsumerStatefulWidget {
  const OpenMusicApp({super.key});

  @override
  ConsumerState<OpenMusicApp> createState() => _OpenMusicAppState();
}

class _OpenMusicAppState extends ConsumerState<OpenMusicApp> {
  var _ready = false;
  String? _initError;

  @override
  void initState() {
    super.initState();
    _boot();
  }

  Future<void> _boot() async {
    try {
      await OmHttp.init();
      ref.read(playbackSyncProvider);
      if (mounted) setState(() => _ready = true);
    } catch (e) {
      if (mounted) setState(() => _initError = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_initError != null) {
      return MaterialApp(
        theme: OmTheme.darkTheme(),
        debugShowCheckedModeBanner: false,
        home: OmBackdrop(
          child: Scaffold(
            backgroundColor: Colors.transparent,
            body: SafeArea(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(28),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const BrandMark(size: 64),
                      const SizedBox(height: 20),
                      const Text(
                        '启动失败',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        _initError!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: OmTheme.muted, height: 1.45),
                      ),
                      const SizedBox(height: 22),
                      FilledButton(
                        onPressed: () {
                          setState(() {
                            _initError = null;
                            _ready = false;
                          });
                          _boot();
                        },
                        child: const Text('重试'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    if (!_ready) {
      return MaterialApp(
        theme: OmTheme.darkTheme(),
        debugShowCheckedModeBanner: false,
        home: const OmBackdrop(
          child: Scaffold(
            backgroundColor: Colors.transparent,
            body: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  BrandMark(size: 72),
                  SizedBox(height: 28),
                  SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.4,
                      color: OmTheme.red,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'OpenMusic',
      theme: OmTheme.darkTheme(),
      routerConfig: router,
      debugShowCheckedModeBanner: false,
    );
  }
}
