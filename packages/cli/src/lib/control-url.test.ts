import { describe, expect, it } from "vitest";
import { DEFAULT_CONTROL_PATH } from "#app/config/constants.ts";
import { resolveControlServerUrl } from "#app/lib/control-url.ts";

describe("resolveControlServerUrl", () => {
  it("appends the default control path to a ws base URL", () => {
    expect(resolveControlServerUrl({ server: "ws://127.0.0.1:8080" })).toBe(
      `ws://127.0.0.1:8080${DEFAULT_CONTROL_PATH}`,
    );
  });

  it("appends the default control path to a wss base URL", () => {
    expect(
      resolveControlServerUrl({ server: "wss://proxer.example.com" }),
    ).toBe(`wss://proxer.example.com${DEFAULT_CONTROL_PATH}`);
  });

  it("normalizes http schemes to websocket schemes", () => {
    expect(resolveControlServerUrl({ server: "http://127.0.0.1:8080" })).toBe(
      `ws://127.0.0.1:8080${DEFAULT_CONTROL_PATH}`,
    );
    expect(
      resolveControlServerUrl({ server: "https://proxer.example.com" }),
    ).toBe(`wss://proxer.example.com${DEFAULT_CONTROL_PATH}`);
  });

  it("uses a custom control path", () => {
    expect(
      resolveControlServerUrl({
        controlPath: "/_proxer/control",
        server: "ws://127.0.0.1:8080",
      }),
    ).toBe("ws://127.0.0.1:8080/_proxer/control");
  });

  it("preserves an explicit server path when control path is omitted", () => {
    expect(
      resolveControlServerUrl({ server: "ws://127.0.0.1:8080/custom" }),
    ).toBe("ws://127.0.0.1:8080/custom");
  });

  it("rejects ambiguous explicit server path plus control path", () => {
    expect(() =>
      resolveControlServerUrl({
        controlPath: "/_proxer/control",
        server: "ws://127.0.0.1:8080/custom",
      }),
    ).toThrow();
  });

  it.each([
    "ws://127.0.0.1:8080?x=1",
    "ws://127.0.0.1:8080#hash",
  ])("rejects URL with query or hash %s", (server) => {
    expect(() => resolveControlServerUrl({ server })).toThrow();
  });
});
