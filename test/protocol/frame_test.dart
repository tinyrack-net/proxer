import 'dart:io';

import 'package:proxer/src/services/protocol/frame.dart';
import 'package:test/test.dart';

void main() {
  test('round-trips every observable registration field', () {
    const frame = RegisterFrame(
      subdomain: 'demo',
      mode: RouteMode.cluster,
      token: 'secret',
      basicAuth: BasicAuthConfig(password: 'pass', username: 'user'),
    );
    final decoded = decodeFrame(encodeFrame(frame));
    expect(decoded, isA<RegisterFrame>());
    final register = decoded as RegisterFrame;
    expect(register.subdomain, 'demo');
    expect(register.mode, RouteMode.cluster);
    expect(register.token, 'secret');
    expect(register.basicAuth?.username, 'user');
  });

  test('rejects removed and malformed wire fields', () {
    expect(
      () => decodeFrame('{"type":"register","name":"old"}'),
      throwsA(isA<ProtocolError>()),
    );
    expect(
      () => decodeFrame(
        '{"type":"data","streamId":"s","direction":"response","data":"!"}',
      ),
      throwsA(isA<ProtocolError>()),
    );
  });

  test('keeps the TypeScript wire protocol byte-exact', () {
    final lines = File(
      'test/goldens/protocol_frames.jsonl',
    ).readAsLinesSync().where((line) => line.isNotEmpty);

    for (final line in lines) {
      expect(encodeFrame(decodeFrame(line)), line);
    }
  });
}
