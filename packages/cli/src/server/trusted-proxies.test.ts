import { describe, expect, it } from "vitest";
import { ProxerError } from "#app/lib/error.ts";
import {
  isTrustedProxy,
  parseTrustedProxyValues,
} from "#app/server/trusted-proxies.ts";

describe("trusted proxy rules", () => {
  it("matches loopback IPv4 and IPv6 addresses", () => {
    const config = parseTrustedProxyValues(["loopback"]);

    expect(isTrustedProxy("127.0.0.1", config)).toBe(true);
    expect(isTrustedProxy("::1", config)).toBe(true);
    expect(isTrustedProxy("10.0.0.1", config)).toBe(false);
  });

  it("matches private IPv4 and IPv6 addresses", () => {
    const config = parseTrustedProxyValues(["private"]);

    expect(isTrustedProxy("10.0.0.1", config)).toBe(true);
    expect(isTrustedProxy("172.16.0.1", config)).toBe(true);
    expect(isTrustedProxy("192.168.1.1", config)).toBe(true);
    expect(isTrustedProxy("fc00::1", config)).toBe(true);
    expect(isTrustedProxy("8.8.8.8", config)).toBe(false);
  });

  it("matches IPv4 CIDR ranges", () => {
    const config = parseTrustedProxyValues(["10.42.0.0/16"]);

    expect(isTrustedProxy("10.42.1.2", config)).toBe(true);
    expect(isTrustedProxy("10.43.1.2", config)).toBe(false);
  });

  it("matches single IP literals exactly", () => {
    const config = parseTrustedProxyValues(["192.168.1.10", "fd00::1"]);

    expect(isTrustedProxy("192.168.1.10", config)).toBe(true);
    expect(isTrustedProxy("192.168.1.11", config)).toBe(false);
    expect(isTrustedProxy("fd00::1", config)).toBe(true);
    expect(isTrustedProxy("fd00::2", config)).toBe(false);
  });

  it("matches IPv4-mapped IPv6 remote addresses against IPv4 rules", () => {
    const config = parseTrustedProxyValues(["10.42.0.0/16"]);

    expect(isTrustedProxy("::ffff:10.42.1.2", config)).toBe(true);
  });

  it("returns false when no trusted proxies are configured", () => {
    expect(isTrustedProxy("127.0.0.1", parseTrustedProxyValues([]))).toBe(
      false,
    );
  });

  it("rejects invalid trusted proxy values", () => {
    expect(() => parseTrustedProxyValues(["*"])).toThrow(ProxerError);
    expect(() => parseTrustedProxyValues(["10.0.0.0/33"])).toThrow(ProxerError);
    expect(() => parseTrustedProxyValues(["fd00::/129"])).toThrow(ProxerError);
  });
});
