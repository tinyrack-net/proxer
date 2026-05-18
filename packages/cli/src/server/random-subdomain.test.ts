import { describe, expect, it } from "vitest";
import { isTunnelSubdomain } from "#app/protocol/subdomain.ts";
import { generateRandomSubdomain } from "#app/server/random-subdomain.ts";

describe("generateRandomSubdomain", () => {
  it("returns a valid DNS label with a proxer prefix", () => {
    const subdomain = generateRandomSubdomain();

    expect(subdomain.startsWith("px-")).toBe(true);
    expect(isTunnelSubdomain(subdomain)).toBe(true);
    expect(subdomain.length).toBeLessThanOrEqual(63);
  });

  it("does not return the same value for repeated calls in normal use", () => {
    const values = new Set(
      Array.from({ length: 32 }, () => generateRandomSubdomain()),
    );

    expect(values.size).toBeGreaterThan(1);
  });
});
