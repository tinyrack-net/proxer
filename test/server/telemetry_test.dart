import 'package:proxer/src/services/server/telemetry.dart';
import 'package:test/test.dart';

void main() {
  group('isTelemetryEnabled', () {
    test('requires an OTLP endpoint', () {
      expect(isTelemetryEnabled({}), isFalse);
    });

    test('accepts the standard OTLP endpoint', () {
      expect(
        isTelemetryEnabled({
          'OTEL_EXPORTER_OTLP_ENDPOINT': 'http://collector:4318',
        }),
        isTrue,
      );
    });

    test('honors the standard SDK disable switch', () {
      expect(
        isTelemetryEnabled({
          'OTEL_EXPORTER_OTLP_ENDPOINT': 'http://collector:4318',
          'OTEL_SDK_DISABLED': 'true',
        }),
        isFalse,
      );
    });
  });
}
