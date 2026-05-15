import type http from "node:http";
import net from "node:net";
import {
  isTrustedProxy,
  type TrustedProxyConfig,
} from "#app/server/trusted-proxies.ts";

export type RequestContext = {
  readonly clientIp: string;
  readonly host: string | undefined;
  readonly protocol: "http" | "https";
  readonly trustedProxy: boolean;
};

const firstHeaderValue = (
  value: string | string[] | undefined,
): string | undefined => {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : undefined;
};

const firstCommaValue = (
  value: string | string[] | undefined,
): string | undefined => {
  const first = firstHeaderValue(value)?.split(",")[0]?.trim();
  return first ? first : undefined;
};

const firstValidForwardedIp = (
  value: string | string[] | undefined,
): string | undefined => {
  const values = Array.isArray(value) ? value : value ? [value] : [];

  for (const item of values) {
    for (const candidate of item.split(",")) {
      const ip = candidate.trim();
      if (net.isIP(ip) !== 0) {
        return ip;
      }
    }
  }

  return undefined;
};

const forwardedProtocol = (
  value: string | string[] | undefined,
  defaultProtocol: "http" | "https",
): "http" | "https" => {
  const protocol = firstCommaValue(value)?.toLowerCase();
  return protocol === "http" || protocol === "https"
    ? protocol
    : defaultProtocol;
};

export const getRequestContext = ({
  defaultProtocol,
  headers,
  remoteAddress,
  trustedProxies,
}: {
  readonly defaultProtocol: "http" | "https";
  readonly headers: http.IncomingHttpHeaders;
  readonly remoteAddress: string | undefined;
  readonly trustedProxies: TrustedProxyConfig;
}): RequestContext => {
  const trustedProxy = isTrustedProxy(remoteAddress, trustedProxies);
  if (!trustedProxy) {
    return {
      clientIp: remoteAddress ?? "",
      host: firstHeaderValue(headers.host),
      protocol: defaultProtocol,
      trustedProxy,
    };
  }

  return {
    clientIp:
      firstValidForwardedIp(headers["x-forwarded-for"]) ??
      firstValidForwardedIp(headers["x-real-ip"]) ??
      remoteAddress ??
      "",
    host:
      firstHeaderValue(headers["x-forwarded-host"]) ??
      firstHeaderValue(headers.host),
    protocol: forwardedProtocol(headers["x-forwarded-proto"], defaultProtocol),
    trustedProxy,
  };
};
