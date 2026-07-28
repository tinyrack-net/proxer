import 'package:cliweave/cliweave.dart';

String? readEnvString(CommandContext context, String name) {
  final value = context.process.readEnv(name)?.trim();
  return value == null || value.isEmpty ? null : value;
}

List<String>? readEnvList(CommandContext context, String name) {
  final value = readEnvString(context, name);
  if (value == null) {
    return null;
  }
  final items = value
      .split(',')
      .map((item) => item.trim())
      .where((item) => item.isNotEmpty)
      .toList();
  return items.isEmpty ? null : items;
}

T? preferFlag<T>(T? flag, T? environment) => flag ?? environment;
