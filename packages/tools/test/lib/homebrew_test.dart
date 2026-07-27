import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:path/path.dart' as p;
import 'package:proxer_tools/src/lib/homebrew.dart';
import 'package:test/test.dart';

String _sha256Hex(String content) {
  return sha256.convert(utf8.encode(content)).toString();
}

void main() {
  final tempDirectories = <Directory>[];

  tearDown(() async {
    while (tempDirectories.isNotEmpty) {
      final directory = tempDirectories.removeLast();

      if (directory.existsSync()) {
        await directory.delete(recursive: true);
      }
    }
  });

  Future<Directory> createArtifactsDir() async {
    final directory = await Directory.systemTemp.createTemp('proxer-');
    tempDirectories.add(directory);

    for (final name in homebrewArtifactNames) {
      await File(p.join(directory.path, name)).writeAsString(name);
    }

    return directory;
  }

  test(
    'generates syntactically valid Ruby formula with balanced blocks',
    () async {
      final artifactsDir = await createArtifactsDir();

      await performHomebrewGenerate(
        version: 'v0.42.9',
        artifactsDir: artifactsDir.path,
        repoRoot: artifactsDir.path,
      );

      final formula = await File(
        p.join(artifactsDir.path, 'proxer.rb'),
      ).readAsString();

      expect(formula, contains('class Proxer < Formula'));
      expect(formula, contains('def install'));
      expect(formula, contains('test do'));
      expect(
        formula,
        contains(
          'desc "Self-hosted reverse tunnel for HTTP, SSE, and WebSocket services"',
        ),
      );
    },
  );

  test('writes a versioned formula with keg_only and AT class name', () async {
    final artifactsDir = await createArtifactsDir();

    await performHomebrewGenerate(
      version: '0.42.9',
      artifactsDir: artifactsDir.path,
      repoRoot: artifactsDir.path,
    );

    final versionedFormula = await File(
      p.join(artifactsDir.path, 'proxer@0.42.9.rb'),
    ).readAsString();

    expect(versionedFormula, contains('class ProxerAT0429 < Formula'));
    expect(versionedFormula, contains('keg_only :versioned_formula'));
  });

  test('throws when an artifact is missing', () async {
    final artifactsDir = await createArtifactsDir();
    await File(p.join(artifactsDir.path, 'proxer-linux-arm64')).delete();

    await expectLater(
      performHomebrewGenerate(
        version: 'v0.42.9',
        artifactsDir: artifactsDir.path,
        repoRoot: artifactsDir.path,
      ),
      throwsA(
        predicate(
          (Object? error) =>
              '$error'.contains('Failed to calculate hash') &&
              '$error'.contains('proxer-linux-arm64'),
        ),
      ),
    );
  });

  test('generates a byte-exact default formula for known inputs', () async {
    final artifactsDir = await createArtifactsDir();

    await performHomebrewGenerate(
      version: 'v0.42.9',
      artifactsDir: artifactsDir.path,
      repoRoot: artifactsDir.path,
    );

    final formula = await File(
      p.join(artifactsDir.path, 'proxer.rb'),
    ).readAsString();

    final macosArm = _sha256Hex('proxer-macos-arm64');
    final macosX64 = _sha256Hex('proxer-macos-x64');
    final linuxX64 = _sha256Hex('proxer-linux-x64');
    final linuxArm = _sha256Hex('proxer-linux-arm64');

    final expected =
        '''
class Proxer < Formula
  desc "Self-hosted reverse tunnel for HTTP, SSE, and WebSocket services"
  homepage "https://proxer.tinyrack.net"
  version "0.42.9"

  on_macos do
    on_arm do
      url "https://github.com/tinyrack-net/proxer/releases/download/v0.42.9/proxer-macos-arm64"
      sha256 "$macosArm"
    end
    on_intel do
      url "https://github.com/tinyrack-net/proxer/releases/download/v0.42.9/proxer-macos-x64"
      sha256 "$macosX64"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/tinyrack-net/proxer/releases/download/v0.42.9/proxer-linux-x64"
      sha256 "$linuxX64"
    end
    on_arm do
      url "https://github.com/tinyrack-net/proxer/releases/download/v0.42.9/proxer-linux-arm64"
      sha256 "$linuxArm"
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

    expect(formula, expected);
  });
}
