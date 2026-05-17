export type LogRoute =
  | { readonly type: "root" }
  | { readonly type: "subdomain"; readonly subdomain: string };

export type DerivePublicUrlOptions = {
  readonly serverUrl: string;
  readonly subdomain?: string;
};

export type RuntimeLogger = {
  info(message: string): void;
  error(message: string): void;
};

export const sanitizeLogPath = (url?: string): string => {
  if (!url) {
    return "/";
  }

  try {
    return new URL(url, "http://proxer.local").pathname || "/";
  } catch {
    return "/";
  }
};

export const sanitizeLogUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const hostIndex = url.indexOf(parsed.host);
    const afterHost =
      hostIndex >= 0 ? url.slice(hostIndex + parsed.host.length) : "";
    const hasExplicitPath = afterHost.startsWith("/");

    return `${parsed.protocol}//${parsed.host}${hasExplicitPath ? parsed.pathname : ""}`;
  } catch {
    return url.split("?")[0]?.split("#")[0] ?? "";
  }
};

export const derivePublicUrl = ({
  serverUrl,
  subdomain,
}: DerivePublicUrlOptions): string => {
  const url = new URL(serverUrl);

  if (url.protocol === "wss:") {
    url.protocol = "https:";
  } else if (url.protocol === "ws:") {
    url.protocol = "http:";
  }

  url.username = "";
  url.password = "";
  url.pathname = "/";
  url.search = "";
  url.hash = "";

  if (subdomain) {
    url.hostname = `${subdomain}.${url.hostname}`;
  }

  return url.origin;
};

export const formatRoutePrefix = (route?: LogRoute): string => {
  if (!route) {
    return "[unknown]";
  }

  return route.type === "root" ? "[root]" : `[${route.subdomain}]`;
};
