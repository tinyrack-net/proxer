import type { IncomingHttpHeaders } from "node:http";
import type { HeaderMap } from "#app/protocol/frame.ts";

type ForwardedHeaderContext = {
  readonly clientIp: string;
  readonly host: string | undefined;
  readonly protocol: "http" | "https";
};

const HTTP_HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const splitConnectionHeader = (value: string | string[]): string[] => {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) =>
    item
      .split(",")
      .map((header) => header.trim().toLowerCase())
      .filter((header) => header.length > 0),
  );
};

export const normalizeIncomingHeaders = (
  headers: IncomingHttpHeaders,
): HeaderMap => {
  const normalized: HeaderMap = {};

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    normalized[name.toLowerCase()] = value;
  }

  return normalized;
};

export const stripHttpHopByHopHeaders = (headers: HeaderMap): HeaderMap => {
  const connectionHeader = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "connection",
  )?.[1];
  const connectionNamedHeaders = new Set(
    connectionHeader ? splitConnectionHeader(connectionHeader) : [],
  );
  const stripped: HeaderMap = {};

  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (
      HTTP_HOP_BY_HOP_HEADERS.has(normalizedName) ||
      connectionNamedHeaders.has(normalizedName)
    ) {
      continue;
    }

    stripped[normalizedName] = value;
  }

  return stripped;
};

export const normalizeWebSocketUpgradeHeaders = (
  headers: IncomingHttpHeaders,
): HeaderMap => {
  return normalizeIncomingHeaders(headers);
};

export const applyForwardedHeaders = (
  headers: HeaderMap,
  context: ForwardedHeaderContext,
): HeaderMap => {
  const normalized: HeaderMap = {};

  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (
      normalizedName === "forwarded" ||
      normalizedName === "x-forwarded-for" ||
      normalizedName === "x-forwarded-host" ||
      normalizedName === "x-forwarded-proto" ||
      normalizedName === "x-real-ip"
    ) {
      continue;
    }

    normalized[normalizedName] = value;
  }

  if (context.clientIp) {
    normalized["x-forwarded-for"] = context.clientIp;
  }
  if (context.host) {
    normalized["x-forwarded-host"] = context.host;
  }
  normalized["x-forwarded-proto"] = context.protocol;

  return normalized;
};

export const serializeHeadersForRawHttp = (headers: HeaderMap): string => {
  let serialized = "";

  for (const [name, value] of Object.entries(headers)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      serialized += `${name}: ${item}\r\n`;
    }
  }

  return serialized;
};
