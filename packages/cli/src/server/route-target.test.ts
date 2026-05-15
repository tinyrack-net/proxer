import { describe, expect, it } from "vitest";
import { parseTunnelRouteFromHost } from "#app/server/route-target.ts";

describe("parseTunnelRouteFromHost", () => {
  it("matches root and single-label subdomain routes for a configured domain", () => {
    const domain = "proxy.intranet.winetree94.com";

    expect(
      parseTunnelRouteFromHost("proxy.intranet.winetree94.com", domain),
    ).toEqual({ type: "root" });
    expect(
      parseTunnelRouteFromHost("proxy.intranet.winetree94.com:443", domain),
    ).toEqual({ type: "root" });
    expect(
      parseTunnelRouteFromHost("demo.proxy.intranet.winetree94.com", domain),
    ).toEqual({ type: "subdomain", subdomain: "demo" });
    expect(
      parseTunnelRouteFromHost("other.proxy.intranet.winetree94.com", domain),
    ).toEqual({ type: "subdomain", subdomain: "other" });
    expect(
      parseTunnelRouteFromHost("a.b.proxy.intranet.winetree94.com", domain),
    ).toBeUndefined();
    expect(
      parseTunnelRouteFromHost("evil.example.com", domain),
    ).toBeUndefined();
    expect(parseTunnelRouteFromHost(undefined, domain)).toBeUndefined();
  });

  it("uses the first Host label as an explicit subdomain route without a configured domain", () => {
    expect(parseTunnelRouteFromHost("demo.localhost")).toEqual({
      type: "subdomain",
      subdomain: "demo",
    });
    expect(parseTunnelRouteFromHost("demo.localhost:8080")).toEqual({
      type: "subdomain",
      subdomain: "demo",
    });
    expect(parseTunnelRouteFromHost("localhost")).toEqual({
      type: "subdomain",
      subdomain: "localhost",
    });
    expect(parseTunnelRouteFromHost("127.0.0.1:8080")).toEqual({
      type: "subdomain",
      subdomain: "127",
    });
  });
});
