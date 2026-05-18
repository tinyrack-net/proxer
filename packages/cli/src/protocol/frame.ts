import { isTunnelSubdomain } from "#app/protocol/subdomain.ts";

export type HeaderMap = Record<string, string | string[]>;

export type BasicAuthConfig = {
  readonly password: string;
  readonly username?: string;
};

export type RegisterFrame = {
  readonly type: "register";
  readonly subdomain?: string;
  readonly token?: string;
  readonly basicAuth?: BasicAuthConfig;
};

export type RegisteredFrame = {
  readonly type: "registered";
  readonly subdomain?: string;
};

export type OpenFrame = {
  readonly type: "open";
  readonly streamId: string;
  readonly kind: "http" | "websocket";
  readonly method: string;
  readonly path: string;
  readonly headers: HeaderMap;
};

export type HeadersFrame = {
  readonly type: "headers";
  readonly streamId: string;
  readonly status: number;
  readonly headers: HeaderMap;
};

export type DataFrame = {
  readonly type: "data";
  readonly streamId: string;
  readonly direction: "request" | "response";
  readonly data: string;
};

export type EndFrame = {
  readonly type: "end";
  readonly streamId: string;
  readonly direction: "request" | "response";
};

export type ErrorFrame = {
  readonly type: "error";
  readonly streamId: string;
  readonly message: string;
};

export type CloseFrame = {
  readonly type: "close";
  readonly streamId: string;
};

export type TunnelFrame =
  | RegisterFrame
  | RegisteredFrame
  | OpenFrame
  | HeadersFrame
  | DataFrame
  | EndFrame
  | ErrorFrame
  | CloseFrame;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === "string" && value.length > 0;
};

const hasOptionalString = (value: unknown): value is string | undefined => {
  return value === undefined || typeof value === "string";
};

const isStringArray = (value: unknown): value is string[] => {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
};

const isHeaderMap = (value: unknown): value is HeaderMap => {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (headerValue) =>
        typeof headerValue === "string" || isStringArray(headerValue),
    )
  );
};

const isDirection = (value: unknown): value is DataFrame["direction"] => {
  return value === "request" || value === "response";
};

const isBase64 = (value: unknown): value is string => {
  return (
    typeof value === "string" &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  );
};

type CandidateFrame = {
  readonly type?: unknown;
  readonly subdomain?: unknown;
  readonly token?: unknown;
  readonly basicAuth?: unknown;
  readonly streamId?: unknown;
  readonly kind?: unknown;
  readonly method?: unknown;
  readonly path?: unknown;
  readonly headers?: unknown;
  readonly status?: unknown;
  readonly direction?: unknown;
  readonly data?: unknown;
  readonly message?: unknown;
};

const isBasicAuthConfig = (value: unknown): value is BasicAuthConfig => {
  if (!isRecord(value)) {
    return false;
  }

  const candidate = value as {
    readonly password?: unknown;
    readonly username?: unknown;
  };

  return (
    isNonEmptyString(candidate.password) &&
    (candidate.username === undefined || isNonEmptyString(candidate.username))
  );
};

export const isTunnelFrame = (value: unknown): value is TunnelFrame => {
  if (!isRecord(value)) {
    return false;
  }

  const frame = value as CandidateFrame;
  const hasRemovedNameField = Object.hasOwn(value, "name");

  switch (frame.type) {
    case "register":
      return (
        !hasRemovedNameField &&
        (frame.subdomain === undefined || isTunnelSubdomain(frame.subdomain)) &&
        hasOptionalString(frame.token) &&
        (frame.basicAuth === undefined || isBasicAuthConfig(frame.basicAuth))
      );
    case "registered":
      return (
        !hasRemovedNameField &&
        (frame.subdomain === undefined || isTunnelSubdomain(frame.subdomain))
      );
    case "open":
      return (
        isNonEmptyString(frame.streamId) &&
        (frame.kind === "http" || frame.kind === "websocket") &&
        isNonEmptyString(frame.method) &&
        isNonEmptyString(frame.path) &&
        isHeaderMap(frame.headers)
      );
    case "headers":
      return (
        isNonEmptyString(frame.streamId) &&
        typeof frame.status === "number" &&
        Number.isInteger(frame.status) &&
        frame.status >= 100 &&
        frame.status <= 999 &&
        isHeaderMap(frame.headers)
      );
    case "data":
      return (
        isNonEmptyString(frame.streamId) &&
        isDirection(frame.direction) &&
        isBase64(frame.data)
      );
    case "end":
      return isNonEmptyString(frame.streamId) && isDirection(frame.direction);
    case "error":
      return (
        isNonEmptyString(frame.streamId) && typeof frame.message === "string"
      );
    case "close":
      return isNonEmptyString(frame.streamId);
    default:
      return false;
  }
};

export function assertTunnelFrame(
  value: unknown,
): asserts value is TunnelFrame {
  if (!isTunnelFrame(value)) {
    throw new Error("Invalid tunnel frame");
  }
}
