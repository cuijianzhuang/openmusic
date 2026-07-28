import 'dart:async';

import 'package:audio_service/audio_service.dart' hide PlaybackState;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:just_audio/just_audio.dart';
import 'package:openmusic/core/media_url.dart';
import 'package:openmusic/data/music_api.dart';
import 'package:openmusic/data/socket_room_repository.dart';
import 'package:openmusic/domain/models.dart';
import 'package:openmusic/domain/permissions.dart';
import 'package:openmusic/playback/audio_handler.dart';

/// Sync engine: load URL, follow room play/pause/seek, drive UI clock.
class PlaybackSyncEngine {
  PlaybackSyncEngine(this._ref) {
    _sub = _ref.listen(roomSessionProvider, (prev, next) {
      unawaited(_onSession(prev, next));
    });
    _wireTimer = Timer.periodic(const Duration(milliseconds: 500), (_) {
      _ensureHandlerWired();
      unawaited(_nudgePlayIfNeeded());
    });
    unawaited(_boot());
  }

  final Ref _ref;
  ProviderSubscription<RoomSessionState>? _sub;
  Timer? _wireTimer;
  StreamSubscription<ProcessingState>? _procSub;
  String? _loadedTrackId;
  String? _loadedUrl;
  int _lastAppliedVersion = -1;
  var _handlerWired = false;
  var _loadInFlight = false;
  DateTime? _lastPlayNudgeAt;
  var _playNudgeFails = 0;
  DateTime? _localSeekHoldUntil;
  Duration? _localSeekHoldPos;
  /// Suppress auto softPlay / remote transport while user toggle settles.
  DateTime? _userTransportHoldUntil;
  static const remoteSeekThresholdSec = 1.25;
  static const localSeekHold = Duration(milliseconds: 4500);
  static const userTransportHold = Duration(milliseconds: 3000);

  void dispose() {
    _sub?.close();
    _wireTimer?.cancel();
    _procSub?.cancel();
  }

  RoomSessionNotifier get _session => _ref.read(roomSessionProvider.notifier);

  Future<void> _boot() async {
    await initOpenMusicAudioService();
    _ensureHandlerWired();
    final session = _ref.read(roomSessionProvider);
    if (session.room != null) {
      await _onSession(null, session);
    }
  }

  void _ensureHandlerWired() {
    final handler = openMusicAudioHandler;
    if (handler == null || _handlerWired) return;
    _handlerWired = true;
    handler.onMediaAction = _onMediaAction;
    _procSub?.cancel();
    _procSub = handler.player.processingStateStream.listen((state) {
      if (state == ProcessingState.completed) {
        unawaited(_onTrackEnded());
      }
    });
  }

  /// Retry softPlay while room is playing but local audio is idle (web autoplay).
  Future<void> _nudgePlayIfNeeded() async {
    final handler = openMusicAudioHandler;
    final session = _ref.read(roomSessionProvider);
    final room = session.room;
    if (handler == null || room == null || room.current == null) return;
    if (_userTransportHoldUntil != null &&
        DateTime.now().isBefore(_userTransportHoldUntil!)) {
      return;
    }
    final shouldPlay = session.playback?.isPlaying ?? room.isPlaying;
    if (!shouldPlay || handler.player.playing) {
      _playNudgeFails = 0;
      return;
    }
    if (_loadedTrackId != room.current!.queueId || _loadInFlight) return;
    // Back off: web autoplay needs a user gesture; don't hammer softPlay (aborts decode).
    final now = DateTime.now();
    final minGap = Duration(milliseconds: 1500 + _playNudgeFails * 1500);
    if (_lastPlayNudgeAt != null && now.difference(_lastPlayNudgeAt!) < minGap) {
      return;
    }
    final proc = handler.player.processingState;
    if (proc == ProcessingState.loading || proc == ProcessingState.buffering) {
      return;
    }
    _lastPlayNudgeAt = now;
    try {
      await handler.softPlay();
      if (handler.player.playing) {
        _playNudgeFails = 0;
      } else {
        _playNudgeFails = (_playNudgeFails + 1).clamp(0, 8);
      }
    } catch (e) {
      _playNudgeFails = (_playNudgeFails + 1).clamp(0, 8);
      debugPrint('softPlay nudge failed: $e');
    }
  }

  Future<void> _onSession(RoomSessionState? prev, RoomSessionState next) async {
    _ensureHandlerWired();
    final room = next.room;
    final handler = openMusicAudioHandler;
    if (handler == null) {
      unawaited(initOpenMusicAudioService().then((_) {
        _ensureHandlerWired();
        final s = _ref.read(roomSessionProvider);
        if (s.room != null) unawaited(_onSession(null, s));
      }));
      return;
    }

    if (room == null) {
      try {
        await handler.stop();
      } catch (_) {}
      _loadedTrackId = null;
      _loadedUrl = null;
      _lastAppliedVersion = -1;
      return;
    }

    final roles = RoomRoles.derive(room, next.mySocketId);
    handler.setControlFlags(
      play: systemPlayBound(room) && canPause(room, roles),
      skip: systemSkipBound(room) && roles.canControlPlayback,
      seek: canSeek(room, roles),
    );

    final current = room.current;
    final shouldPlay = next.playback?.isPlaying ?? room.isPlaying;
    await handler.setMetadataFromSong(current, playing: shouldPlay);

    final pb = next.playback;
    if (pb != null && pb.version != _lastAppliedVersion) {
      await _applyPlaybackState(pb, room, roles);
      _lastAppliedVersion = pb.version;
    } else if (current != null) {
      await _ensureTrackLoaded(current, roles, sharedUrl: pb?.mediaUrl);
      if (_userTransportHoldUntil == null ||
          DateTime.now().isAfter(_userTransportHoldUntil!)) {
        await _syncTransport(shouldPlay);
      }
    }
  }

  Future<void> _syncTransport(bool shouldPlay) async {
    final handler = openMusicAudioHandler;
    if (handler == null) return;
    try {
      if (shouldPlay && !handler.player.playing) {
        await handler.softPlay();
      } else if (!shouldPlay && handler.player.playing) {
        await handler.softPause();
      }
    } catch (e) {
      debugPrint('syncTransport failed: $e');
    }
  }

  Future<void> _applyPlaybackState(
    PlaybackState pb,
    RoomState room,
    RoomRoles roles,
  ) async {
    final handler = openMusicAudioHandler!;
    final current = room.current;
    if (current == null) return;

    if (current.queueId != pb.trackId) {
      await _ensureTrackLoaded(current, roles, sharedUrl: pb.mediaUrl);
      return;
    }

    await _ensureTrackLoaded(current, roles, sharedUrl: pb.mediaUrl);

    final target = pb.estimatedPosition();
    final local = handler.player.position.inMilliseconds / 1000.0;
    final holdingLocalSeek = _localSeekHoldUntil != null &&
        DateTime.now().isBefore(_localSeekHoldUntil!);
    final holdingUserTransport = _userTransportHoldUntil != null &&
        DateTime.now().isBefore(_userTransportHoldUntil!);

    // Never yank the scrubber back while the user is dragging / just sought.
    if (!holdingLocalSeek) {
      final drift = (target - local).abs();
      if (drift > remoteSeekThresholdSec) {
        try {
          await handler.softSeek(
            Duration(milliseconds: (target * 1000).round().clamp(0, 1 << 30)),
          );
        } catch (e) {
          debugPrint('softSeek failed: $e');
        }
      }
    }

    if (!holdingUserTransport) {
      await _syncTransport(pb.isPlaying);
    }
  }

  Future<void> _ensureTrackLoaded(
    QueueItem song,
    RoomRoles roles, {
    String? sharedUrl,
  }) async {
    final handler = openMusicAudioHandler!;
    if (_loadedTrackId == song.queueId && _loadedUrl != null) return;
    if (_loadInFlight) return;
    _loadInFlight = true;
    try {
      String? url = sharedUrl;
      String? quality;
      // Web: prefer lossy re-resolve even if leader shared a hi-res/flac CDN link.
      final sharedLooksHiRes = url != null &&
          (url.contains('.flac') ||
              url.contains('jyeffect') ||
              url.contains('hires'));
      if (kIsWeb && sharedLooksHiRes) {
        url = null;
      }
      if (url == null || url.isEmpty) {
        try {
          final info = await MusicApi.getSongUrl(song);
          url = info.url;
          quality = info.qualityLabel;
        } catch (e) {
          debugPrint('getSongUrl failed: $e');
          if (roles.isPlaybackLeader) {
            try {
              await _session.skipSong();
            } catch (_) {}
          }
          return;
        }
      }

      if (url.isEmpty) return;

      final playUrl = await resolvePlaybackAudioUrl(url);
      if (playUrl.isEmpty) return;

      final wasPlaying = _ref.read(roomSessionProvider).room?.isPlaying ?? false;
      final pb = _ref.read(roomSessionProvider).playback;
      Duration? initial;
      if (pb != null && pb.trackId == song.queueId) {
        initial = Duration(
          milliseconds: (pb.estimatedPosition() * 1000).round().clamp(0, 1 << 30),
        );
      }

      debugPrint(
        'load track ${song.name} → ${playUrl.length > 80 ? '${playUrl.substring(0, 80)}…' : playUrl}',
      );
      try {
        await handler.setSourceUrl(
          playUrl,
          item: MediaItem(
            id: song.queueId,
            title: song.name,
            artist: song.artist,
            artUri: song.pic != null ? Uri.tryParse(song.pic!) : null,
            duration: song.duration != null && song.duration! > 0
                ? Duration(
                    milliseconds: (_normalizeDurationSec(song.duration!) * 1000)
                        .round(),
                  )
                : null,
          ),
          initialPosition: initial,
        );
      } catch (e) {
        debugPrint('setSourceUrl error, clearing load state: $e');
        _loadedTrackId = null;
        _loadedUrl = null;
        return;
      }
      _loadedTrackId = song.queueId;
      _loadedUrl = playUrl;

      if (wasPlaying) {
        await _syncTransport(true);
      }

      if (roles.isPlaybackLeader && url.isNotEmpty) {
        try {
          await _session.reportPlaybackMedia(
            trackId: song.queueId,
            url: url, // report original CDN url for other clients
            qualityLabel: quality,
          );
        } catch (_) {}
      }
    } finally {
      _loadInFlight = false;
    }
  }

  static double _normalizeDurationSec(double raw) {
    // Some payloads send milliseconds.
    if (raw > 10000) return raw / 1000.0;
    return raw;
  }

  Future<void> _onTrackEnded() async {
    final session = _ref.read(roomSessionProvider);
    final roles = session.rolesOrNull;
    if (roles == null || !roles.isPlaybackLeader) return;
    try {
      await _session.finishSong();
    } catch (_) {}
  }

  void _onMediaAction(MediaControlAction action) {
    final session = _ref.read(roomSessionProvider);
    final room = session.room;
    final roles = session.rolesOrNull;
    if (room == null || roles == null) return;
    switch (action) {
      case MediaControlAction.play:
      case MediaControlAction.pause:
        if (canPause(room, roles)) {
          unawaited(_session.togglePlay(action == MediaControlAction.play));
        }
      case MediaControlAction.skipToNext:
        if (roles.canControlPlayback) {
          unawaited(_session.skipSong());
        }
      case MediaControlAction.skipToPrevious:
        if (canSeek(room, roles)) {
          unawaited(_session.seek(0));
        }
    }
  }

  Future<void> seekLocalAndRemote(Duration position) async {
    final session = _ref.read(roomSessionProvider);
    final room = session.room;
    final roles = session.rolesOrNull;
    if (room == null || roles == null || !canSeek(room, roles)) return;
    final clamped = position < Duration.zero ? Duration.zero : position;
    final fallbackSec = session.playback?.estimatedPosition() ?? room.currentTime;
    holdSeekPreview(clamped);
    _session.applyOptimisticSeek(clamped.inMilliseconds / 1000.0);
    // Local seek first; network in background so scrubber never waits.
    unawaited(() async {
      try {
        await openMusicAudioHandler?.softSeek(clamped);
      } catch (_) {}
    }());
    unawaited(() async {
      final res = await _session.seek(clamped.inMilliseconds / 1000.0);
      if (res['success'] == true) return;
      _localSeekHoldUntil = null;
      _localSeekHoldPos = null;
      _session.applyOptimisticSeek(fallbackSec);
      try {
        await openMusicAudioHandler?.softSeek(
          Duration(milliseconds: (fallbackSec * 1000).round().clamp(0, 1 << 30)),
        );
      } catch (_) {}
      debugPrint('seek rejected: ${res['error']}');
    }());
  }

  /// While finger is on the scrubber — pin UI clock, no socket yet.
  void holdSeekPreview(Duration position) {
    final clamped = position < Duration.zero ? Duration.zero : position;
    _localSeekHoldPos = clamped;
    _localSeekHoldUntil = DateTime.now().add(localSeekHold);
  }

  /// UI clock may prefer this right after a user seek.
  Duration? get localSeekHoldPosition {
    if (_localSeekHoldUntil == null ||
        DateTime.now().isAfter(_localSeekHoldUntil!)) {
      return null;
    }
    return _localSeekHoldPos;
  }

  Future<void> togglePlayLocalAndRemote(bool play) async {
    final session = _ref.read(roomSessionProvider);
    final room = session.room;
    final roles = session.rolesOrNull;
    if (room == null || roles == null || !canPause(room, roles)) return;

    final current = room.current;
    final handler = openMusicAudioHandler;
    final localMs = handler?.player.position.inMilliseconds ?? 0;
    final resumeSec = localMs > 350
        ? localMs / 1000.0
        : (session.playback?.estimatedPosition() ?? room.currentTime);

    _userTransportHoldUntil = DateTime.now().add(userTransportHold);
    if (!play && localMs > 0) {
      holdSeekPreview(Duration(milliseconds: localMs));
    }

    // 1) Optimistic UI — button flips immediately.
    _session.applyOptimisticPlaying(play);

    // 2) Local audio without blocking the tap handler on network.
    try {
      if (play) {
        if (current != null &&
            (_loadedTrackId != current.queueId || _loadedUrl == null)) {
          // Only block when we truly have no source.
          await _ensureTrackLoaded(
            current,
            roles,
            sharedUrl: session.playback?.mediaUrl,
          );
        }
        final localNow = handler?.player.position.inMilliseconds ?? 0;
        if (resumeSec > 0.35 && (localNow - resumeSec * 1000).abs() > 800) {
          try {
            await handler?.softSeek(
              Duration(
                milliseconds: (resumeSec * 1000).round().clamp(0, 1 << 30),
              ),
            );
          } catch (_) {}
        }
        await handler?.softPlay();
      } else {
        await handler?.softPause();
      }
    } catch (e) {
      debugPrint('toggle local play failed: $e');
    }

    // 3) Server ack in background — rollback only on failure.
    unawaited(() async {
      final res = await _session.togglePlay(play);
      if (res['success'] != true) {
        _session.applyOptimisticPlaying(!play);
        try {
          if (play) {
            await handler?.softPause();
          } else {
            await handler?.softPlay();
          }
        } catch (_) {}
        _userTransportHoldUntil = null;
        debugPrint('toggle_play rejected: ${res['error']}');
      }
    }());
  }

  /// User-gesture unlock for web autoplay (does not change room play state).
  Future<void> unlockLocalAudio() async {
    final session = _ref.read(roomSessionProvider);
    final room = session.room;
    final roles = session.rolesOrNull;
    final current = room?.current;
    if (room == null || roles == null || current == null) return;
    await _ensureTrackLoaded(
      current,
      roles,
      sharedUrl: session.playback?.mediaUrl,
    );
    final pb = session.playback;
    if (pb != null && pb.trackId == current.queueId) {
      try {
        await openMusicAudioHandler?.softSeek(
          Duration(
            milliseconds: (pb.estimatedPosition() * 1000).round().clamp(0, 1 << 30),
          ),
        );
      } catch (_) {}
    }
    try {
      await openMusicAudioHandler?.softPlay();
    } catch (e) {
      debugPrint('unlockLocalAudio failed: $e');
    }
  }
}

final playbackSyncProvider = Provider<PlaybackSyncEngine>((ref) {
  final engine = PlaybackSyncEngine(ref);
  ref.onDispose(engine.dispose);
  return engine;
});

/// UI clock: prefer local just_audio when playing; else room estimatedPosition.
final playerPositionProvider = StreamProvider<Duration>((ref) {
  ref.watch(playbackSyncProvider);
  // Re-subscribe when room / playback identity changes.
  ref.watch(roomSessionProvider.select((s) => s.room?.current?.queueId));
  ref.watch(roomSessionProvider.select((s) => s.playback?.version));
  ref.watch(roomSessionProvider.select((s) => s.room?.isPlaying));

  return Stream<Duration>.periodic(const Duration(milliseconds: 200), (_) {
    final engine = ref.read(playbackSyncProvider);
    final held = engine.localSeekHoldPosition;
    if (held != null) return held;

    final session = ref.read(roomSessionProvider);
    final handler = openMusicAudioHandler;
    final pb = session.playback;
    final room = session.room;
    final currentId = room?.current?.queueId;
    final roomPlaying = room?.isPlaying == true || pb?.isPlaying == true;

    // Local just_audio only when it is actually advancing.
    if (handler != null && handler.player.playing) {
      final local = handler.player.position;
      // If room clock is far ahead and local stuck at ~0, prefer room (failed decode).
      if (pb != null &&
          roomPlaying &&
          (currentId == null || currentId == pb.trackId)) {
        final remoteMs = (pb.estimatedPosition() * 1000).round();
        if (local.inMilliseconds < 500 && remoteMs > 2000) {
          return Duration(milliseconds: remoteMs.clamp(0, 86400000));
        }
      }
      return local;
    }

    if (pb != null && (currentId == null || currentId == pb.trackId)) {
      final sec = pb.estimatedPosition();
      return Duration(milliseconds: (sec * 1000).round().clamp(0, 86400000));
    }
    if (room != null && room.current != null) {
      return Duration(
        milliseconds: (room.currentTime * 1000).round().clamp(0, 86400000),
      );
    }
    return handler?.player.position ?? Duration.zero;
  });
});

final playerDurationProvider = StreamProvider<Duration?>((ref) {
  ref.watch(playbackSyncProvider);
  ref.watch(roomSessionProvider.select((s) => s.room?.current?.queueId));
  ref.watch(roomSessionProvider.select((s) => s.playback?.durationSec));
  ref.watch(roomSessionProvider.select((s) => s.room?.current?.duration));

  return Stream<Duration?>.periodic(const Duration(milliseconds: 500), (_) {
    final handler = openMusicAudioHandler;
    final local = handler?.player.duration;
    if (local != null && local > Duration.zero) return local;
    final session = ref.read(roomSessionProvider);
    final raw = session.playback?.durationSec ?? session.room?.current?.duration;
    if (raw != null && raw > 0) {
      final sec = raw > 10000 ? raw / 1000.0 : raw;
      return Duration(milliseconds: (sec * 1000).round());
    }
    return null;
  });
});
