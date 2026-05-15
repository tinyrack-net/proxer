export type TunnelRoute =
  | { readonly type: "root" }
  | { readonly type: "subdomain"; readonly subdomain: string };

export const tunnelRouteKey = (route: TunnelRoute): string => {
  return route.type === "root" ? "root" : `subdomain:${route.subdomain}`;
};

const hostWithoutPort = (host: string | string[] | undefined): string => {
  const hostValue = Array.isArray(host) ? host[0] : host;
  if (!hostValue) {
    return "";
  }

  return (hostValue.split(":")[0] ?? "").toLowerCase();
};

export const parseTunnelRouteFromHost = (
  host: string | string[] | undefined,
  domain?: string,
): TunnelRoute | undefined => {
  const hostname = hostWithoutPort(host);
  if (!hostname) {
    return undefined;
  }

  if (!domain) {
    const firstLabel = hostname.split(".")[0];
    return firstLabel
      ? { type: "subdomain", subdomain: firstLabel }
      : undefined;
  }

  const normalizedDomain = domain.toLowerCase();
  if (hostname === normalizedDomain) {
    return { type: "root" };
  }

  const suffix = `.${normalizedDomain}`;
  if (!hostname.endsWith(suffix)) {
    return undefined;
  }

  const prefix = hostname.slice(0, -suffix.length);
  if (!prefix || prefix.includes(".")) {
    return undefined;
  }

  return { type: "subdomain", subdomain: prefix };
};
