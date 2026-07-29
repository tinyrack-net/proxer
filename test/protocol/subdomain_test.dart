import 'package:proxer/src/services/protocol/subdomain.dart';
import 'package:proxer/src/util/error.dart';
import 'package:test/test.dart';

void main() {
  test('normalizes only casing, without validating shape', () {
    expect(normalizeTunnelSubdomain('DEMO'), 'demo');
    expect(normalizeTunnelSubdomain('de_mo'), 'de_mo');
  });

  test('accepts single-character and 63-character labels', () {
    expect(isTunnelSubdomain('a'), isTrue);
    expect(isTunnelSubdomain('a' * 63), isTrue);
  });

  test('rejects uppercase input without prior normalization', () {
    expect(isTunnelSubdomain('DEMO'), isFalse);
  });

  test('rejects empty, hyphen-edged, dotted, and over-length labels', () {
    for (final value in <String>['', '-demo', 'demo-', 'de.mo', 'a' * 64]) {
      expect(isTunnelSubdomain(value), isFalse, reason: 'value="$value"');
    }
  });

  test('rejects non-string values passed to isTunnelSubdomain', () {
    expect(isTunnelSubdomain(null), isFalse);
    expect(isTunnelSubdomain(123), isFalse);
  });

  test('parses and normalizes a valid mixed-case subdomain', () {
    expect(parseHttpSubdomain('DEMO'), 'demo');
  });

  test(
    'throws ProxerError with the shared rule message for invalid input',
    () {
      for (final value in <String>[
        '',
        '-demo',
        'demo-',
        'de_mo',
        'de.mo',
        'a' * 64,
      ]) {
        expect(
          () => parseHttpSubdomain(value),
          throwsA(
            isA<ProxerError>().having(
              (e) => e.message,
              'message',
              subdomainRuleMessage,
            ),
          ),
          reason: 'value="$value"',
        );
      }
    },
  );
}
