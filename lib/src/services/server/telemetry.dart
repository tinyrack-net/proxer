import 'dart:io';

import 'package:dartastic_opentelemetry/dartastic_opentelemetry.dart';
import 'package:proxer/src/util/headers.dart';

bool _initialized = false;
final W3CTraceContextPropagator _traceContextPropagator =
    W3CTraceContextPropagator();

bool isTelemetryEnabled(Map<String, String> environment) {
  final endpoint = environment['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim();
  final disabled = environment['OTEL_SDK_DISABLED']?.trim().toLowerCase();
  return endpoint != null && endpoint.isNotEmpty && disabled != 'true';
}

Future<void> initializeServerTelemetry() async {
  if (_initialized || !isTelemetryEnabled(Platform.environment)) return;
  await OTel.initialize(
    enableLogs: false,
    enableMetrics: false,
    tracerName: 'proxer.server',
  );
  _initialized = true;
}

Future<void> shutdownServerTelemetry() async {
  if (!_initialized) return;
  _initialized = false;
  await OTel.shutdown();
}

Future<void> traceTunnelHttpRequest(
  HttpRequest request,
  Future<void> Function() operation,
) async {
  if (!_initialized) {
    await operation();
    return;
  }

  final incomingHeaders = <String, String>{};
  for (final name in _traceContextPropagator.fields()) {
    final value = request.headers.value(name);
    if (value != null) incomingHeaders[name] = value;
  }
  final parentContext = _traceContextPropagator.extract(
    OTel.context(),
    incomingHeaders,
    _StringMapGetter(incomingHeaders),
  );

  await parentContext.run(() async {
    final tracer = OTel.tracer();
    final span = tracer.startSpan(
      '${request.method} proxer.tunnel',
      kind: SpanKind.server,
      attributes: OTel.attributesFromMap({
        'http.request.method': request.method,
        'http.route': 'proxer.tunnel',
      }),
    );
    try {
      await tracer.withSpanAsync(span, operation);
      final statusCode = request.response.statusCode;
      span.addAttributes(
        OTel.attributesFromMap({'http.response.status_code': statusCode}),
      );
      if (statusCode >= HttpStatus.internalServerError) {
        span.setStatus(SpanStatusCode.Error, 'HTTP $statusCode');
      }
    } catch (error) {
      span.setStatus(SpanStatusCode.Error, error.toString());
      rethrow;
    } finally {
      span.end();
    }
  });
}

void injectCurrentTraceContext(HeaderMap headers) {
  if (!_initialized) return;
  final carrier = <String, String>{};
  _traceContextPropagator.inject(
    Context.current,
    carrier,
    _StringMapSetter(carrier),
  );
  for (final entry in carrier.entries) {
    headers[entry.key] = [entry.value];
  }
}

class _StringMapGetter implements TextMapGetter<String> {
  const _StringMapGetter(this.headers);

  final Map<String, String> headers;

  @override
  String? get(String key) => headers[key];

  @override
  Iterable<String> keys() => headers.keys;
}

class _StringMapSetter extends TextMapSetter<String> {
  _StringMapSetter(this.headers);

  final Map<String, String> headers;

  @override
  void set(String key, String value) {
    headers[key] = value;
  }
}
