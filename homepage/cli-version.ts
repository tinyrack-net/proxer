import { readFileSync } from "node:fs";

// The CLI version's source of truth is the Dart package's pubspec (bumped by
// `dart run shipworld:shipworld release prepare proxer=<bump>` together with
// version.g.dart).
const pubspec = readFileSync(
  new URL("../pubspec.yaml", import.meta.url),
  "utf8",
);

const match = pubspec.match(/^version:\s*(\S+)/m);

if (!match?.[1]) {
  throw new Error("Could not read the CLI version from pubspec.yaml");
}

export const cliVersion: string = match[1];
