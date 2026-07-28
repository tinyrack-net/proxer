import 'dart:io';

import 'package:path/path.dart' as p;

Future<void> main() async {
  final packageRoot = p.normalize(
    p.join(p.dirname(Platform.script.toFilePath()), '..'),
  );
  final output = p.join(
    packageRoot,
    Platform.isWindows ? 'proxer-e2e.exe' : 'proxer-e2e',
  );

  final process = await Process.start(
    Platform.resolvedExecutable,
    ['compile', 'exe', 'bin/proxer.dart', '-o', output],
    workingDirectory: packageRoot,
    mode: ProcessStartMode.inheritStdio,
  );
  final exitCode = await process.exitCode;
  if (exitCode != 0) {
    exit(exitCode);
  }
}
