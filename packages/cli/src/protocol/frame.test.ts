import { describe, expect, it } from "vitest";
import { assertTunnelFrame, isTunnelFrame } from "#app/protocol/frame.ts";

describe("tunnel frame validation", () => {
  it("accepts valid frames", () => {
    expect(isTunnelFrame({ type: "register" })).toBe(true);
    expect(isTunnelFrame({ type: "register", subdomain: "demo" })).toBe(true);
    expect(isTunnelFrame({ type: "registered" })).toBe(true);
    expect(isTunnelFrame({ type: "registered", subdomain: "demo" })).toBe(true);
    expect(
      isTunnelFrame({
        type: "open",
        streamId: "stream-1",
        kind: "http",
        method: "POST",
        path: "/hello",
        headers: { host: "demo.localhost", "set-cookie": ["a=1", "b=2"] },
      }),
    ).toBe(true);
    expect(
      isTunnelFrame({
        type: "headers",
        streamId: "stream-1",
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    ).toBe(true);
    expect(
      isTunnelFrame({
        type: "data",
        streamId: "stream-1",
        direction: "response",
        data: Buffer.from("hello").toString("base64"),
      }),
    ).toBe(true);
    expect(
      isTunnelFrame({
        type: "end",
        streamId: "stream-1",
        direction: "request",
      }),
    ).toBe(true);
    expect(
      isTunnelFrame({ type: "error", streamId: "stream-1", message: "boom" }),
    ).toBe(true);
    expect(isTunnelFrame({ type: "close", streamId: "stream-1" })).toBe(true);
  });

  it("accepts register frames with basic auth requirements", () => {
    expect(
      isTunnelFrame({
        basicAuth: { password: "secret" },
        type: "register",
      }),
    ).toBe(true);
    expect(
      isTunnelFrame({
        basicAuth: { password: "secret", username: "admin" },
        type: "register",
      }),
    ).toBe(true);
  });

  it("rejects invalid register frame basic auth requirements", () => {
    expect(
      isTunnelFrame({ basicAuth: { password: "" }, type: "register" }),
    ).toBe(false);
    expect(
      isTunnelFrame({
        basicAuth: { password: "secret", username: "" },
        type: "register",
      }),
    ).toBe(false);
    expect(isTunnelFrame({ basicAuth: "secret", type: "register" })).toBe(
      false,
    );
  });

  it("rejects an invalid frame type", () => {
    expect(isTunnelFrame({ type: "ping" })).toBe(false);
  });

  it("requires data frames to contain base64 data", () => {
    expect(
      isTunnelFrame({
        type: "data",
        streamId: "stream-1",
        direction: "request",
        data: "not base64!",
      }),
    ).toBe(false);
  });

  it("rejects name fields and empty subdomains on registration frames", () => {
    expect(isTunnelFrame({ type: "register", name: "demo" })).toBe(false);
    expect(isTunnelFrame({ type: "registered", name: "demo" })).toBe(false);
    expect(isTunnelFrame({ type: "register", subdomain: "" })).toBe(false);
    expect(isTunnelFrame({ type: "registered", subdomain: "" })).toBe(false);
  });

  it.each([
    "bad.name",
    "bad_name",
    "-bad",
    "bad-",
    "a".repeat(64),
  ])("rejects invalid registration subdomain %s", (subdomain) => {
    expect(isTunnelFrame({ type: "register", subdomain })).toBe(false);
    expect(isTunnelFrame({ type: "registered", subdomain })).toBe(false);
  });

  it("requires open frames to include stream id, kind, method, and path", () => {
    expect(
      isTunnelFrame({
        type: "open",
        kind: "http",
        method: "GET",
        path: "/",
        headers: {},
      }),
    ).toBe(false);
    expect(
      isTunnelFrame({
        type: "open",
        streamId: "stream-1",
        kind: "tcp",
        method: "GET",
        path: "/",
        headers: {},
      }),
    ).toBe(false);
  });

  it("asserts valid frames and throws for invalid frames", () => {
    expect(() =>
      assertTunnelFrame({ type: "registered", subdomain: "demo" }),
    ).not.toThrow();
    expect(() =>
      assertTunnelFrame({ type: "registered", name: "demo" }),
    ).toThrow("Invalid tunnel frame");
  });
});
