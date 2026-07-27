import 'dart:io';

import 'package:proxer_tools/src/lib/args.dart';
import 'package:proxer_tools/src/lib/git.dart';
import 'package:proxer_tools/src/lib/smoke.dart';

Future<int> runSmokeCommand(List<String> args) async {
  final parsed = parseArgs(args, valueOptions: const {'executable-path'});
  final repoRoot = await getRepoRoot(Directory.current.path);

  await performSmoke(
    repoRoot: repoRoot,
    executablePath: parsed.requireOption('executable-path'),
  );

  return 0;
}
