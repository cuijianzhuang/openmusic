import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:openmusic/core/config.dart';
import 'package:openmusic/core/session.dart';

const socketAckTimeout = Duration(milliseconds: 8000);

/// Singleton Socket.IO client aligned with web `useSocket.ts`.
class OmSocket {
  OmSocket._();

  static io.Socket? _socket;
  static bool _connectRequested = false;

  static io.Socket get raw {
    _socket ??= io.io(
      AppConfig.serverUrl,
      io.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          .disableAutoConnect()
          // Cross-origin Flutter web (e.g. :57920 → :4000) must send session cookies.
          .enableWithCredentials()
          .setAuth({'presenceUpdates': true})
          .enableReconnection()
          .setReconnectionAttempts(999999)
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(8000)
          .build(),
    );
    return _socket!;
  }

  static Future<io.Socket> ensureReady({bool forceBootstrap = false}) async {
    await SessionBootstrap.require(force: forceBootstrap);
    final s = raw;
    if (s.connected) return s;
    _connectRequested = true;
    await _waitConnected(s);
    return s;
  }

  static Future<void> _waitConnected(
    io.Socket s, {
    Duration timeout = socketAckTimeout,
  }) async {
    if (s.connected) return;
    final completer = Completer<void>();
    Timer? timer;
    void onConnect(_) {
      timer?.cancel();
      s.off('connect', onConnect);
      if (!completer.isCompleted) completer.complete();
    }

    timer = Timer(timeout, () {
      s.off('connect', onConnect);
      if (!completer.isCompleted) {
        completer.completeError(TimeoutException('连接超时，请检查网络'));
      }
    });
    s.on('connect', onConnect);
    if (!s.active) s.connect();
    await completer.future;
  }

  /// Emit with ACK timeout; returns decoded map (or empty on null ACK).
  static Future<Map<String, dynamic>> emitAck(
    String event, [
    Map<String, dynamic>? payload,
    Duration timeout = socketAckTimeout,
  ]) async {
    final s = await ensureReady();
    final completer = Completer<Map<String, dynamic>>();
    final timer = Timer(timeout, () {
      if (!completer.isCompleted) {
        completer.completeError(TimeoutException('请求超时: $event'));
      }
    });
    s.emitWithAck(event, payload ?? {}, ack: (dynamic data) {
      timer.cancel();
      if (completer.isCompleted) return;
      if (data is Map) {
        completer.complete(Map<String, dynamic>.from(data));
      } else if (data == null) {
        completer.complete(<String, dynamic>{});
      } else {
        completer.complete({'raw': data});
      }
    });
    return completer.future;
  }

  static void on(String event, void Function(dynamic) handler) {
    raw.on(event, handler);
  }

  static void off(String event, [void Function(dynamic)? handler]) {
    if (handler != null) {
      raw.off(event, handler);
    } else {
      raw.off(event);
    }
  }

  static void disconnect() {
    _socket?.disconnect();
    _connectRequested = false;
  }

  /// Drop socket so next connect uses current [AppConfig.serverUrl].
  static void reset() {
    try {
      _socket?.dispose();
    } catch (_) {
      _socket?.disconnect();
    }
    _socket = null;
    _connectRequested = false;
  }

  static bool get connectRequested => _connectRequested;
}
