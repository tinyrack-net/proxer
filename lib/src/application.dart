import 'dart:io' as io;

import 'package:cliweave/cliweave.dart';
import 'package:proxer/src/cli/index.dart';
import 'package:proxer/src/config/constants.dart';
import 'package:proxer/src/util/error.dart';
import 'package:proxer/src/util/version.dart';

Application<ApplicationContext> _buildApplication() {
  return buildApplication<ApplicationContext>(
    buildRootRoute(),
    ApplicationConfiguration(
      name: appName,
      scanner: const ScannerConfiguration(
        caseStyle: ScannerCaseStyle.allowKebabForCamel,
      ),
      documentation: const DocumentationConfiguration(
        caseStyle: DisplayCaseStyle.convertCamelToKebab,
        disableAnsiColor: true,
      ),
      localization: LocalizationConfiguration(
        defaultLocale: 'en',
        text: textEn.copyWith(
          commandErrorResult: (error, ansiColor) => formatProxerError(error),
          exceptionWhileRunningCommand: (error, ansiColor) =>
              formatProxerError(error),
        ),
      ),
      determineExitCode: (error) => error is ProxerError ? error.exitCode : 1,
      versionInfo: VersionInformation(
        currentVersion: '$appName $currentVersion',
      ),
    ),
  );
}

Future<int> runCli(
  List<String> inputs, {
  WriteStream? stdout,
  WriteStream? stderr,
  Map<String, String>? environment,
}) async {
  final process = RunProcess(
    stdout: stdout ?? StdioWriteStream(io.stdout),
    stderr: stderr ?? StdioWriteStream(io.stderr),
    readEnv: environment == null ? null : (name) => environment[name],
  );
  await run(
    _buildApplication(),
    inputs,
    RunContext.direct(ApplicationContext(process: process)),
  );
  return process.exitCode ?? 0;
}
