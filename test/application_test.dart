import 'package:proxer/src/application.dart';
import 'package:proxer/src/util/version.dart';
import 'package:test/test.dart';

import 'helpers/capture_stream.dart';

Future<({int code, String stdout, String stderr})> _run(
  List<String> args, {
  Map<String, String>? environment,
}) async {
  final stdout = CaptureStream();
  final stderr = CaptureStream();
  final code = await runCli(
    args,
    stdout: stdout,
    stderr: stderr,
    environment: environment,
  );
  return (code: code, stdout: stdout.text, stderr: stderr.text);
}

void main() {
  test('reports the native package version', () async {
    final result = await _run(['--version']);
    expect(result.code, 0);
    expect(result.stdout, 'proxer $currentVersion\n');
    expect(result.stderr, '');
  });

  test('renders the composed command tree', () async {
    final result = await _run(['--help']);
    expect(result.code, 0);
    expect(result.stdout, contains('proxer server'));
    expect(result.stdout, contains('proxer http'));
    expect(result.stdout, contains('proxer skill install'));
    expect(result.stderr, '');
  });

  test('keeps the missing client token error and exit code', () async {
    final result = await _run(['http', '3000'], environment: {});
    expect(result.code, 1);
    expect(result.stdout, '');
    expect(result.stderr, 'token is required\n');
  });

  test('rejects a malformed local port during argument parsing', () async {
    final result = await _run(
      ['http', 'not-a-port'],
      environment: {'PROXER_TOKEN': 'secret'},
    );
    expect(result.code, -4);
    expect(result.stderr, contains('local port must be a number'));
  });
}
