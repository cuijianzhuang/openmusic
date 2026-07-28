import 'package:audio_service/audio_service.dart';
import 'package:flutter/foundation.dart';
import 'package:just_audio/just_audio.dart';
import 'package:openmusic/domain/models.dart' as models;

OpenMusicAudioHandler? openMusicAudioHandler;

/// Init audio. On web, skip [AudioService] (unreliable) and use bare just_audio.
Future<void> initOpenMusicAudioService() async {
  if (openMusicAudioHandler != null) return;
  try {
    if (kIsWeb) {
      openMusicAudioHandler = OpenMusicAudioHandler();
      debugPrint('Audio: web bare just_audio handler ready');
      return;
    }
    openMusicAudioHandler = await AudioService.init(
      builder: () => OpenMusicAudioHandler(),
      config: AudioServiceConfig(
        androidNotificationChannelId: 'com.openmusic.app.playback',
        androidNotificationChannelName: 'OpenMusic 播放',
        androidNotificationOngoing: true,
        androidStopForegroundOnPause: false,
        androidNotificationIcon: 'drawable/ic_stat_notify',
      ),
    ).timeout(const Duration(seconds: 5));
  } catch (e, st) {
    debugPrint('AudioService.init failed, falling back to bare handler: $e\n$st');
    openMusicAudioHandler ??= OpenMusicAudioHandler();
  }
}

typedef MediaActionCallback = void Function(MediaControlAction action);

enum MediaControlAction { play, pause, skipToNext, skipToPrevious }

/// Background audio handler: just_audio (+ optional system media controls).
class OpenMusicAudioHandler extends BaseAudioHandler with SeekHandler {
  OpenMusicAudioHandler() {
    _player.playbackEventStream.listen(_broadcastState);
    _player.playerStateStream.listen((_) => _broadcastState(_player.playbackEvent));
  }

  final AudioPlayer _player = AudioPlayer();
  MediaActionCallback? onMediaAction;
  bool playBound = true;
  bool skipBound = true;
  bool seekBound = true;

  AudioPlayer get player => _player;

  Future<void> setSourceUrl(
    String url, {
    required MediaItem item,
    Duration? initialPosition,
  }) async {
    mediaItem.add(item);
    final uri = _parseAudioUri(url);
    // Web: avoid initialPosition — seeking before demuxer ready breaks FLAC/MSE.
    final pos = kIsWeb ? null : initialPosition;
    try {
      await _player.setAudioSource(
        AudioSource.uri(uri),
        initialPosition: pos,
      );
      if (kIsWeb && initialPosition != null && initialPosition > Duration.zero) {
        try {
          await _player.seek(initialPosition);
        } catch (_) {}
      }
    } catch (e, st) {
      debugPrint('setSourceUrl failed: $e\n$st');
      rethrow;
    }
  }

  static Uri _parseAudioUri(String url) {
    final parsed = Uri.tryParse(url);
    if (parsed != null && parsed.hasScheme) return parsed;
    return Uri.parse(url);
  }

  Future<void> setMetadataFromSong(models.Song? song, {bool playing = false}) async {
    if (song == null) {
      mediaItem.add(null);
      return;
    }
    mediaItem.add(
      MediaItem(
        id: song.songKey,
        title: song.name,
        artist: song.artist,
        album: song.album,
        artUri: (song.pic != null && song.pic!.startsWith('http'))
            ? Uri.tryParse(song.pic!)
            : null,
        duration: song.duration != null
            ? Duration(milliseconds: (song.duration! * 1000).round())
            : null,
        playable: true,
      ),
    );
    _broadcastState(_player.playbackEvent);
  }

  void setControlFlags({
    bool? play,
    bool? skip,
    bool? seek,
  }) {
    if (play != null) playBound = play;
    if (skip != null) skipBound = skip;
    if (seek != null) seekBound = seek;
    _broadcastState(_player.playbackEvent);
  }

  @override
  Future<void> play() async {
    if (!playBound) return;
    onMediaAction?.call(MediaControlAction.play);
    await _player.play();
  }

  @override
  Future<void> pause() async {
    if (!playBound) return;
    onMediaAction?.call(MediaControlAction.pause);
    await _player.pause();
  }

  @override
  Future<void> skipToNext() async {
    if (!skipBound) return;
    onMediaAction?.call(MediaControlAction.skipToNext);
  }

  @override
  Future<void> skipToPrevious() async {
    if (!skipBound) return;
    onMediaAction?.call(MediaControlAction.skipToPrevious);
  }

  @override
  Future<void> seek(Duration position) async {
    if (!seekBound) return;
    await _player.seek(position);
  }

  @override
  Future<void> stop() async {
    await _player.stop();
    await super.stop();
  }

  Future<void> softSeek(Duration position) => _player.seek(position);

  Future<void> softPlay() => _player.play();

  Future<void> softPause() => _player.pause();

  void _broadcastState(PlaybackEvent event) {
    final playing = _player.playing;
    try {
      playbackState.add(
        PlaybackState(
          controls: [
            if (skipBound) MediaControl.skipToPrevious,
            if (playBound) (playing ? MediaControl.pause : MediaControl.play),
            if (skipBound) MediaControl.skipToNext,
          ],
          systemActions: {
            if (seekBound) MediaAction.seek,
            if (playBound) MediaAction.play,
            if (playBound) MediaAction.pause,
            if (skipBound) MediaAction.skipToNext,
            if (skipBound) MediaAction.skipToPrevious,
          },
          androidCompactActionIndices: const [0, 1, 2],
          processingState: const {
            ProcessingState.idle: AudioProcessingState.idle,
            ProcessingState.loading: AudioProcessingState.loading,
            ProcessingState.buffering: AudioProcessingState.buffering,
            ProcessingState.ready: AudioProcessingState.ready,
            ProcessingState.completed: AudioProcessingState.completed,
          }[_player.processingState]!,
          playing: playing,
          updatePosition: _player.position,
          bufferedPosition: _player.bufferedPosition,
          speed: _player.speed,
          queueIndex: event.currentIndex,
        ),
      );
    } catch (_) {
      // Bare handler on web may not have an active audio_service session.
    }
  }
}
