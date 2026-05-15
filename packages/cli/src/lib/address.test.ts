import { describe, expect, it } from "vitest";
import { formatHostPort, parseHostPort } from "#app/lib/address.ts";

describe("parseHostPort", () => {
  it("parses host and port", () => {
    expect(parseHostPort("127.0.0.1:8080")).toEqual({
      host: "127.0.0.1",
      port: 8080,
    });
  });

  it("uses the supplied default host for shorthand ports", () => {
    expect(parseHostPort(":8080", "0.0.0.0")).toEqual({
      host: "0.0.0.0",
      port: 8080,
    });
  });

  it("uses localhost as the implicit default host", () => {
    expect(parseHostPort(":8080")).toEqual({
      host: "127.0.0.1",
      port: 8080,
    });
  });

  it("rejects a missing port", () => {
    expect(() => parseHostPort("127.0.0.1")).toThrow("missing port");
  });

  it("rejects a non-numeric port", () => {
    expect(() => parseHostPort("127.0.0.1:http")).toThrow("invalid port");
  });

  it("rejects an out-of-range port", () => {
    expect(() => parseHostPort("127.0.0.1:70000")).toThrow(
      "port must be between 1 and 65535",
    );
  });
});

describe("formatHostPort", () => {
  it("formats host and port", () => {
    expect(formatHostPort({ host: "127.0.0.1", port: 8080 })).toBe(
      "127.0.0.1:8080",
    );
  });
});
