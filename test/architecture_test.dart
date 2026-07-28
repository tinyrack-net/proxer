import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:test/test.dart';

const Map<String, Set<String>> _allowed = {
  'cli': {'services', 'config', 'util', 'assets'},
  'services': {'config', 'util', 'assets'},
  'config': {'util'},
  'util': <String>{},
  'assets': <String>{},
};

String? _layer(String path) {
  return RegExp(r'^lib/src/([^/]+)/').firstMatch(path)?.group(1);
}

void main() {
  final sources = Directory('lib/src')
      .listSync(recursive: true)
      .whereType<File>()
      .where((file) => file.path.endsWith('.dart'))
      .toList();

  test('lib/src has sources to check', () {
    expect(sources, isNotEmpty);
  });

  test('source imports follow the declared layering', () {
    final violations = <String>[];
    for (final file in sources) {
      final relative = p.posix.joinAll(p.split(p.relative(file.path)));
      final from = _layer(relative);
      if (from == null) {
        continue;
      }
      final allowed = _allowed[from];
      expect(allowed, isNotNull, reason: 'declare the new $from layer');
      for (final match in RegExp(
        r"import 'package:proxer/src/([^/']+)/",
      ).allMatches(file.readAsStringSync())) {
        final to = match.group(1)!;
        if (to != from && !allowed!.contains(to)) {
          violations.add('$relative -> src/$to/');
        }
      }
    }
    expect(violations, isEmpty);
  });
}
