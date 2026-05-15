import { describe, expect, it } from "vitest";
import {
  decodeFrame,
  encodeFrame,
  ProtocolError,
} from "#app/protocol/frame-codec.ts";

describe("frame codec", () => {
  it("encodes and decodes JSON tunnel frames", () => {
    const frame = { type: "registered", subdomain: "demo" } as const;

    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it("decodes Buffer and ArrayBuffer payloads", () => {
    const encoded = encodeFrame({ type: "registered", subdomain: "demo" });
    const buffer = Buffer.from(encoded);

    expect(decodeFrame(buffer)).toEqual({
      type: "registered",
      subdomain: "demo",
    });
    expect(
      decodeFrame(
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ),
      ),
    ).toEqual({
      type: "registered",
      subdomain: "demo",
    });
  });

  it("throws ProtocolError for invalid JSON", () => {
    expect(() => decodeFrame("{")).toThrow(ProtocolError);
    expect(() => decodeFrame("{")).toThrow("Invalid frame JSON");
  });

  it("throws ProtocolError for JSON that is not a tunnel frame", () => {
    expect(() => decodeFrame(JSON.stringify({ type: "ping" }))).toThrow(
      ProtocolError,
    );
    expect(() => decodeFrame(JSON.stringify({ type: "ping" }))).toThrow(
      "Invalid tunnel frame",
    );
  });
});
