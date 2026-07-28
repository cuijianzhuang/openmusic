import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openmusic/app/app.dart';
import 'package:openmusic/core/config.dart';
import 'package:openmusic/playback/audio_handler.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    debugPrint('FlutterError: ${details.exceptionAsString()}');
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    debugPrint('Uncaught: $error\n$stack');
    return true;
  };

  ErrorWidget.builder = (details) {
    return Material(
      color: const Color(0xFF0E0E10),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            '界面出错\n${details.exceptionAsString()}',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white70),
          ),
        ),
      ),
    );
  };

  try {
    await AppConfig.init();
  } catch (e, st) {
    debugPrint('AppConfig.init failed: $e\n$st');
  }

  // Prefer awaiting audio on web so first room join can play immediately.
  try {
    await initOpenMusicAudioService().timeout(const Duration(seconds: 4));
  } catch (e, st) {
    debugPrint('Audio init: $e\n$st');
  }

  runApp(const ProviderScope(child: OpenMusicApp()));
}
