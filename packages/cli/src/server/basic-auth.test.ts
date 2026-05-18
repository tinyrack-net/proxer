import { describe, expect, it } from "vitest";
import { verifyBasicAuthHeader } from "#app/server/basic-auth.ts";

const basic = (value: string): string => {
  return `Basic ${Buffer.from(value).toString("base64")}`;
};

describe("basic auth", () => {
  it("allows requests when no requirement is configured", () => {
    expect(verifyBasicAuthHeader(undefined, undefined)).toEqual({ ok: true });
  });

  it("rejects missing authorization when password is required", () => {
    expect(
      verifyBasicAuthHeader(undefined, { password: "secret" }),
    ).toMatchObject({ ok: false, reason: "missing" });
  });

  it("accepts any username in password-only mode", () => {
    expect(
      verifyBasicAuthHeader(basic("anything:secret"), { password: "secret" }),
    ).toEqual({ ok: true });
  });

  it("requires username when configured", () => {
    expect(
      verifyBasicAuthHeader(basic("admin:secret"), {
        password: "secret",
        username: "admin",
      }),
    ).toEqual({ ok: true });
    expect(
      verifyBasicAuthHeader(basic("other:secret"), {
        password: "secret",
        username: "admin",
      }),
    ).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("rejects malformed basic auth", () => {
    expect(
      verifyBasicAuthHeader("Bearer token", { password: "secret" }),
    ).toMatchObject({ ok: false, reason: "malformed" });
  });
});
