import { describe, expect, it } from "vitest";
import { secureCompare } from "#app/lib/secure-compare.ts";

describe("secureCompare", () => {
  it("accepts equal values", () => {
    expect(secureCompare("expected-token", "expected-token")).toBe(true);
  });

  it("rejects different values", () => {
    expect(secureCompare("expected-token", "wrong-token")).toBe(false);
  });

  it("rejects different-length values without throwing", () => {
    expect(secureCompare("expected-token", "short")).toBe(false);
  });
});
