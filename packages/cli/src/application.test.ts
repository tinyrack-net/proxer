import { describe, expect, it } from "vitest";
import { createApplicationInfo } from "#app/application.ts";

describe("createApplicationInfo", () => {
  it("declares the Proxer CLI identity and purpose", () => {
    expect(createApplicationInfo()).toEqual({
      name: "proxer",
      packageName: "@tinyrack/proxer",
      version: "0.0.0",
      purpose:
        "Reverse-tunnel CLI for exposing local services through Tinyrack.",
    });
  });
});
