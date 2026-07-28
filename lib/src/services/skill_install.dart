import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:proxer/src/assets/proxer_skill.dart';
import 'package:proxer/src/util/error.dart';

class SkillInstallResult {
  const SkillInstallResult({required this.targetPath, required this.dryRun});

  final String targetPath;
  final bool dryRun;
}

Future<SkillInstallResult> installProxerSkill({
  required String directory,
  bool dryRun = false,
  bool force = false,
}) async {
  final target = p.join(p.absolute(directory), 'proxer.md');
  final file = File(target);
  if (await file.exists() && !force) {
    throw ProxerError(
      'Proxer skill already exists at $target; use --force to overwrite',
    );
  }
  if (!dryRun) {
    await file.parent.create(recursive: true);
    await file.writeAsString(proxerSkillContent);
  }
  return SkillInstallResult(targetPath: target, dryRun: dryRun);
}
