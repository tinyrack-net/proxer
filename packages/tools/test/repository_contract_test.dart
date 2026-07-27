import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:proxer_tools/src/lib/git.dart';
import 'package:test/test.dart';
import 'package:yaml/yaml.dart';

void main() {
  test('repository YAML files parse after the Dart cutover', () async {
    final root = await getRepoRoot(Directory.current.path);
    for (final relativePath in [
      p.join('.github', 'actions', 'setup', 'action.yml'),
      p.join('.github', 'workflows', 'deploy-homepage.yml'),
      p.join('.github', 'workflows', 'pipeline.yml'),
      p.join('snap', 'snapcraft.yaml'),
    ]) {
      final source = File(p.join(root, relativePath)).readAsStringSync();
      expect(() => loadYaml(source), returnsNormally, reason: relativePath);
    }
  });

  test(
    'pipeline keeps native and Docker distribution without Node packaging',
    () async {
      final root = await getRepoRoot(Directory.current.path);
      final source = File(
        p.join(root, '.github', 'workflows', 'pipeline.yml'),
      ).readAsStringSync();

      expect(source, contains('dart compile exe'));
      expect(source, contains('docker-smoke:'));
      expect(source, contains('publish-docker:'));
      expect(source, contains("'tinyrack.proxer'"));
      expect(source, contains("'CN=tinyrack'"));
      expect(source, contains("'tinyrack'"));
      expect(source, isNot(contains('secrets.MSIX_IDENTITY_NAME')));
      expect(source, isNot(contains('secrets.MSIX_PUBLISHER')));
      expect(source, isNot(contains('node24-')));
      expect(source, isNot(contains('autocomplete-shell-smoke')));
    },
  );
}
