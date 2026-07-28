import 'dart:async';
import 'dart:io';

import 'package:proxer/src/services/protocol/frame.dart';

class TunnelConnection {
  TunnelConnection(this.socket) {
    _subscription = socket.listen(
      (payload) {
        if (payload == null) {
          return;
        }
        try {
          _frames.add(decodeFrame(payload as Object));
        } on ProtocolError catch (error) {
          _closeError = error;
          unawaited(socket.close(1002, error.message));
        }
      },
      onError: (Object error, StackTrace stackTrace) {
        _closeError = error;
      },
      onDone: () async {
        _closed.add(_closeError);
        await _frames.close();
        await _closed.close();
      },
      cancelOnError: false,
    );
  }

  final WebSocket socket;
  final StreamController<TunnelFrame> _frames =
      StreamController<TunnelFrame>.broadcast(sync: true);
  final StreamController<Object?> _closed = StreamController<Object?>.broadcast(
    sync: true,
  );
  late final StreamSubscription<Object?> _subscription;
  Object? _closeError;

  Stream<TunnelFrame> get frames => _frames.stream;
  Stream<Object?> get closed => _closed.stream;

  Future<void> send(TunnelFrame frame) async {
    socket.add(encodeFrame(frame));
  }

  Future<void> close([int? code, String? reason]) async {
    if (socket.readyState == WebSocket.closed) {
      return;
    }
    await socket.close(code, reason);
  }

  Future<void> dispose() async {
    await _subscription.cancel();
    await close();
  }

  Object? get closeError => _closeError;
}
