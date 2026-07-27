import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:proxer/src/services/protocol/frame.dart';
import 'package:proxer/src/services/protocol/tunnel_connection.dart';
import 'package:proxer/src/util/headers.dart';

class LocalForwarders {
  LocalForwarders({
    required this.connection,
    required this.localPort,
    this.log,
    this.logError,
  }) {
    _subscription = connection.frames.listen(_handleFrame);
  }

  final TunnelConnection connection;
  final int localPort;
  final void Function(String message)? log;
  final void Function(String message)? logError;
  final HttpClient _httpClient = HttpClient();
  final Map<String, Future<HttpClientRequest>> _requests = {};
  final Map<String, Socket> _sockets = {};
  late final StreamSubscription<TunnelFrame> _subscription;

  void _handleFrame(TunnelFrame frame) {
    switch (frame) {
      case OpenFrame() when frame.kind == 'http':
        _openHttp(frame);
      case OpenFrame() when frame.kind == 'websocket':
        unawaited(_openWebSocket(frame));
      case DataFrame() when frame.direction == 'request':
        unawaited(_writeRequestData(frame));
      case EndFrame() when frame.direction == 'request':
        unawaited(_endRequest(frame));
      case CloseFrame():
        unawaited(_closeStream(frame.streamId));
      default:
        break;
    }
  }

  void _openHttp(OpenFrame frame) {
    final uri = Uri.parse('http://127.0.0.1:$localPort${frame.path}');
    final requestFuture = _httpClient.openUrl(frame.method, uri);
    _requests[frame.streamId] = requestFuture;
    unawaited(
      requestFuture
          .then((request) {
            for (final entry in frame.headers.entries) {
              request.headers.set(entry.key, entry.value);
            }
          })
          .catchError((Object error) async {
            final _ = _requests.remove(frame.streamId);
            logError?.call(
              '${frame.method} ${frame.path} local error ${_errorCode(error)}',
            );
            await _send(
              ErrorFrame(streamId: frame.streamId, message: '$error'),
            );
          }),
    );
    log?.call('${frame.method} ${frame.path} -> local 127.0.0.1:$localPort');
  }

  Future<void> _writeRequestData(DataFrame frame) async {
    final socket = _sockets[frame.streamId];
    if (socket != null) {
      socket.add(base64.decode(frame.data));
      return;
    }
    final request = await _requests[frame.streamId];
    request?.add(base64.decode(frame.data));
  }

  Future<void> _endRequest(EndFrame frame) async {
    final socket = _sockets[frame.streamId];
    if (socket != null) {
      await socket.flush();
      return;
    }
    final requestFuture = _requests[frame.streamId];
    if (requestFuture == null) {
      return;
    }
    try {
      final request = await requestFuture;
      final response = await request.close();
      await _send(
        HeadersFrame(
          streamId: frame.streamId,
          status: response.statusCode,
          headers: stripHttpHopByHopHeaders(
            normalizeIncomingHeaders(response.headers),
          ),
        ),
      );
      await for (final chunk in response) {
        await _send(
          DataFrame(
            streamId: frame.streamId,
            direction: 'response',
            data: base64.encode(chunk),
          ),
        );
      }
      final _ = _requests.remove(frame.streamId);
      await _send(EndFrame(streamId: frame.streamId, direction: 'response'));
    } on Object catch (error) {
      final _ = _requests.remove(frame.streamId);
      await _send(ErrorFrame(streamId: frame.streamId, message: '$error'));
    }
  }

  Future<void> _openWebSocket(OpenFrame frame) async {
    try {
      final socket = await Socket.connect('127.0.0.1', localPort);
      _sockets[frame.streamId] = socket;
      socket.write(
        '${frame.method} ${frame.path} HTTP/1.1\r\n'
        '${serializeHeadersForRawHttp(frame.headers)}'
        '\r\n',
      );
      await socket.flush();
      log?.call('WS ${frame.path} -> local 127.0.0.1:$localPort opened');
      socket.listen(
        (chunk) {
          unawaited(
            _send(
              DataFrame(
                streamId: frame.streamId,
                direction: 'response',
                data: base64.encode(chunk),
              ),
            ),
          );
        },
        onDone: () async {
          if (_sockets.remove(frame.streamId) != null) {
            await _send(
              EndFrame(streamId: frame.streamId, direction: 'response'),
            );
          }
        },
        onError: (Object error) async {
          _sockets.remove(frame.streamId);
          await _send(ErrorFrame(streamId: frame.streamId, message: '$error'));
        },
        cancelOnError: false,
      );
    } on Object catch (error) {
      logError?.call('WS ${frame.path} local error ${_errorCode(error)}');
      await _send(ErrorFrame(streamId: frame.streamId, message: '$error'));
    }
  }

  Future<void> _closeStream(String streamId) async {
    final requestFuture = _requests.remove(streamId);
    if (requestFuture != null) {
      try {
        (await requestFuture).abort();
      } on Object {
        // The request already failed or completed.
      }
    }
    final socket = _sockets.remove(streamId);
    socket?.destroy();
  }

  Future<void> _send(TunnelFrame frame) async {
    try {
      await connection.send(frame);
    } on Object {
      // The lifecycle listener owns reconnect and cleanup.
    }
  }

  Future<void> close() async {
    await _subscription.cancel();
    for (final streamId in {..._requests.keys, ..._sockets.keys}) {
      await _closeStream(streamId);
    }
    _httpClient.close(force: true);
  }
}

String _errorCode(Object error) {
  return error is SocketException
      ? 'OS_ERROR_${error.osError?.errorCode ?? "socket"}'
      : 'error';
}
