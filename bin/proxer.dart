import 'dart:io';

import 'package:proxer/src/application.dart';

Future<void> main(List<String> args) async {
  exitCode = await runCli(args);
  await stdout.flush();
  await stderr.flush();
}
