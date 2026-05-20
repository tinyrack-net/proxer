import { ProxerError } from "#app/lib/error.ts";
import type { RouteMode } from "#app/protocol/frame.ts";
import {
  isTunnelSubdomain,
  normalizeTunnelSubdomain,
  SUBDOMAIN_RULE_MESSAGE,
} from "#app/protocol/subdomain.ts";

export const parseHttpSubdomain = (input: string): string => {
  const subdomain = normalizeTunnelSubdomain(input);

  if (!isTunnelSubdomain(subdomain)) {
    throw new ProxerError(SUBDOMAIN_RULE_MESSAGE);
  }

  return subdomain;
};

const parseHttpSubdomainFlag = (input: string): string => {
  if (input.trim() === "@") {
    return "@";
  }

  return parseHttpSubdomain(input);
};

export const parseToken = (input: string): string => {
  const token = input.trim();
  if (!token) {
    throw new ProxerError("token must not be empty");
  }

  return token;
};

export const parseBasicAuthPassword = (input: string): string => {
  const password = input.trim();
  if (!password) {
    throw new ProxerError("basic auth password must not be empty");
  }

  return password;
};

export const parseBasicAuthUsername = (input: string): string => {
  const username = input.trim();
  if (!username) {
    throw new ProxerError("basic auth username must not be empty");
  }

  return username;
};

export const parseRouteMode = (input: string): RouteMode => {
  const mode = input.trim();
  if (mode === "single" || mode === "cluster") {
    return mode;
  }

  throw new ProxerError("mode must be single or cluster");
};

export const tokenFlag = {
  kind: "parsed" as const,
  parse: parseToken,
  brief: "Token required by the tunnel server.",
  optional: true as const,
};

export const serverListenFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
  brief: "Single HTTP/WebSocket listener address.",
  placeholder: "host:port",
  optional: true as const,
};

export const httpServerFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
  brief: "Tunnel server base URL.",
  placeholder: "wss://host",
  optional: true as const,
};

export const serverDomainFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input.toLowerCase(),
  brief: "Public root domain used for root and subdomain routing.",
  placeholder: "example.com",
  optional: true as const,
};

export const httpSubdomainFlag = {
  kind: "parsed" as const,
  parse: parseHttpSubdomainFlag,
  brief:
    "Subdomain for host routing; omit for random, or use @ for root when the server has --domain.",
  placeholder: "subdomain",
  optional: true as const,
};

export const basicAuthPasswordFlag = {
  kind: "parsed" as const,
  parse: parseBasicAuthPassword,
  brief: "Basic Auth password required for public tunnel access.",
  placeholder: "password",
  optional: true as const,
};

export const basicAuthUsernameFlag = {
  kind: "parsed" as const,
  parse: parseBasicAuthUsername,
  brief: "Basic Auth username required for public tunnel access.",
  placeholder: "username",
  optional: true as const,
};

export const routeModeFlag = {
  kind: "parsed" as const,
  parse: parseRouteMode,
  brief: "Tunnel route sharing mode: single or cluster.",
  placeholder: "mode",
  optional: true as const,
};

export const trustedProxyFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
  brief: "Trusted reverse proxy IP, CIDR, or preset.",
  placeholder: "proxy",
  optional: true as const,
  variadic: true as const,
};
