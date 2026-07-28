import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:shipworld/release.dart';
import 'package:shipworld/shipworld.dart';

const Map<String, String> _smokeEnvironment = {
  'FORCE_COLOR': '0',
  'NO_COLOR': '1',
};

void _assertCommandSucceeded(String label, CommandResult result) {
  if (result.exitCode != 0) {
    throw ShipworldException(
      '$label failed with exit code ${result.exitCode}.\n'
      'stdout:\n${result.stdout}\nstderr:\n${result.stderr}',
      code: 'smoke_failed',
    );
  }
}

void _assertIncludes(String label, String actual, String expected) {
  if (!actual.contains(expected)) {
    throw ShipworldException(
      '$label did not include "$expected".\nactual output:\n$actual',
      code: 'smoke_failed',
    );
  }
}

void _assertEmpty(String label, String actual) {
  if (actual.isNotEmpty) {
    throw ShipworldException(
      '$label was expected to be empty.\nactual output:\n$actual',
      code: 'smoke_failed',
    );
  }
}

/// Runs the compiled Proxer executable and asserts its public CLI contract.
Future<void> performSmoke({
  required String repoRoot,
  required String executablePath,
  ProcessExecutor executor = defaultProcessExecutor,
}) async {
  final resolvedExecutablePath = p.isAbsolute(executablePath)
      ? p.normalize(executablePath)
      : p.normalize(p.join(repoRoot, executablePath));
  final version = await readPubspecVersion(p.join(repoRoot, 'pubspec.yaml'));

  Future<CommandResult> runExecutable(List<String> arguments) {
    return runCapture(
      resolvedExecutablePath,
      arguments,
      workingDirectory: repoRoot,
      environment: _smokeEnvironment,
      executor: executor,
    );
  }

  final versionResult = await runExecutable(['--version']);
  _assertCommandSucceeded('smoke --version', versionResult);
  _assertIncludes(
    'smoke --version stdout',
    versionResult.stdout,
    'proxer $version',
  );
  _assertEmpty('smoke --version stderr', versionResult.stderr);

  final rootHelpResult = await runExecutable([]);
  _assertCommandSucceeded('smoke root help', rootHelpResult);
  for (final command in ['server', 'http', 'skill']) {
    _assertIncludes('smoke root help', rootHelpResult.stdout, command);
  }
  _assertEmpty('smoke root help stderr', rootHelpResult.stderr);

  final serverHelpResult = await runExecutable(['server', '--help']);
  _assertCommandSucceeded('smoke server --help', serverHelpResult);
  _assertIncludes('smoke server --help', serverHelpResult.stdout, '--listen');
  _assertIncludes(
    'smoke server --help',
    serverHelpResult.stdout,
    '--trusted-proxy',
  );
  _assertEmpty('smoke server --help stderr', serverHelpResult.stderr);

  final httpHelpResult = await runExecutable(['http', '--help']);
  _assertCommandSucceeded('smoke http --help', httpHelpResult);
  _assertIncludes('smoke http --help', httpHelpResult.stdout, '--server');
  _assertIncludes('smoke http --help', httpHelpResult.stdout, '--subdomain');
  _assertIncludes('smoke http --help', httpHelpResult.stdout, '--mode');
  _assertEmpty('smoke http --help stderr', httpHelpResult.stderr);

  final removedCommandResult = await runExecutable(['add']);
  if (removedCommandResult.exitCode == 0) {
    throw ShipworldException(
      'smoke removed command unexpectedly succeeded.\n'
      'stdout:\n${removedCommandResult.stdout}\n'
      'stderr:\n${removedCommandResult.stderr}',
      code: 'smoke_failed',
    );
  }
  _assertIncludes(
    'smoke removed command stderr',
    removedCommandResult.stderr,
    'No command registered',
  );

  stdout.writeln('smoke test passed with $resolvedExecutablePath');
}

Future<String> _repoRoot() {
  return const IoGitClient().run(const [
    'rev-parse',
    '--show-toplevel',
  ], workingDirectory: Directory.current.path);
}

Future<void> main(List<String> arguments) async {
  if (arguments.length != 2 || arguments.first != '--executable-path') {
    stderr.writeln(
      'Usage: dart run tool/smoke.dart '
      '--executable-path <path>',
    );
    exitCode = 64;
    return;
  }

  try {
    await performSmoke(
      repoRoot: await _repoRoot(),
      executablePath: arguments.last,
    );
  } on ShipworldException catch (error) {
    stderr.writeln(error.message);
    exitCode = 1;
  }
}
