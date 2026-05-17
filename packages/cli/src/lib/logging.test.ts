import { describe, expect, it } from "vitest";
import {
  derivePublicUrl,
  formatRoutePrefix,
  sanitizeLogPath,
  sanitizeLogUrl,
} from "#app/lib/logging.ts";

describe("sanitizeLogPath", () => {
  it("strips query strings from paths", () => {
    expect(sanitizeLogPath("/callback?code=secret&state=ok")).toBe("/callback");
  });

  it("falls back to the root path for missing input", () => {
    expect(sanitizeLogPath(undefined)).toBe("/");
  });
});

describe("sanitizeLogUrl", () => {
  it("strips credentials, query strings, and fragments from absolute URLs", () => {
    expect(
      sanitizeLogUrl(
        "wss://user:secret@proxy.example.com/__proxer__/control?token=secret#hash",
      ),
    ).toBe("wss://proxy.example.com/__proxer__/control");
  });
});

describe("derivePublicUrl", () => {
  it("derives an HTTPS subdomain URL from a secure control URL", () => {
    expect(
      derivePublicUrl({
        serverUrl: "wss://proxy.example.com/__proxer__/control",
        subdomain: "demo",
      }),
    ).toBe("https://demo.proxy.example.com");
  });

  it("derives an HTTP root URL and preserves the port", () => {
    expect(
      derivePublicUrl({
        serverUrl: "ws://proxy.example.com:8080/__proxer__/control",
      }),
    ).toBe("http://proxy.example.com:8080");
  });
});

describe("formatRoutePrefix", () => {
  it("formats subdomain, root, and unknown route prefixes", () => {
    expect(formatRoutePrefix({ type: "subdomain", subdomain: "demo" })).toBe(
      "[demo]",
    );
    expect(formatRoutePrefix({ type: "root" })).toBe("[root]");
    expect(formatRoutePrefix(undefined)).toBe("[unknown]");
  });
});
