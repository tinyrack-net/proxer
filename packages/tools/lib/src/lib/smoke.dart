import 'dart:io';

import 'package:path/path.dart' as p;

import 'error.dart';
import 'exec.dart';
import 'version_files.dart';

const Map<String, String> _smokeEnvironment = {
  'FORCE_COLOR': '0',
  'NO_COLOR': '1',
};

void _assertCommandSucceeded(String label, CommandResult result) {
  if (result.exitCode == 0) {
    return;
  }

  throw ToolException(
    '$label failed with exit code ${result.exitCode}.\n'
    'stdout:\n${result.stdout}\nstderr:\n${result.stderr}',
  );
}

void _assertIncludes(String label, String actual, String expected) {
  if (actual.contains(expected)) {
    return;
  }

  throw ToolException(
    '$label did not include "$expected".\nactual output:\n$actual',
  );
}

void _assertEmpty(String label, String actual) {
  if (actual.isEmpty) {
    return;
  }

  throw ToolException(
    '$label was expected to be empty.\nactual output:\n$actual',
  );
}

/// Runs the compiled proxer executable and asserts the smoke contract:
/// version string, help output, and removed-command error.
Future<void> performSmoke({
  required String repoRoot,
  required String executablePath,
}) async {
  final resolvedExecutablePath = p.join(repoRoot, executablePath);
  final version = await readPubspecVersion(
    p.join(repoRoot, 'packages', 'cli', 'pubspec.yaml'),
  );

  Future<CommandResult> runExecutable(List<String> args) {
    return runCapture(
      resolvedExecutablePath,
      args,
      workingDirectory: repoRoot,
      environment: _smokeEnvironment,
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
  _assertIncludes('smoke root help', rootHelpResult.stdout, 'server');
  _assertIncludes('smoke root help', rootHelpResult.stdout, 'http');
  _assertIncludes('smoke root help', rootHelpResult.stdout, 'skill');
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
    throw ToolException(
      'smoke removed command unexpectedly succeeded.\n'
      'stdout:\n${removedCommandResult.stdout}\n'
      'stderr:\n${removedCommandResult.stderr}',
    );
  }

  _assertIncludes(
    'smoke removed command stderr',
    removedCommandResult.stderr,
    'No command registered',
  );

  stdout.writeln('smoke test passed with $resolvedExecutablePath');
}
