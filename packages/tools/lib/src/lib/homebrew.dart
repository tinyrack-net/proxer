import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:path/path.dart' as p;

import 'error.dart';

Future<String> calculateSha256(String filePath) async {
  final content = await File(filePath).readAsBytes();

  return sha256.convert(content).toString();
}

const List<String> homebrewArtifactNames = [
  'proxer-macos-arm64',
  'proxer-macos-x64',
  'proxer-linux-x64',
  'proxer-linux-arm64',
];

/// Renders a Homebrew formula. Byte-compatible with the pre-cutover
/// TypeScript generator.
String generateHomebrewFormula({
  required String className,
  required bool isVersioned,
  required String cleanVersion,
  required Map<String, String> hashes,
}) {
  final kegOnly = isVersioned ? '\n  keg_only :versioned_formula\n' : '';

  return '''
class $className < Formula
  desc "Self-hosted reverse tunnel for HTTP, SSE, and WebSocket services"
  homepage "https://proxer.tinyrack.net"
  version "$cleanVersion"$kegOnly

  on_macos do
    on_arm do
      url "https://github.com/tinyrack-net/proxer/releases/download/v$cleanVersion/proxer-macos-arm64"
      sha256 "${hashes['proxer-macos-arm64']}"
    end
    on_intel do
      url "https://github.com/tinyrack-net/proxer/releases/download/v$cleanVersion/proxer-macos-x64"
      sha256 "${hashes['proxer-macos-x64']}"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/tinyrack-net/proxer/releases/download/v$cleanVersion/proxer-linux-x64"
      sha256 "${hashes['proxer-linux-x64']}"
    end
    on_arm do
      url "https://github.com/tinyrack-net/proxer/releases/download/v$cleanVersion/proxer-linux-arm64"
      sha256 "${hashes['proxer-linux-arm64']}"
    end
  end

  def install
    if OS.mac? && Hardware::CPU.arm?
      bin.install "proxer-macos-arm64" => "proxer"
    elsif OS.mac? && Hardware::CPU.intel?
      bin.install "proxer-macos-x64" => "proxer"
    elsif OS.linux? && Hardware::CPU.intel?
      bin.install "proxer-linux-x64" => "proxer"
    elsif OS.linux? && Hardware::CPU.arm?
      bin.install "proxer-linux-arm64" => "proxer"
    end
  end

  test do
    system "#{bin}/proxer", "--version"
  end
end
''';
}

Future<void> performHomebrewGenerate({
  required String version,
  required String artifactsDir,
  required String repoRoot,
}) async {
  final cleanVersion = version.startsWith('v') ? version.substring(1) : version;
  final resolvedArtifactsDir = p.isAbsolute(artifactsDir)
      ? artifactsDir
      : p.normalize(p.join(repoRoot, artifactsDir));

  final hashes = <String, String>{};

  for (final artifactName in homebrewArtifactNames) {
    final filePath = p.join(resolvedArtifactsDir, artifactName);

    try {
      hashes[artifactName] = await calculateSha256(filePath);
    } on FileSystemException catch (error) {
      throw ToolException(
        'Failed to calculate hash for $artifactName at $filePath: $error',
      );
    }
  }

  final defaultFormula = generateHomebrewFormula(
    className: 'Proxer',
    isVersioned: false,
    cleanVersion: cleanVersion,
    hashes: hashes,
  );
  final versionClassNameSuffix = cleanVersion.replaceAll('.', '');
  final versionedFormula = generateHomebrewFormula(
    className: 'ProxerAT$versionClassNameSuffix',
    isVersioned: true,
    cleanVersion: cleanVersion,
    hashes: hashes,
  );

  final outPathDefault = p.join(resolvedArtifactsDir, 'proxer.rb');
  final outPathVersioned = p.join(
    resolvedArtifactsDir,
    'proxer@$cleanVersion.rb',
  );

  await File(outPathDefault).writeAsString(defaultFormula);
  await File(outPathVersioned).writeAsString(versionedFormula);

  stdout.writeln(
    'Generated Homebrew formulas: $outPathDefault, $outPathVersioned',
  );
}
