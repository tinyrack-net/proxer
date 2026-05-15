import { describe, expect, it } from "vitest";
import { preferFlag, readEnvList, readEnvString } from "#app/cli/env.ts";

describe("environment option helpers", () => {
  it("reads trimmed non-empty string values", () => {
    expect(
      readEnvString({
        env: { PROXER_TOKEN: "  secret  " },
        name: "PROXER_TOKEN",
      }),
    ).toBe("secret");
  });

  it("treats missing, empty, and whitespace-only values as unset", () => {
    expect(readEnvString({ env: {}, name: "PROXER_TOKEN" })).toBeUndefined();
    expect(
      readEnvString({ env: { PROXER_TOKEN: "" }, name: "PROXER_TOKEN" }),
    ).toBeUndefined();
    expect(
      readEnvString({ env: { PROXER_TOKEN: "   " }, name: "PROXER_TOKEN" }),
    ).toBeUndefined();
  });

  it("splits comma-separated list values and drops empty entries", () => {
    expect(
      readEnvList({
        env: { PROXER_TRUSTED_PROXIES: " loopback, private, ,10.42.0.0/16 " },
        name: "PROXER_TRUSTED_PROXIES",
      }),
    ).toEqual(["loopback", "private", "10.42.0.0/16"]);
  });

  it("returns undefined for empty list values", () => {
    expect(
      readEnvList({
        env: { PROXER_TRUSTED_PROXIES: " , , " },
        name: "PROXER_TRUSTED_PROXIES",
      }),
    ).toBeUndefined();
  });

  it("prefers CLI flag values over environment values", () => {
    expect(preferFlag("from-flag", "from-env")).toBe("from-flag");
    expect(preferFlag(undefined, "from-env")).toBe("from-env");
  });
});
