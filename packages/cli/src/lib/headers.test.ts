import type { IncomingHttpHeaders } from "node:http";
import { describe, expect, it } from "vitest";
import {
  applyForwardedHeaders,
  normalizeIncomingHeaders,
  normalizeWebSocketUpgradeHeaders,
  serializeHeadersForRawHttp,
  stripHttpHopByHopHeaders,
} from "#app/lib/headers.ts";

describe("header utilities", () => {
  it("normalizes incoming headers and drops undefined values", () => {
    const headers: IncomingHttpHeaders = {
      host: "demo.localhost",
      "set-cookie": ["a=1", "b=2"],
      "x-empty": undefined,
    };

    expect(normalizeIncomingHeaders(headers)).toEqual({
      host: "demo.localhost",
      "set-cookie": ["a=1", "b=2"],
    });
  });

  it("strips regular HTTP hop-by-hop headers", () => {
    expect(
      stripHttpHopByHopHeaders({
        connection: "x-proxy-only, keep-alive",
        host: "demo.localhost",
        "keep-alive": "timeout=5",
        "proxy-authenticate": "Basic realm=proxy",
        "proxy-authorization": "Basic token",
        te: "trailers",
        trailer: "expires",
        "transfer-encoding": "chunked",
        upgrade: "websocket",
        "x-proxy-only": "remove-me",
        "x-request-id": "keep-me",
      }),
    ).toEqual({
      host: "demo.localhost",
      "x-request-id": "keep-me",
    });
  });

  it("preserves WebSocket upgrade headers for raw upgrade forwarding", () => {
    const headers: IncomingHttpHeaders = {
      connection: "Upgrade",
      host: "demo.localhost",
      upgrade: "websocket",
      "sec-websocket-key": "abc",
      "sec-websocket-version": "13",
    };

    expect(normalizeWebSocketUpgradeHeaders(headers)).toEqual({
      connection: "Upgrade",
      host: "demo.localhost",
      upgrade: "websocket",
      "sec-websocket-key": "abc",
      "sec-websocket-version": "13",
    });
  });

  it("serializes headers for raw HTTP requests", () => {
    expect(
      serializeHeadersForRawHttp({
        host: "demo.localhost",
        "set-cookie": ["a=1", "b=2"],
      }),
    ).toBe("host: demo.localhost\r\nset-cookie: a=1\r\nset-cookie: b=2\r\n");
  });

  it("strips spoofed forwarded headers and applies canonical values", () => {
    expect(
      applyForwardedHeaders(
        {
          forwarded: "for=203.0.113.1",
          host: "demo.localhost",
          "x-forwarded-for": "spoofed",
          "x-forwarded-host": "spoofed.example.com",
          "x-forwarded-proto": "https",
          "x-real-ip": "spoofed",
        },
        {
          clientIp: "198.51.100.10",
          host: "demo.localhost",
          protocol: "http",
        },
      ),
    ).toEqual({
      host: "demo.localhost",
      "x-forwarded-for": "198.51.100.10",
      "x-forwarded-host": "demo.localhost",
      "x-forwarded-proto": "http",
    });
  });
});
