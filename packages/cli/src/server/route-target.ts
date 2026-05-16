export type TunnelRoute =
  | { readonly type: "root" }
  | { readonly type: "subdomain"; readonly subdomain: string };

export const tunnelRouteKey = (route: TunnelRoute): string => {
  return route.type === "root" ? "root" : `subdomain:${route.subdomain}`;
};

const parseHostAuthority = (
  host: string | string[] | undefined,
): string | undefined => {
  const hostValue = Array.isArray(host) ? host[0] : host;
  const authority = hostValue?.trim().toLowerCase();
  if (!authority || authority.startsWith("[") || authority.includes("]")) {
    return undefined;
  }

  const parts = authority.split(":");
  if (parts.length > 2) {
    return undefined;
  }

  const hostname = parts[0] ?? "";
  if (!hostname) {
    return undefined;
  }

  if (parts.length === 2 && !/^\d+$/u.test(parts[1] ?? "")) {
    return undefined;
  }

  return hostname;
};

export const parseTunnelRouteFromHost = (
  host: string | string[] | undefined,
  domain?: string,
): TunnelRoute | undefined => {
  const hostname = parseHostAuthority(host);
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
