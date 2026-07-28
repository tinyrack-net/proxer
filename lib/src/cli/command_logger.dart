import 'package:cliweave/cliweave.dart';

class CommandLogger {
  const CommandLogger(this.stdout, this.stderr);

  final WriteStream stdout;
  final WriteStream stderr;

  void info(String message) => stdout.write('$message\n');
  void error(String message) => stderr.write('$message\n');
}

CommandLogger loggerFor(CommandContext context) {
  return CommandLogger(context.process.stdout, context.process.stderr);
}
