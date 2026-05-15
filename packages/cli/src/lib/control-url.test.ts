import { describe, expect, it } from "vitest";
import { CONTROL_PATH } from "#app/config/constants.ts";
import { resolveControlServerUrl } from "#app/lib/control-url.ts";

describe("resolveControlServerUrl", () => {
  it("appends the default control path to a ws base URL", () => {
    expect(resolveControlServerUrl({ server: "ws://127.0.0.1:8080" })).toBe(
      `ws://127.0.0.1:8080${CONTROL_PATH}`,
    );
  });

  it("appends the default control path to a wss base URL", () => {
    expect(
      resolveControlServerUrl({ server: "wss://proxer.example.com" }),
    ).toBe(`wss://proxer.example.com${CONTROL_PATH}`);
  });

  it("normalizes http schemes to websocket schemes", () => {
    expect(resolveControlServerUrl({ server: "http://127.0.0.1:8080" })).toBe(
      `ws://127.0.0.1:8080${CONTROL_PATH}`,
    );
    expect(
      resolveControlServerUrl({ server: "https://proxer.example.com" }),
    ).toBe(`wss://proxer.example.com${CONTROL_PATH}`);
  });

  it("rejects an explicit server path because the control path is fixed", () => {
    expect(() =>
      resolveControlServerUrl({
        server: "ws://127.0.0.1:8080/custom-control",
      }),
    ).toThrow("--server must not include a path");
  });

  it.each([
    "ws://127.0.0.1:8080?x=1",
    "ws://127.0.0.1:8080#hash",
  ])("rejects URL with query or hash %s", (server) => {
    expect(() => resolveControlServerUrl({ server })).toThrow();
  });
});
