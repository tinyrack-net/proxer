import { ProxerError } from "#app/lib/error.ts";
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

export const tokenFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
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
  parse: parseHttpSubdomain,
  brief: "Subdomain used for host routing.",
  placeholder: "subdomain",
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
