import type http from "node:http";
import type { Duplex } from "node:stream";
import { secureCompare } from "#app/lib/secure-compare.ts";

export type BasicAuthRequirement = {
  readonly password: string;
  readonly username?: string;
};

export type BasicAuthResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "missing" | "malformed" | "invalid";
    };

const CHALLENGE_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "www-authenticate": 'Basic realm="proxer"',
};

export const verifyBasicAuthHeader = (
  authorization: string | string[] | undefined,
  requirement: BasicAuthRequirement | undefined,
): BasicAuthResult => {
  if (!requirement) {
    return { ok: true };
  }

  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!value) {
    return { ok: false, reason: "missing" };
  }

  if (!value.toLowerCase().startsWith("basic ")) {
    return { ok: false, reason: "malformed" };
  }

  const decoded = Buffer.from(value.slice("basic ".length), "base64").toString(
    "utf8",
  );
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) {
    return { ok: false, reason: "malformed" };
  }

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  if (!secureCompare(requirement.password, password)) {
    return { ok: false, reason: "invalid" };
  }

  if (
    requirement.username !== undefined &&
    !secureCompare(requirement.username, username)
  ) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true };
};

export const writeBasicAuthChallenge = (
  response: http.ServerResponse,
): void => {
  response.writeHead(401, CHALLENGE_HEADERS);
  response.end("Unauthorized\n");
};

export const writeBasicAuthUpgradeChallenge = (socket: Duplex): void => {
  socket.write(
    "HTTP/1.1 401 Unauthorized\r\n" +
      'www-authenticate: Basic realm="proxer"\r\n' +
      "content-type: text/plain; charset=utf-8\r\n" +
      "connection: close\r\n" +
      "\r\n" +
      "Unauthorized\n",
    () => socket.destroy(),
  );
};
