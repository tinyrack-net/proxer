import { describe, expect, it } from "vitest";
import { getRequestContext } from "#app/server/request-context.ts";
import { parseTrustedProxyValues } from "#app/server/trusted-proxies.ts";

const trustedProxies = parseTrustedProxyValues(["loopback"]);
const noTrustedProxies = parseTrustedProxyValues([]);

describe("request context", () => {
  it("ignores spoofed forwarded headers from untrusted peers", () => {
    expect(
      getRequestContext({
        defaultProtocol: "http",
        headers: {
          host: "direct.example.com",
          "x-forwarded-for": "203.0.113.10",
          "x-forwarded-host": "demo.proxy.example.com",
          "x-forwarded-proto": "https",
          "x-real-ip": "203.0.113.11",
        },
        remoteAddress: "192.0.2.1",
        trustedProxies: noTrustedProxies,
      }),
    ).toEqual({
      clientIp: "192.0.2.1",
      host: "direct.example.com",
      protocol: "http",
      trustedProxy: false,
    });
  });

  it("uses the first untrusted IP from the right side of a trusted forwarded chain", () => {
    expect(
      getRequestContext({
        defaultProtocol: "http",
        headers: {
          "x-forwarded-for": "198.51.100.20, 203.0.113.10, 127.0.0.2",
        },
        remoteAddress: "127.0.0.1",
        trustedProxies,
      }).clientIp,
    ).toBe("203.0.113.10");
  });

  it("falls back to X-Real-IP and then remote address for trusted peers", () => {
    expect(
      getRequestContext({
        defaultProtocol: "http",
        headers: { "x-real-ip": "203.0.113.11" },
        remoteAddress: "127.0.0.1",
        trustedProxies,
      }).clientIp,
    ).toBe("203.0.113.11");

    expect(
      getRequestContext({
        defaultProtocol: "http",
        headers: { "x-real-ip": "bad" },
        remoteAddress: "127.0.0.1",
        trustedProxies,
      }).clientIp,
    ).toBe("127.0.0.1");
  });

  it("uses X-Forwarded-Host and X-Forwarded-Proto from trusted peers", () => {
    expect(
      getRequestContext({
        defaultProtocol: "http",
        headers: {
          host: "direct.example.com",
          "x-forwarded-host": "demo.proxy.example.com",
          "x-forwarded-proto": "https, http",
        },
        remoteAddress: "127.0.0.1",
        trustedProxies,
      }),
    ).toMatchObject({
      host: "demo.proxy.example.com",
      protocol: "https",
      trustedProxy: true,
    });
  });

  it("falls back safely for invalid or empty forwarded values", () => {
    expect(
      getRequestContext({
        defaultProtocol: "https",
        headers: {
          host: "direct.example.com",
          "x-forwarded-for": "bad",
          "x-forwarded-host": "   ",
          "x-forwarded-proto": "ftp",
          "x-real-ip": "also-bad",
        },
        remoteAddress: "127.0.0.1",
        trustedProxies,
      }),
    ).toEqual({
      clientIp: "127.0.0.1",
      host: "direct.example.com",
      protocol: "https",
      trustedProxy: true,
    });
  });
});
