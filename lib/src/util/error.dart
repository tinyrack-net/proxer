import 'dart:io';

class ProxerError implements Exception {
  ProxerError(this.message, {this.exitCode = 1})
    : stackTrace = Platform.environment['PROXER_DEBUG'] == '1'
          ? StackTrace.current
          : null;

  final String message;

  final int exitCode;

  final StackTrace? stackTrace;

  @override
  String toString() => message;
}

String formatProxerError(Object? error) {
  if (error is ProxerError) {
    final trace = error.stackTrace;
    return trace == null ? error.message : '${error.message}\n$trace';
  }
  if (error is Exception || error is Error) {
    return '$error';
  }
  return '$error';
}
