import { describe, expect, it } from "vitest";
import { DEFAULT_CONTROL_PATH } from "#app/config/constants.ts";
import { normalizeControlPath } from "#app/lib/control-path.ts";

describe("normalizeControlPath", () => {
  it("uses the default control path when omitted", () => {
    expect(normalizeControlPath(undefined)).toBe(DEFAULT_CONTROL_PATH);
  });

  it("accepts an absolute custom control path", () => {
    expect(normalizeControlPath("/_proxer/control")).toBe("/_proxer/control");
  });

  it.each(["control", "", "/"])("rejects invalid path %j", (path) => {
    expect(() => normalizeControlPath(path)).toThrow();
  });
});
